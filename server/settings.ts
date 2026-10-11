/**
 * 应用配置服务（API-Key 配置与管理的唯一入口）
 *
 * 设计要点：
 * - 全部配置以单个 JSON 文档存放于 SQLite `settings` 表（key = app.settings）；
 * - 首次启动（无落库配置）时从环境变量派生默认值，做到“开箱可用”；
 * - 对外返回一律为「脱敏后的公开视图」，密钥明文永不离开服务端。
 */
import * as db from "./db.js";

export type ReplyMode = "auto" | "passive" | "async";

export interface AppSettings {
  ai: {
    /** 当前使用的 AI 提供方 ID（见 server/ai/index.ts 注册表） */
    provider: string;
    /** 模型 ID；为空时使用提供方默认模型 */
    model: string;
    /** 系统提示词（角色设定） */
    systemPrompt: string;
    /** 上下文携带的历史消息条数上限（无原生会话续接的提供方使用） */
    maxContextMessages: number;
    temperature: number;
  };
  codebuddy: {
    apiKey: string;
    authToken: string;
    baseUrl: string;
    internetEnv: string;
  };
  openai: {
    apiKey: string;
    baseUrl: string;
    /** OpenAI 兼容服务的默认模型 */
    model: string;
  };
  wechat: {
    /** 渠道 ID（见 server/wechat/index.ts 注册表） */
    channel: string;
    /** 服务器配置 Token（用于签名校验） */
    token: string;
    appId: string;
    appSecret: string;
    /** 回复模式：auto=可推送则异步推送，否则被动回复；passive=始终被动回复；async=始终异步推送 */
    replyMode: ReplyMode;
    /** 是否校验签名（本地联调可关闭） */
    signatureCheck: boolean;
    welcomeMessage: string;
    /** 触发上下文重置的关键词，逗号分隔 */
    contextResetKeywords: string;
  };
}

/** 深层可选覆盖：用于调试台的一次性参数覆盖 */
export type SettingsOverride = {
  [K in keyof AppSettings]?: Partial<AppSettings[K]>;
};

export const SETTINGS_KEY = "app.settings";

const DEFAULT_SYSTEM_PROMPT =
  "你是一个通过微信为用户提供服务的 AI 助手。请使用简洁、友好、口语化的中文回答；" +
  "避免使用 Markdown 表格与超长代码块；单条回复尽量控制在 500 字以内。若信息不足，请主动向用户追问。";

/** 默认配置（首次启动时作为基线） */
export const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    provider: "mock",
    model: "",
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    maxContextMessages: 12,
    temperature: 0.7,
  },
  codebuddy: {
    apiKey: "",
    authToken: "",
    baseUrl: "",
    internetEnv: "",
  },
  openai: {
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  wechat: {
    channel: "official_account",
    token: "",
    appId: "",
    appSecret: "",
    replyMode: "auto",
    signatureCheck: true,
    welcomeMessage: "你好，我是 AI 助手，直接发送文字即可开始对话。发送「重置」可清空上下文。",
    contextResetKeywords: "重置,清空,新对话,reset",
  },
};

/** 基于环境变量推导首次启动的默认配置 */
function envDerivedDefaults(): AppSettings {
  const base = structuredClone(DEFAULT_SETTINGS);

  base.codebuddy.apiKey = process.env.CODEBUDDY_API_KEY || "";
  base.codebuddy.authToken = process.env.CODEBUDDY_AUTH_TOKEN || "";
  base.codebuddy.baseUrl = process.env.CODEBUDDY_BASE_URL || "";
  base.codebuddy.internetEnv = process.env.CODEBUDDY_INTERNET_ENVIRONMENT || "";

  base.openai.apiKey = process.env.OPENAI_API_KEY || "";
  base.openai.baseUrl = process.env.OPENAI_BASE_URL || DEFAULT_SETTINGS.openai.baseUrl;
  base.openai.model = process.env.OPENAI_MODEL || DEFAULT_SETTINGS.openai.model;

  base.wechat.token = process.env.WECHAT_TOKEN || "";
  base.wechat.appId = process.env.WECHAT_APP_ID || "";
  base.wechat.appSecret = process.env.WECHAT_APP_SECRET || "";

  // 依据已配置的凭证选择合理的初始提供方
  if (base.codebuddy.apiKey || base.codebuddy.authToken) base.ai.provider = "codebuddy";
  else if (base.openai.apiKey) base.ai.provider = "openai";
  else base.ai.provider = "mock";

  return base;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 深合并：仅覆盖 patch 中显式出现的字段 */
function deepMerge<T>(target: T, patch: unknown): T {
  if (!isPlainObject(patch)) return target;
  if (!isPlainObject(target)) return patch as T;
  const out: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] = isPlainObject(value) && isPlainObject(current) ? deepMerge(current, value) : value;
  }
  return out as T;
}

function normalize(settings: AppSettings): AppSettings {
  const s = structuredClone(settings);
  s.ai.maxContextMessages = Math.min(Math.max(Number(s.ai.maxContextMessages) || 12, 1), 50);
  s.ai.temperature = Math.min(Math.max(Number(s.ai.temperature) ?? 0.7, 0), 2);
  s.ai.provider = String(s.ai.provider || "mock");
  s.ai.model = String(s.ai.model || "");
  s.ai.systemPrompt = String(s.ai.systemPrompt || DEFAULT_SYSTEM_PROMPT);
  s.wechat.replyMode = (["auto", "passive", "async"] as const).includes(s.wechat.replyMode as ReplyMode)
    ? s.wechat.replyMode
    : "auto";
  s.wechat.signatureCheck = Boolean(s.wechat.signatureCheck);
  return s;
}

/**
 * 以已有配置为基线应用一份补丁（深合并 + 规整）。
 * 用于调试台的一次性参数覆盖：只影响本次调用，不落库。
 */
export function mergeSettings(base: AppSettings, patch: SettingsOverride): AppSettings {
  return normalize(deepMerge(base, patch));
}

/** 读取配置（不存在时写入环境变量派生的默认值） */
export function loadSettings(): AppSettings {
  try {
    const raw = db.getSetting(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      return normalize(deepMerge(envDerivedDefaults(), parsed) as AppSettings);
    }
  } catch {
    // 配置损坏时退回默认值
  }
  const defaults = envDerivedDefaults();
  try {
    db.setSetting(SETTINGS_KEY, JSON.stringify(defaults));
  } catch {
    // 写库失败不阻塞
  }
  return defaults;
}

export interface SettingsPatch {
  ai?: Partial<AppSettings["ai"]>;
  codebuddy?: Partial<AppSettings["codebuddy"]>;
  openai?: Partial<AppSettings["openai"]>;
  wechat?: Partial<AppSettings["wechat"]>;
  /** 需要清空的字段路径，如 ["codebuddy.apiKey"] */
  clear?: string[];
}

/** 保存配置补丁并返回最新配置 */
export function saveSettings(patch: SettingsPatch): AppSettings {
  const current = loadSettings();
  const merged = deepMerge(current, {
    ai: patch.ai,
    codebuddy: patch.codebuddy,
    openai: patch.openai,
    wechat: patch.wechat,
  });

  // 「空字符串表示不修改」仅作用于密钥类字段，避免前端回填脱敏值导致密钥被覆盖
  for (const section of ["codebuddy", "openai", "wechat"] as const) {
    const source = patch[section] as Record<string, unknown> | undefined;
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value === "" && SECRET_FIELDS.has(`${section}.${key}`)) {
        (merged[section] as Record<string, unknown>)[key] = (current[section] as Record<string, unknown>)[key];
      }
    }
  }

  for (const path of patch.clear || []) {
    const [section, field] = path.split(".");
    if (section && field && section in merged) {
      (merged[section as keyof AppSettings] as Record<string, unknown>)[field] = "";
    }
  }

  const next = normalize(merged);
  db.setSetting(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

const SECRET_FIELDS = new Set([
  "codebuddy.apiKey",
  "codebuddy.authToken",
  "openai.apiKey",
  "wechat.token",
  "wechat.appSecret",
]);

function mask(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

/** 对外公开（脱敏）的配置视图 */
export interface PublicSettings {
  ai: AppSettings["ai"];
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

export function toPublicSettings(settings: AppSettings): PublicSettings {
  return {
    ai: { ...settings.ai },
    codebuddy: {
      hasApiKey: Boolean(settings.codebuddy.apiKey),
      apiKeyMasked: mask(settings.codebuddy.apiKey),
      hasAuthToken: Boolean(settings.codebuddy.authToken),
      authTokenMasked: mask(settings.codebuddy.authToken),
      baseUrl: settings.codebuddy.baseUrl,
      internetEnv: settings.codebuddy.internetEnv,
    },
    openai: {
      hasApiKey: Boolean(settings.openai.apiKey),
      apiKeyMasked: mask(settings.openai.apiKey),
      baseUrl: settings.openai.baseUrl,
      model: settings.openai.model,
    },
    wechat: {
      channel: settings.wechat.channel,
      hasToken: Boolean(settings.wechat.token),
      tokenMasked: mask(settings.wechat.token),
      appId: settings.wechat.appId,
      hasAppSecret: Boolean(settings.wechat.appSecret),
      appSecretMasked: mask(settings.wechat.appSecret),
      replyMode: settings.wechat.replyMode,
      signatureCheck: settings.wechat.signatureCheck,
      welcomeMessage: settings.wechat.welcomeMessage,
      contextResetKeywords: settings.wechat.contextResetKeywords,
    },
  };
}

export default { loadSettings, saveSettings, toPublicSettings, DEFAULT_SETTINGS };
