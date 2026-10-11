/**
 * Mock 提供方：本地确定性回复，用于零配置联调与自动化验证。
 * 不产生任何外部网络请求，也不消耗额度。
 */
import type { AIProvider, ChatRequest, ChatResult, ProviderTestResult } from "./types.js";
import type { AppSettings } from "../settings.js";

const DEFAULT_MODEL = "mock-chat";

function buildReply(request: ChatRequest): string {
  const history = request.messages.filter((m) => m.role !== "system");
  const lastUser = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const turns = Math.floor(history.filter((m) => m.role === "user").length);

  if (/^(ping|在吗|test|测试)$/i.test(lastUser.trim())) {
    return "pong（Mock 提供方已就绪，配置真实 API-Key 后即可获得真实模型回复）";
  }

  const preview = lastUser.length > 60 ? `${lastUser.slice(0, 60)}…` : lastUser;
  return [
    `【Mock 回复】已收到你的消息：「${preview}」`,
    "",
    `这是第 ${turns} 轮对话，当前携带上下文 ${history.length} 条消息。`,
    "当前使用的是本地 Mock 提供方：链路（微信接收 → 上下文维护 → 回复下发）已验证连通。",
    "在「API-Key 配置」中切换到 CodeBuddy 或 OpenAI 兼容服务后，即可获得真实模型回复。",
  ].join("\n");
}

export const mockProvider: AIProvider = {
  id: "mock",
  label: "Mock（本地模拟）",
  description: "零配置、零网络的本地模拟提供方，用于验证微信接入与上下文维护链路。",
  supportsSessionResume: false,

  isConfigured(): boolean {
    return true;
  },

  configurationHint(): string {
    return "无需配置，直接可用。";
  },

  async chat(request: ChatRequest, _settings: AppSettings, signal?: AbortSignal): Promise<ChatResult> {
    const startedAt = Date.now();
    // 模拟一定的推理耗时，便于观察「处理中」状态
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 120);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("请求已取消"));
      });
    });
    return {
      text: buildReply(request),
      model: request.model || DEFAULT_MODEL,
      sessionId: null,
      latencyMs: Date.now() - startedAt,
    };
  },

  async test(_settings: AppSettings): Promise<ProviderTestResult> {
    const startedAt = Date.now();
    return {
      ok: true,
      message: "Mock 提供方始终可用",
      latencyMs: Date.now() - startedAt,
      reply: "pong",
    };
  },
};

export default mockProvider;
