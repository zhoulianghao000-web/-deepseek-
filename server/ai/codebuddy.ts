/**
 * CodeBuddy Agent SDK 提供方
 *
 * 使用 query() 发起一次性对话，并关闭全部内置工具（tools: []），
 * 使其表现为纯粹的对话模型；通过 resume 复用 SDK 侧会话上下文。
 */
import { query } from "@tencent-ai/agent-sdk";
import type { AIProvider, ChatRequest, ChatResult, ProviderTestResult } from "./types.js";
import type { AppSettings } from "../settings.js";
import config from "../config.js";

const DEFAULT_MODEL = "claude-sonnet-4";
const DEFAULT_TIMEOUT_MS = 90_000;

/** 把控制台里的凭证同步到进程环境变量（SDK 从环境变量读取认证信息） */
function applyCredentials(settings: AppSettings): void {
  const { codebuddy } = settings;
  if (codebuddy.apiKey) process.env.CODEBUDDY_API_KEY = codebuddy.apiKey;
  if (codebuddy.authToken) process.env.CODEBUDDY_AUTH_TOKEN = codebuddy.authToken;
  if (codebuddy.baseUrl) process.env.CODEBUDDY_BASE_URL = codebuddy.baseUrl;
  if (codebuddy.internetEnv) process.env.CODEBUDDY_INTERNET_ENVIRONMENT = codebuddy.internetEnv;
}

function extractText(message: any): string {
  const content = message?.message?.content ?? message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: any) => block?.type === "text" && typeof block.text === "string")
      .map((block: any) => block.text)
      .join("");
  }
  return "";
}

interface Collected {
  text: string;
  sessionId: string | null;
  error: string | null;
  usage?: Record<string, unknown>;
}

async function runQuery(params: {
  prompt: string;
  settings: AppSettings;
  model: string;
  resumeSessionId?: string | null;
  systemPrompt: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<Collected> {
  applyCredentials(params.settings);

  const collected: Collected = { text: "", sessionId: null, error: null };
  const abortController = new AbortController();
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const onAbort = () => abortController.abort();
  params.signal?.addEventListener("abort", onAbort);
  const timer = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const stream = query({
      prompt: params.prompt,
      options: {
        cwd: config.agentCwd,
        model: params.model,
        maxTurns: 1,
        // 关闭全部内置工具，使 Agent 退化为纯对话模型
        tools: [],
        systemPrompt: params.systemPrompt,
        abortController,
        ...(params.resumeSessionId ? { resume: params.resumeSessionId } : {}),
      },
    });

    for await (const message of stream as AsyncIterable<any>) {
      if (message?.type === "system" && message?.subtype === "init") {
        collected.sessionId = message.session_id ?? null;
      } else if (message?.type === "assistant") {
        collected.text += extractText(message);
      } else if (message?.type === "result") {
        if (message.session_id) collected.sessionId = message.session_id;
        collected.usage = {
          durationMs: message.duration_ms ?? message.duration,
          costUsd: message.total_cost_usd ?? message.cost,
          numTurns: message.num_turns,
        };
        if (message.is_error) {
          collected.error = String(message.result || message.error || "SDK 返回执行错误");
        } else if (!collected.text && typeof message.result === "string") {
          collected.text = message.result;
        }
      } else if (message?.type === "error") {
        collected.error = String(message.message || "SDK 返回错误消息");
      }
    }
  } catch (error: any) {
    if (abortController.signal.aborted && !collected.text) {
      throw new Error(`CodeBuddy 调用超时或已取消（${timeoutMs}ms）`);
    }
    throw new Error(`CodeBuddy 调用失败: ${error?.message || String(error)}`);
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener("abort", onAbort);
  }

  return collected;
}

export const codeBuddyProvider: AIProvider = {
  id: "codebuddy",
  label: "CodeBuddy Agent SDK",
  description: "通过 CodeBuddy Agent SDK 调用托管模型，支持会话续接（resume），工具能力已关闭。",
  supportsSessionResume: true,

  isConfigured(settings: AppSettings): boolean {
    return Boolean(settings.codebuddy.apiKey || settings.codebuddy.authToken);
  },

  configurationHint(): string {
    return "请在「API-Key 配置」中填写 CodeBuddy API Key（或以 CODEBUDDY_API_KEY 环境变量提供），也可先执行 codebuddy login 完成 CLI 登录。";
  },

  async chat(request: ChatRequest, settings: AppSettings, signal?: AbortSignal): Promise<ChatResult> {
    if (!this.isConfigured(settings)) throw new Error(this.configurationHint());

    const startedAt = Date.now();
    const model = request.model || settings.ai.model || DEFAULT_MODEL;
    const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
    if (!lastUser) throw new Error("缺少用户消息");

    const collected = await runQuery({
      prompt: lastUser.content,
      settings,
      model,
      resumeSessionId: request.resumeSessionId,
      systemPrompt: request.systemPrompt,
      signal,
      timeoutMs: request.timeoutMs,
    });

    if (!collected.text && collected.error) throw new Error(collected.error);
    if (!collected.text) throw new Error("CodeBuddy 未返回任何文本内容");

    return {
      text: collected.text,
      model,
      sessionId: collected.sessionId,
      usage: collected.usage,
      latencyMs: Date.now() - startedAt,
    };
  },

  async test(settings: AppSettings): Promise<ProviderTestResult> {
    const startedAt = Date.now();
    if (!this.isConfigured(settings)) {
      return { ok: false, message: this.configurationHint(), latencyMs: 0 };
    }
    try {
      const collected = await runQuery({
        prompt: "ping",
        settings,
        model: settings.ai.model || DEFAULT_MODEL,
        systemPrompt: "无论收到什么，只回复小写字母 pong",
        timeoutMs: 60_000,
      });
      if (!collected.text) {
        return { ok: false, message: collected.error || "未返回文本内容", latencyMs: Date.now() - startedAt };
      }
      return {
        ok: true,
        message: `连接成功（模型 ${settings.ai.model || DEFAULT_MODEL}）`,
        latencyMs: Date.now() - startedAt,
        reply: collected.text.slice(0, 120),
      };
    } catch (error: any) {
      return { ok: false, message: error?.message || String(error), latencyMs: Date.now() - startedAt };
    }
  },
};

export default codeBuddyProvider;
