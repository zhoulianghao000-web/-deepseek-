/**
 * 微信渠道注册表 + 统一消息处理管线
 *
 * 管线（与渠道解耦）：
 *   入站消息 → 去重 → 会话解析 → 指令处理 → 上下文装配 → 调用 AI → 落库 → 返回回复
 */
import { v4 as uuidv4 } from "uuid";
import type { AppSettings, SettingsOverride } from "../settings.js";
import { loadSettings, mergeSettings } from "../settings.js";
import { resolveProvider, getProvider } from "../ai/index.js";
import {
  appendInboundMessage,
  appendOutboundMessage,
  getContextMessages,
  resetConversationContext,
  resolveConversation,
  updateConversationBinding,
} from "../conversation.js";
import logger from "../logger.js";
import { officialAccountChannel } from "./official-account.js";
import type { InboundMessage, WeChatChannel } from "./types.js";

/** 已注册的渠道（扩展点：在此追加新渠道实现） */
export const channels: WeChatChannel[] = [officialAccountChannel];

const registry = new Map(channels.map((channel) => [channel.id, channel]));

export function getChannel(id: string): WeChatChannel | undefined {
  return registry.get(id);
}

export function listChannels() {
  return channels.map((channel) => ({
    id: channel.id,
    label: channel.label,
    description: channel.description,
  }));
}

export type ProcessKind = "reply" | "welcome" | "reset" | "help" | "unsupported" | "error" | "ignored" | "duplicate";

/** 管线追踪：每一步的名称、细节、耗时与成功状态（供调试台可视化） */
export interface TraceStep {
  step: string;
  label: string;
  detail?: string;
  durationMs: number;
  ok: boolean;
}

export interface ProcessResult {
  conversationId: string;
  reply: string;
  provider: string;
  model: string;
  latencyMs: number;
  kind: ProcessKind;
  fallback?: boolean;
  fallbackReason?: string;
  error?: string;
  /** 处理管线各阶段追踪（调试台使用） */
  trace?: TraceStep[];
}

/** 一次性调用参数（调试台实时调整用，均不落库） */
export interface ProcessOptions {
  /** 配置覆盖：与当前配置深合并 */
  settingsOverride?: SettingsOverride;
  /** 强制指定提供方：即使未完成配置也直接调用，便于暴露真实错误 */
  providerOverride?: string;
  /** 强制指定模型 */
  modelOverride?: string;
}

const HELP_TEXT = [
  "可用指令：",
  "· 直接发送文字即可与 AI 对话",
  "· 发送「重置」清空当前对话上下文",
  "· 发送「帮助」查看本说明",
].join("\n");

// ---------- 消息去重（微信在超时时会重试推送） ----------

const DEDUPE_TTL_MS = 5 * 60 * 1000;
const DEDUPE_MAX_SIZE = 2000;
const recentKeys = new Map<string, number>();

function isDuplicate(key?: string): boolean {
  if (!key) return false;
  const now = Date.now();
  if (recentKeys.size > DEDUPE_MAX_SIZE) {
    recentKeys.forEach((ts, k) => {
      if (now - ts > DEDUPE_TTL_MS) recentKeys.delete(k);
    });
  }
  const last = recentKeys.get(key);
  if (last && now - last < DEDUPE_TTL_MS) return true;
  recentKeys.set(key, now);
  return false;
}

function parseResetKeywords(settings: AppSettings): string[] {
  return (settings.wechat.contextResetKeywords || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/** 构造一条本地模拟的入站消息（供控制台「消息调试」使用） */
export function createSyntheticInbound(channelId: string, externalUserId: string, text: string): InboundMessage {
  const channel = registry.get(channelId) ?? officialAccountChannel;
  const stamp = Date.now();
  return {
    channel: channel.id,
    externalUserId,
    displayName: externalUserId,
    msgType: "text",
    content: text,
    fromUser: externalUserId,
    toUser: "gh_simulator",
    createTime: Math.floor(stamp / 1000),
    raw: `[simulated] ${text.slice(0, 500)}`,
    dedupeKey: `simulate:${uuidv4()}`,
  };
}

/**
 * 处理一条入站消息并返回回复内容。
 * 该函数是「微信接入」与「AI 对话」的唯一汇合点，WeChat 路由与控制台调试都走这里。
 */
export async function processInboundMessage(inbound: InboundMessage, options: ProcessOptions = {}): Promise<ProcessResult> {
  const settings = options.settingsOverride ? mergeSettings(loadSettings(), options.settingsOverride) : loadSettings();

  // 管线追踪：记录各阶段耗时与结果，便于调试台观察
  const trace: TraceStep[] = [];
  let lastAt = Date.now();
  const mark = (step: string, label: string, detail?: string, ok = true) => {
    const now = Date.now();
    trace.push({ step, label, detail, durationMs: now - lastAt, ok });
    lastAt = now;
  };

  const conversation = resolveConversation(inbound.channel, inbound.externalUserId, inbound.displayName);

  if (isDuplicate(inbound.dedupeKey)) {
    mark("dedupe", "重复检测", `命中重复键，已忽略：${inbound.dedupeKey}`, false);
    logger.info("wechat", `重复消息已忽略（${inbound.dedupeKey}）`);
    return { conversationId: conversation.id, reply: "", provider: "-", model: "-", latencyMs: 0, kind: "duplicate", trace };
  }
  mark("dedupe", "重复检测", "未命中重复键，继续处理");
  mark("conversation", "会话解析", `${inbound.channel} / ${inbound.externalUserId} → 会话 ${conversation.id.slice(0, 8)}`);

  const startedAt = Date.now();

  // 关注事件 → 欢迎语
  if (inbound.msgType === "event" && (inbound.event === "subscribe" || inbound.event === "SCAN")) {
    mark("intent", "意图识别", `关注/扫码事件（${inbound.event}）`);
    const reply = settings.wechat.welcomeMessage || "你好，我是 AI 助手，直接发送文字开始对话。";
    appendOutboundMessage({ conversationId: conversation.id, content: reply, role: "system" });
    mark("persist", "消息落库", "欢迎语已写入会话记录");
    return { conversationId: conversation.id, reply, provider: "-", model: "-", latencyMs: Date.now() - startedAt, kind: "welcome", trace };
  }

  // 非文本消息（当前版本仅处理文本）
  if (inbound.msgType !== "text") {
    mark("intent", "意图识别", `非文本消息（${inbound.msgType}），走兜底提示`);
    const reply = "我目前只能理解文字消息，请用文字描述你的问题～";
    appendInboundMessage({ conversationId: conversation.id, content: inbound.content, msgType: inbound.msgType, raw: inbound.raw });
    appendOutboundMessage({ conversationId: conversation.id, content: reply, status: "ok" });
    mark("persist", "消息落库", "入站 + 出站已写入会话记录");
    return { conversationId: conversation.id, reply, provider: "-", model: "-", latencyMs: Date.now() - startedAt, kind: "unsupported", trace };
  }

  const text = (inbound.content || "").trim();
  const resetKeywords = parseResetKeywords(settings);

  // 重置指令
  if (resetKeywords.includes(text.toLowerCase())) {
    mark("intent", "意图识别", `命中重置关键词「${text}」`);
    appendInboundMessage({ conversationId: conversation.id, content: text, msgType: "text", raw: inbound.raw });
    resetConversationContext(conversation.id);
    const reply = "上下文已清空，我们可以重新开始对话了。";
    appendOutboundMessage({ conversationId: conversation.id, content: reply, role: "system" });
    mark("persist", "消息落库", "上下文已重置，历史消息已清空");
    return { conversationId: conversation.id, reply, provider: "-", model: "-", latencyMs: Date.now() - startedAt, kind: "reset", trace };
  }

  // 帮助指令
  if (["帮助", "help", "?", "？"].includes(text.toLowerCase())) {
    mark("intent", "意图识别", "命中帮助关键词");
    appendInboundMessage({ conversationId: conversation.id, content: text, msgType: "text", raw: inbound.raw });
    appendOutboundMessage({ conversationId: conversation.id, content: HELP_TEXT, role: "system" });
    mark("persist", "消息落库", "帮助说明已写入会话记录");
    return { conversationId: conversation.id, reply: HELP_TEXT, provider: "-", model: "-", latencyMs: Date.now() - startedAt, kind: "help", trace };
  }

  if (!text) {
    mark("intent", "意图识别", "空内容，直接忽略", false);
    return { conversationId: conversation.id, reply: "请发送文字内容～", provider: "-", model: "-", latencyMs: Date.now() - startedAt, kind: "ignored", trace };
  }

  mark("intent", "意图识别", "普通文本对话");

  // 记录入站消息
  appendInboundMessage({ conversationId: conversation.id, content: text, msgType: "text", raw: inbound.raw });

  // 选择提供方：显式指定时不做回退（便于调试台暴露真实错误）；否则未配置自动回退到 Mock
  const forced = options.providerOverride ? getProvider(options.providerOverride) : undefined;
  const resolution = forced
    ? {
        provider: forced,
        fallback: !forced.isConfigured(settings),
        reason: forced.isConfigured(settings) ? undefined : `${forced.label} 未完成配置，已按调试要求直接调用`,
      }
    : resolveProvider(settings);
  const provider = resolution.provider;
  const model = options.modelOverride ?? (settings.ai.model || "");

  if (resolution.fallback && resolution.reason) {
    logger.warn("ai", `提供方未就绪：${resolution.reason}`);
  }

  const contextLimit = settings.ai.maxContextMessages;
  const context = getContextMessages(conversation.id, contextLimit);
  mark(
    "context",
    "上下文装填",
    `${context.length} 条历史消息（窗口上限 ${contextLimit} 条）${conversation.sdkSessionId ? " · 已绑定 SDK 会话" : ""}`,
  );
  mark(
    "provider",
    "提供方选择",
    `${provider.label}（${provider.id}）${resolution.fallback ? ` · ${resolution.reason}` : ""}`,
    !resolution.fallback,
  );

  try {
    const result = await provider.chat(
      {
        messages: context,
        systemPrompt: settings.ai.systemPrompt,
        model: model || undefined,
        resumeSessionId: conversation.sdkSessionId,
        temperature: settings.ai.temperature,
        maxContextMessages: contextLimit,
      },
      settings,
    );
    mark("ai", "AI 调用", `${result.model} · ${result.latencyMs}ms · 输出 ${result.text.length} 字`);

    updateConversationBinding(conversation.id, provider.id, result.model, provider.supportsSessionResume ? result.sessionId ?? null : null);
    appendOutboundMessage({
      conversationId: conversation.id,
      content: result.text,
      provider: provider.id,
      model: result.model,
      status: "ok",
      latencyMs: result.latencyMs,
    });
    mark("persist", "消息落库", "入站 + 出站已写入会话记录");

    return {
      conversationId: conversation.id,
      reply: result.text,
      provider: provider.id,
      model: result.model,
      latencyMs: result.latencyMs,
      kind: "reply",
      fallback: resolution.fallback,
      fallbackReason: resolution.reason,
      trace,
    };
  } catch (error: any) {
    const message = error?.message || String(error);
    mark("ai", "AI 调用", message, false);
    logger.error("ai", `对话失败：${message}`, { provider: provider.id, model });
    const reply = `抱歉，AI 服务暂时不可用（${message.slice(0, 120)}）。请稍后重试或联系管理员。`;
    appendOutboundMessage({
      conversationId: conversation.id,
      content: reply,
      provider: provider.id,
      model,
      status: "error",
      error: message,
      latencyMs: Date.now() - startedAt,
    });
    mark("persist", "消息落库", "错误回复已写入会话记录", false);

    return {
      conversationId: conversation.id,
      reply,
      provider: provider.id,
      model,
      latencyMs: Date.now() - startedAt,
      kind: "error",
      error: message,
      trace,
    };
  }
}

/** 运行状态摘要（供控制台） */
export function getWeChatRuntimeStatus(settings: AppSettings) {
  const channel = getChannel(settings.wechat.channel) ?? officialAccountChannel;
  return {
    channel: channel.id,
    channelLabel: channel.label,
    endpoint: "/wechat",
    configured: channel.isConfigured(settings),
    signatureCheck: settings.wechat.signatureCheck,
    replyMode: settings.wechat.replyMode,
    canPush: channel.canPush(settings),
    appId: settings.wechat.appId || "",
  };
}

export * from "./types.js";
export { officialAccountChannel };
export { getProvider };
