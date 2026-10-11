/**
 * AI 提供方抽象层类型定义
 *
 * 扩展方式：新增一个实现 AIProvider 的模块，并在 server/ai/index.ts 注册。
 */
import type { AppSettings } from "../settings.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  /** 完整上下文（含 system 与最新一条 user 消息） */
  messages: ChatMessage[];
  /** 系统提示词 */
  systemPrompt: string;
  /** 模型 ID（空则用提供方默认） */
  model?: string;
  /**
   * 已有会话 ID。支持原生会话续接的提供方（CodeBuddy）会用它恢复上下文，
   * 并可在返回值中给出新的会话 ID。
   */
  resumeSessionId?: string | null;
  temperature?: number;
  /** 无原生会话续接时保留的历史条数 */
  maxContextMessages?: number;
  /** 超时（毫秒） */
  timeoutMs?: number;
}

export interface ChatResult {
  text: string;
  model: string;
  /** 提供方返回的会话 ID（用于下一次续接） */
  sessionId?: string | null;
  usage?: Record<string, unknown>;
  latencyMs: number;
}

export interface ProviderTestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
  reply?: string;
}

export interface AIProvider {
  /** 唯一 ID，如 codebuddy / openai / mock */
  id: string;
  /** 展示名 */
  label: string;
  /** 能力说明，用于控制台展示 */
  description: string;
  /** 是否支持原生会话续接（决定是否需要服务端维护历史上下文） */
  supportsSessionResume: boolean;
  /** 是否已完成调用所需的配置 */
  isConfigured(settings: AppSettings): boolean;
  /** 配置缺失时的提示 */
  configurationHint(): string;
  /** 发起一次对话 */
  chat(request: ChatRequest, settings: AppSettings, signal?: AbortSignal): Promise<ChatResult>;
  /** 连通性自检 */
  test(settings: AppSettings): Promise<ProviderTestResult>;
}
