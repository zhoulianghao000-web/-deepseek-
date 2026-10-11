import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库文件路径
const dbPath = path.join(__dirname, '..', 'data', 'chat.db');

// 确保 data 目录存在
import fs from 'fs';
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 创建数据库连接
const db = new Database(dbPath);

// 启用 WAL 模式以提高性能
db.pragma('journal_mode = WAL');

// 初始化数据库表
db.exec(`
  -- 会话表
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    sdk_session_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 消息表
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    model TEXT,
    created_at TEXT NOT NULL,
    tool_calls TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  -- 为会话 ID 创建索引
  CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

  -- 应用配置表（key-value，值统一为 JSON 字符串）
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 微信（外部渠道）会话表
  CREATE TABLE IF NOT EXISTS wx_conversations (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    external_user_id TEXT NOT NULL,
    display_name TEXT,
    ai_provider TEXT,
    ai_model TEXT,
    sdk_session_id TEXT,
    message_count INTEGER NOT NULL DEFAULT 0,
    last_message_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (channel, external_user_id)
  );

  -- 微信（外部渠道）消息表
  CREATE TABLE IF NOT EXISTS wx_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    msg_type TEXT,
    provider TEXT,
    model TEXT,
    status TEXT,
    error TEXT,
    latency_ms INTEGER,
    raw TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES wx_conversations(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_wx_messages_conversation ON wx_messages(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_wx_messages_created ON wx_messages(created_at);

  -- 运行日志表（供控制台监控）
  CREATE TABLE IF NOT EXISTS app_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL,
    scope TEXT,
    message TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_app_logs_created ON app_logs(created_at);
`);

// 数据库迁移：添加 sdk_session_id 列（如果不存在）
try {
  const tableInfo = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  const hasColumn = tableInfo.some(col => col.name === 'sdk_session_id');
  if (!hasColumn) {
    db.exec("ALTER TABLE sessions ADD COLUMN sdk_session_id TEXT");
    console.log("[DB] Added sdk_session_id column to sessions table");
  }
} catch (e) {
  // 忽略错误（列可能已存在）
}

// 类型定义
export interface DbSession {
  id: string;
  title: string;
  model: string;
  sdk_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  created_at: string;
  tool_calls: string | null;
}

// ============= 会话操作 =============

// 获取所有会话
export function getAllSessions(): DbSession[] {
  const stmt = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC');
  return stmt.all() as DbSession[];
}

// 获取单个会话
export function getSession(id: string): DbSession | undefined {
  const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
  return stmt.get(id) as DbSession | undefined;
}

// 创建会话
export function createSession(session: DbSession): DbSession {
  const stmt = db.prepare(`
    INSERT INTO sessions (id, title, model, sdk_session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(session.id, session.title, session.model, session.sdk_session_id, session.created_at, session.updated_at);
  return session;
}

// 更新会话
export function updateSession(id: string, updates: Partial<Pick<DbSession, 'title' | 'model' | 'sdk_session_id'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title);
  }
  if (updates.model !== undefined) {
    fields.push('model = ?');
    values.push(updates.model);
  }
  if (updates.sdk_session_id !== undefined) {
    fields.push('sdk_session_id = ?');
    values.push(updates.sdk_session_id);
  }
  
  if (fields.length === 0) return false;
  
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  
  const stmt = db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

// 删除会话
export function deleteSession(id: string): boolean {
  const stmt = db.prepare('DELETE FROM sessions WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// ============= 消息操作 =============

// 获取会话的所有消息
export function getMessagesBySession(sessionId: string): DbMessage[] {
  const stmt = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC');
  return stmt.all(sessionId) as DbMessage[];
}

// 创建消息
export function createMessage(message: DbMessage): DbMessage {
  const stmt = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, model, created_at, tool_calls)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    message.id,
    message.session_id,
    message.role,
    message.content,
    message.model,
    message.created_at,
    message.tool_calls
  );
  
  // 更新会话的 updated_at
  const updateStmt = db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?');
  updateStmt.run(new Date().toISOString(), message.session_id);
  
  return message;
}

// 更新消息内容
export function updateMessage(id: string, updates: Partial<Pick<DbMessage, 'content' | 'tool_calls'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.content !== undefined) {
    fields.push('content = ?');
    values.push(updates.content);
  }
  if (updates.tool_calls !== undefined) {
    fields.push('tool_calls = ?');
    values.push(updates.tool_calls);
  }
  
  if (fields.length === 0) return false;
  
  values.push(id);
  
  const stmt = db.prepare(`UPDATE messages SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

// 删除消息
export function deleteMessage(id: string): boolean {
  const stmt = db.prepare('DELETE FROM messages WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// 批量创建消息（用于保存对话）
export function createMessages(messages: DbMessage[]): void {
  const stmt = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, model, created_at, tool_calls)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertMany = db.transaction((msgs: DbMessage[]) => {
    for (const msg of msgs) {
      stmt.run(msg.id, msg.session_id, msg.role, msg.content, msg.model, msg.created_at, msg.tool_calls);
    }
  });
  
  insertMany(messages);
}

// 清空所有数据
export function clearAllData(): void {
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM sessions');
}

// ============= 应用配置（settings） =============

export interface DbSettingRow {
  key: string;
  value: string;
  updated_at: string;
}

// 读取单条配置
export function getSetting(key: string): string | undefined {
  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const row = stmt.get(key) as { value: string } | undefined;
  return row?.value;
}

// 写入单条配置（upsert）
export function setSetting(key: string, value: string): void {
  const stmt = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  stmt.run(key, value, new Date().toISOString());
}

// 读取全部配置
export function getAllSettings(): DbSettingRow[] {
  const stmt = db.prepare('SELECT * FROM settings ORDER BY key ASC');
  return stmt.all() as DbSettingRow[];
}

// ============= 微信会话（wx_conversations） =============

export interface DbWxConversation {
  id: string;
  channel: string;
  external_user_id: string;
  display_name: string | null;
  ai_provider: string | null;
  ai_model: string | null;
  sdk_session_id: string | null;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

// 按渠道 + 外部用户 ID 查询会话
export function getWxConversationByExternal(channel: string, externalUserId: string): DbWxConversation | undefined {
  const stmt = db.prepare('SELECT * FROM wx_conversations WHERE channel = ? AND external_user_id = ?');
  return stmt.get(channel, externalUserId) as DbWxConversation | undefined;
}

// 查询单个会话
export function getWxConversation(id: string): DbWxConversation | undefined {
  const stmt = db.prepare('SELECT * FROM wx_conversations WHERE id = ?');
  return stmt.get(id) as DbWxConversation | undefined;
}

// 创建会话
export function createWxConversation(conversation: DbWxConversation): DbWxConversation {
  const stmt = db.prepare(`
    INSERT INTO wx_conversations
      (id, channel, external_user_id, display_name, ai_provider, ai_model, sdk_session_id,
       message_count, last_message_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    conversation.id,
    conversation.channel,
    conversation.external_user_id,
    conversation.display_name,
    conversation.ai_provider,
    conversation.ai_model,
    conversation.sdk_session_id,
    conversation.message_count,
    conversation.last_message_at,
    conversation.created_at,
    conversation.updated_at,
  );
  return conversation;
}

// 更新会话（局部字段）
export function updateWxConversation(
  id: string,
  updates: Partial<Pick<DbWxConversation, 'display_name' | 'ai_provider' | 'ai_model' | 'sdk_session_id' | 'message_count' | 'last_message_at'>>,
): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  const assign = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };

  if (updates.display_name !== undefined) assign('display_name', updates.display_name);
  if (updates.ai_provider !== undefined) assign('ai_provider', updates.ai_provider);
  if (updates.ai_model !== undefined) assign('ai_model', updates.ai_model);
  if (updates.sdk_session_id !== undefined) assign('sdk_session_id', updates.sdk_session_id);
  if (updates.message_count !== undefined) assign('message_count', updates.message_count);
  if (updates.last_message_at !== undefined) assign('last_message_at', updates.last_message_at);

  if (fields.length === 0) return false;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  const stmt = db.prepare(`UPDATE wx_conversations SET ${fields.join(', ')} WHERE id = ?`);
  return stmt.run(...values).changes > 0;
}

// 会话列表（含最后一条消息预览）
export function listWxConversations(options: { limit?: number; offset?: number; keyword?: string; channel?: string } = {}): Array<DbWxConversation & { last_message: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const clauses: string[] = [];
  const params: any[] = [];

  if (options.channel) {
    clauses.push('c.channel = ?');
    params.push(options.channel);
  }
  if (options.keyword) {
    clauses.push('(c.external_user_id LIKE ? OR IFNULL(c.display_name, \'\') LIKE ?)');
    params.push(`%${options.keyword}%`, `%${options.keyword}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const stmt = db.prepare(`
    SELECT c.*,
      (SELECT m.content FROM wx_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_message
    FROM wx_conversations c
    ${where}
    ORDER BY IFNULL(c.last_message_at, c.created_at) DESC
    LIMIT ? OFFSET ?
  `);
  return stmt.all(...params, limit, offset) as Array<DbWxConversation & { last_message: string | null }>;
}

// 会话总数
export function countWxConversations(): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM wx_conversations').get() as { n: number };
  return row.n;
}

// 删除会话（级联删除消息）
export function deleteWxConversation(id: string): boolean {
  const result = db.prepare('DELETE FROM wx_conversations WHERE id = ?').run(id);
  return result.changes > 0;
}

// 清空全部微信会话
export function clearWxConversations(): number {
  const result = db.prepare('DELETE FROM wx_conversations').run();
  return result.changes;
}

// ============= 微信消息（wx_messages） =============

export interface DbWxMessage {
  id: string;
  conversation_id: string;
  direction: 'in' | 'out';
  role: 'user' | 'assistant' | 'system';
  content: string;
  msg_type: string | null;
  provider: string | null;
  model: string | null;
  status: string | null;
  error: string | null;
  latency_ms: number | null;
  raw: string | null;
  created_at: string;
}

// 新增消息
export function createWxMessage(message: DbWxMessage): DbWxMessage {
  const stmt = db.prepare(`
    INSERT INTO wx_messages
      (id, conversation_id, direction, role, content, msg_type, provider, model, status, error, latency_ms, raw, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    message.id,
    message.conversation_id,
    message.direction,
    message.role,
    message.content,
    message.msg_type,
    message.provider,
    message.model,
    message.status,
    message.error,
    message.latency_ms,
    message.raw,
    message.created_at,
  );
  return message;
}

// 查询会话消息（按时间升序；limit 表示取最近 N 条）
export function listWxMessages(conversationId: string, limit = 200): DbWxMessage[] {
  const max = Math.min(Math.max(limit, 1), 1000);
  // 直接以 rowid 排序保证同一毫秒内的写入顺序（rowid 仅可在真实表上引用，不能用 SELECT * 带出）
  const rows = db
    .prepare('SELECT * FROM wx_messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(conversationId) as DbWxMessage[];
  return rows.length > max ? rows.slice(-max) : rows;
}

// 删除会话消息（重置上下文）
export function deleteWxMessagesByConversation(conversationId: string): number {
  return db.prepare('DELETE FROM wx_messages WHERE conversation_id = ?').run(conversationId).changes;
}

// 消息条数统计
export function countWxMessages(direction?: 'in' | 'out', sinceIso?: string): number {
  const clauses: string[] = [];
  const params: any[] = [];
  if (direction) {
    clauses.push('direction = ?');
    params.push(direction);
  }
  if (sinceIso) {
    clauses.push('created_at >= ?');
    params.push(sinceIso);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const row = db.prepare(`SELECT COUNT(*) AS n FROM wx_messages ${where}`).get(...params) as { n: number };
  return row.n;
}

// ============= 运行日志（app_logs） =============

export interface DbLogRow {
  id: number;
  level: string;
  scope: string | null;
  message: string;
  detail: string | null;
  created_at: string;
}

export function insertLog(entry: { level: string; scope: string; message: string; detail?: string | null }): void {
  const stmt = db.prepare(`
    INSERT INTO app_logs (level, scope, message, detail, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(entry.level, entry.scope, entry.message, entry.detail ?? null, new Date().toISOString());
}

export function listLogs(options: { limit?: number; level?: string; scope?: string } = {}): DbLogRow[] {
  const clauses: string[] = [];
  const params: any[] = [];
  if (options.level) {
    clauses.push('level = ?');
    params.push(options.level);
  }
  if (options.scope) {
    clauses.push('scope = ?');
    params.push(options.scope);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const stmt = db.prepare(`SELECT * FROM app_logs ${where} ORDER BY id DESC LIMIT ?`);
  return stmt.all(...params, limit) as DbLogRow[];
}

export function countLogs(level?: string): number {
  if (level) {
    const row = db.prepare('SELECT COUNT(*) AS n FROM app_logs WHERE level = ?').get(level) as { n: number };
    return row.n;
  }
  const row = db.prepare('SELECT COUNT(*) AS n FROM app_logs').get() as { n: number };
  return row.n;
}

export function clearLogs(): number {
  return db.prepare('DELETE FROM app_logs').run().changes;
}

// 说明：此处不提供 default 导出。
// better-sqlite3 的 Database 类型在生成 .d.ts 时无法被命名（TS4023），
// 统一以命名导出使用，调用方均通过 `import * as db` 访问。
