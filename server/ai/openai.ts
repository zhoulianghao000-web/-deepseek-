/**
 * OpenAI 兼容提供方
 *
 * 兼容任何暴露 /chat/completions 的服务（OpenAI、DeepSeek、Moonshot、
 * 通义、vLLM、Ollama 等），只需在控制台配置 baseUrl 与 apiKey。
 */
import type { AIProvider, ChatMessage, ChatRequest, ChatResult, ProviderTestResult } from "./types.js";
import type { AppSettings } from "../settings.js";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = (baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  // 兼容用户只填到域名根路径的情况
  if (/\/v\d+$/.test(trimmed) || trimmed.endsWith("/chat/completions")) return trimmed;
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function endpoint(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl);
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
}

function selectMessages(request: ChatRequest): ChatMessage[] {
  const limit = request.maxContextMessages ?? 12;
  const system: ChatMessage[] = [{ role: "system", content: request.systemPrompt }];
  const conversation = request.messages.filter((m) => m.role !== "system");
  const recent = conversation.slice(-Math.max(limit, 1));
  return [...system, ...recent];
}

async function callCompletions(
  request: ChatRequest,
  settings: AppSettings,
  options: { messages: ChatMessage[]; model: string },
  signal?: AbortSignal,
): Promise<{ text: string; model: string; usage?: Record<string, unknown> }> {
  const response = await fetch(endpoint(settings.openai.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.openai.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      temperature: request.temperature ?? settings.ai.temperature,
      stream: false,
    }),
    signal,
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI 兼容接口返回 ${response.status}: ${raw.slice(0, 300)}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`无法解析模型响应: ${raw.slice(0, 200)}`);
  }

  const text = parsed?.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("模型未返回文本内容");
  return { text, model: parsed?.model || options.model, usage: parsed?.usage };
}

export const openAICompatibleProvider: AIProvider = {
  id: "openai",
  label: "OpenAI 兼容服务",
  description: "任何兼容 /chat/completions 的服务（OpenAI、DeepSeek、Moonshot、Ollama、vLLM…）。",
  supportsSessionResume: false,

  isConfigured(settings: AppSettings): boolean {
    return Boolean(settings.openai.apiKey);
  },

  configurationHint(): string {
    return "请在「API-Key 配置」中填写 OpenAI 兼容服务的 API Key 与 Base URL。";
  },

  async chat(request: ChatRequest, settings: AppSettings, signal?: AbortSignal): Promise<ChatResult> {
    if (!settings.openai.apiKey) throw new Error(this.configurationHint());

    const startedAt = Date.now();
    const model = request.model || settings.openai.model || DEFAULT_MODEL;
    const result = await callCompletions(request, settings, { messages: selectMessages(request), model }, signal);

    return {
      text: result.text,
      model: result.model,
      sessionId: null,
      usage: result.usage,
      latencyMs: Date.now() - startedAt,
    };
  },

  async test(settings: AppSettings): Promise<ProviderTestResult> {
    const startedAt = Date.now();
    if (!settings.openai.apiKey) {
      return { ok: false, message: this.configurationHint(), latencyMs: 0 };
    }
    try {
      const model = settings.openai.model || DEFAULT_MODEL;
      const result = await callCompletions(
        { messages: [{ role: "user", content: "ping" }], systemPrompt: "仅回复 pong" },
        settings,
        { messages: [{ role: "user", content: "ping" }], model },
      );
      return {
        ok: true,
        message: `连接成功（模型 ${result.model}）`,
        latencyMs: Date.now() - startedAt,
        reply: result.text.slice(0, 120),
      };
    } catch (error: any) {
      return { ok: false, message: error?.message || String(error), latencyMs: Date.now() - startedAt };
    }
  },
};

export default openAICompatibleProvider;
