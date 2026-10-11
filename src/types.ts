/**
 * 前端类型定义（与 server/routes/admin.ts 返回结构保持一致）
 */

export type Theme = 'light' | 'dark';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'all';

export type ReplyMode = 'auto' | 'passive' | 'async';

export interface ProviderInfo {
  id: string;
  label: string;
  description: string;
  supportsSessionResume: boolean;
  configured: boolean;
  configurationHint: string;
  active: boolean;
}

export interface ChannelInfo {
  id: string;
  label: string;
  description: string;
}

export interface PublicSettings {
  ai: {
    provider: string;
    model: string;
    systemPrompt: string;
    maxContextMessages: number;
    temperature: number;
  };
  codebuddy: {
    hasApiKey: boolean;
    apiKeyMasked: string;
    hasAuthToken: boolean;
    authTokenMasked: string;
    baseUrl: string;
    internetEnv: string;
  };
  openai: {
    hasApiKey: boolean;
    apiKeyMasked: string;
    baseUrl: string;
    model: string;
  };
  wechat: {
    channel: string;
    hasToken: boolean;
    tokenMasked: string;
    appId: string;
    hasAppSecret: boolean;
    appSecretMasked: string;
    replyMode: ReplyMode;
    signatureCheck: boolean;
    welcomeMessage: string;
    contextResetKeywords: string;
  };
}

export interface LogRow {
  id: number;
  level: string;
  scope: string | null;
  message: string;
  detail: string | null;
  created_at: string;
}

export interface ConversationRow {
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
  last_message?: string | null;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  direction: 'in' | 'out';
  role: string;
  content: string;
  msg_type: string | null;
  provider: string | null;
  model: string | null;
  status: string | null;
  error: string | null;
  latency_ms: number | null;
  created_at: string;
}

export interface Overview {
  server: {
    name: string;
    uptimeSec: number;
    startedAt: string;
    node: string;
    pid: number;
    port: number;
    adminTokenEnabled: boolean;
  };
  ai: {
    provider: string;
    providerLabel: string;
    model: string;
    effectiveProvider: string;
    effectiveProviderLabel: string;
    fallback: boolean;
    fallbackReason?: string;
    contextWindow: number;
    temperature: number;
    providers: ProviderInfo[];
  };
  wechat: {
    channel: string;
    channelLabel: string;
    endpoint: string;
    /** 对外可访问的完整接入地址（由服务端根据 PUBLIC_BASE_URL / 请求 Host 推导） */
    url: string;
    configured: boolean;
    signatureCheck: boolean;
    replyMode: ReplyMode;
    canPush: boolean;
    appId: string;
  };
  channels: ChannelInfo[];
  stats: {
    conversations: number;
    messages: number;
    inbound: number;
    outbound: number;
    messages24h: number;
    errors: number;
  };
  recentConversations: ConversationRow[];
  recentLogs: LogRow[];
}

/** 处理管线中的一个阶段（调试台用于可视化追踪） */
export interface TraceStep {
  step: string;
  label: string;
  detail?: string;
  durationMs: number;
  ok: boolean;
}

/** 调试调用的请求快照 */
export interface PlaygroundRequestSnapshot {
  method: string;
  url: string;
  at: string;
  payload: Record<string, unknown>;
}

export interface PlaygroundResult {
  conversationId: string;
  reply: string;
  provider: string;
  model: string;
  latencyMs: number;
  kind: string;
  fallback?: boolean;
  fallbackReason?: string;
  error?: string;
  /** 各阶段追踪 */
  trace?: TraceStep[];
  /** 请求快照 */
  request?: PlaygroundRequestSnapshot;
  /** 服务端整体耗时 */
  totalMs?: number;
}

/** 调试调用可传入的一次性参数覆盖（不落库） */
export interface DebugOverrides {
  provider?: string;
  model?: string;
  systemPrompt?: string;
  maxContextMessages?: number;
  temperature?: number;
}

export interface ProviderTestResult {
  provider: string;
  ok: boolean;
  message: string;
  latencyMs: number;
  reply?: string;
}
