/**
 * 对话上下文维护
 *
 * 职责：
 * - 按「渠道 + 外部用户 ID」维护唯一会话（微信用户 → 一个会话）
 * - 落库所有收发消息（用于 Web 控制台查看对话记录）
 * - 为无原生会话续接的提供方装配历史消息上下文
 * - 支持重置上下文（清空历史 + 清除 SDK 会话 ID）
 */
import { v4 as uuidv4 } from "uuid";
import * as db from "./db.js";
import type { ChatMessage } from "./ai/types.js";
import logger from "./logger.js";

export interface ConversationRef {
  id: string;
  channel: string;
  externalUserId: string;
  displayName: string | null;
  sdkSessionId: string | null;
  aiProvider: string | null;
  aiModel: string | null;
}

function toRef(row: db.DbWxConversation): ConversationRef {
  return {
    id: row.id,
    channel: row.channel,
    externalUserId: row.external_user_id,
    displayName: row.display_name,
    sdkSessionId: row.sdk_session_id,
    aiProvider: row.ai_provider,
    aiModel: row.ai_model,
  };
}

/** 获取或创建会话 */
export function resolveConversation(channel: string, externalUserId: string, displayName?: string): ConversationRef {
  const existing = db.getWxConversationByExternal(channel, externalUserId);
  if (existing) {
    if (displayName && displayName !== existing.display_name) {
      db.updateWxConversation(existing.id, { display_name: displayName });
      existing.display_name = displayName;
    }
    return toRef(existing);
  }

  const now = new Date().toISOString();
  const created = db.createWxConversation({
    id: uuidv4(),
    channel,
    external_user_id: externalUserId,
    display_name: displayName ?? null,
    ai_provider: null,
    ai_model: null,
    sdk_session_id: null,
    message_count: 0,
    last_message_at: null,
    created_at: now,
    updated_at: now,
  });
  logger.info("conversation", `新建会话 ${created.id}（${channel}/${externalUserId}）`);
  return toRef(created);
}

function touchConversation(conversationId: string, createdAt: string): void {
  const row = db.getWxConversation(conversationId);
  db.updateWxConversation(conversationId, {
    message_count: (row?.message_count ?? 0) + 1,
    last_message_at: createdAt,
  });
}

export interface AppendInboundParams {
  conversationId: string;
  content: string;
  msgType: string;
  raw?: string | null;
}

/** 记录一条用户（入站）消息 */
export function appendInboundMessage(params: AppendInboundParams): db.DbWxMessage {
  const createdAt = new Date().toISOString();
  const message = db.createWxMessage({
    id: uuidv4(),
    conversation_id: params.conversationId,
    direction: "in",
    role: "user",
    content: params.content,
    msg_type: params.msgType,
    provider: null,
    model: null,
    status: "received",
    error: null,
    latency_ms: null,
    raw: params.raw ?? null,
    created_at: createdAt,
  });
  touchConversation(params.conversationId, createdAt);
  return message;
}

export interface AppendOutboundParams {
  conversationId: string;
  content: string;
  provider?: string | null;
  model?: string | null;
  status?: "ok" | "error";
  error?: string | null;
  latencyMs?: number | null;
  role?: "assistant" | "system";
}

/** 记录一条助手（出站）消息 */
export function appendOutboundMessage(params: AppendOutboundParams): db.DbWxMessage {
  const createdAt = new Date().toISOString();
  const message = db.createWxMessage({
    id: uuidv4(),
    conversation_id: params.conversationId,
    direction: "out",
    role: params.role ?? "assistant",
    content: params.content,
    msg_type: "text",
    provider: params.provider ?? null,
    model: params.model ?? null,
    status: params.status ?? "ok",
    error: params.error ?? null,
    latency_ms: params.latencyMs ?? null,
    raw: null,
    created_at: createdAt,
  });
  touchConversation(params.conversationId, createdAt);
  return message;
}

/** 装填用于模型调用的上下文（按时间升序，仅取最近 limit 条） */
export function getContextMessages(conversationId: string, limit: number): ChatMessage[] {
  const rows = db.listWxMessages(conversationId, limit);
  return rows
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map((row) => ({ role: row.role as "user" | "assistant", content: row.content }));
}

/** 重置会话上下文：清空消息并丢弃 SDK 会话 ID */
export function resetConversationContext(conversationId: string): void {
  db.deleteWxMessagesByConversation(conversationId);
  db.updateWxConversation(conversationId, { sdk_session_id: null, message_count: 0 });
  logger.info("conversation", `已重置上下文 ${conversationId}`);
}

/** 更新会话使用的提供方与模型 */
export function updateConversationBinding(conversationId: string, provider: string, model: string, sdkSessionId?: string | null): void {
  const updates: Parameters<typeof db.updateWxConversation>[1] = { ai_provider: provider, ai_model: model };
  if (sdkSessionId !== undefined) updates.sdk_session_id = sdkSessionId;
  db.updateWxConversation(conversationId, updates);
}

export default {
  resolveConversation,
  appendInboundMessage,
  appendOutboundMessage,
  getContextMessages,
  resetConversationContext,
  updateConversationBinding,
};
