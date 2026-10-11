/**
 * 管理后台 API
 *
 * 覆盖：运行状态监控、API-Key / AI 服务配置、微信接入配置、对话记录、日志、消息调试。
 * 所有接口均不返回任何密钥明文。
 */
import express from "express";
import * as db from "../db.js";
import config from "../config.js";
import logger from "../logger.js";
import { loadSettings, saveSettings, toPublicSettings, type SettingsPatch, type SettingsOverride, type AppSettings } from "../settings.js";
import { listProviders, resolveProvider, getProvider } from "../ai/index.js";
import { getWeChatRuntimeStatus, listChannels, processInboundMessage, createSyntheticInbound } from "../wechat/index.js";
import { clearAccessTokenCache } from "../wechat/official-account.js";

const router = express.Router();

/** 可选的管理令牌守卫：仅当配置了 ADMIN_TOKEN 时生效 */
router.use((req, res, next) => {
  if (!config.adminToken) return next();
  const token = req.header("x-admin-token") || "";
  if (token !== config.adminToken) {
    return res.status(401).json({ error: "管理令牌无效，请在控制台右上角配置正确的 x-admin-token" });
  }
  next();
});

function buildOverview(settings: AppSettings, req: express.Request) {
  const resolution = resolveProvider(settings);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const wechat = getWeChatRuntimeStatus(settings);
  const baseUrl = config.publicBaseUrl || `${req.protocol}://${req.get("host")}`;

  return {
    server: {
      name: "微信 AI 接入网关",
      uptimeSec: Math.round(process.uptime()),
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      node: process.version,
      pid: process.pid,
      port: config.port,
      adminTokenEnabled: Boolean(config.adminToken),
    },
    ai: {
      provider: settings.ai.provider,
      providerLabel: getProvider(settings.ai.provider)?.label ?? settings.ai.provider,
      model: settings.ai.model || "（提供方默认）",
      effectiveProvider: resolution.provider.id,
      effectiveProviderLabel: resolution.provider.label,
      fallback: resolution.fallback,
      fallbackReason: resolution.reason,
      contextWindow: settings.ai.maxContextMessages,
      temperature: settings.ai.temperature,
      providers: listProviders(settings),
    },
    wechat: { ...wechat, url: `${baseUrl}${wechat.endpoint}` },
    channels: listChannels(),
    stats: {
      conversations: db.countWxConversations(),
      messages: db.countWxMessages(),
      inbound: db.countWxMessages("in"),
      outbound: db.countWxMessages("out"),
      messages24h: db.countWxMessages(undefined, since24h),
      errors: db.countLogs("error"),
    },
    recentConversations: db.listWxConversations({ limit: 6 }),
    recentLogs: db.listLogs({ limit: 20 }),
  };
}

// ============= 运行状态 =============

router.get("/overview", (req, res) => {
  try {
    res.json(buildOverview(loadSettings(), req));
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取运行状态失败" });
  }
});

// ============= 配置（API-Key） =============

router.get("/settings", (_req, res) => {
  const settings = loadSettings();
  res.json({ settings: toPublicSettings(settings), providers: listProviders(settings), channels: listChannels() });
});

router.put("/settings", (req, res) => {
  try {
    const patch = (req.body || {}) as SettingsPatch;
    const next = saveSettings(patch);
    clearAccessTokenCache();
    logger.info("settings", "配置已更新", {
      provider: next.ai.provider,
      model: next.ai.model,
      wechatChannel: next.wechat.channel,
      replyMode: next.wechat.replyMode,
    });
    res.json({ settings: toPublicSettings(next), providers: listProviders(next) });
  } catch (error: any) {
    logger.error("settings", `配置更新失败：${error?.message || String(error)}`);
    res.status(400).json({ error: error?.message || "配置更新失败" });
  }
});

router.post("/settings/test", async (req, res) => {
  try {
    const settings = loadSettings();
    const providerId = String(req.body?.provider || settings.ai.provider);
    const provider = getProvider(providerId);
    if (!provider) return res.status(400).json({ error: `未知提供方：${providerId}` });

    const result = await provider.test(settings);
    logger.info("settings", `连通性测试 ${providerId}: ${result.ok ? "通过" : "失败"} - ${result.message}`);
    res.json({ provider: providerId, ...result });
  } catch (error: any) {
    res.status(500).json({ ok: false, message: error?.message || String(error) });
  }
});

// ============= 对话记录 =============

router.get("/conversations", (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const keyword = typeof req.query.q === "string" ? req.query.q : undefined;
    const items = db.listWxConversations({ limit, offset, keyword });
    res.json({ total: db.countWxConversations(), items });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取对话列表失败" });
  }
});

router.get("/conversations/:id", (req, res) => {
  try {
    const conversation = db.getWxConversation(req.params.id);
    if (!conversation) return res.status(404).json({ error: "会话不存在" });
    const limit = Number(req.query.limit) || 200;
    res.json({ conversation, messages: db.listWxMessages(conversation.id, limit) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取对话详情失败" });
  }
});

router.post("/conversations/:id/reset", (req, res) => {
  try {
    const conversation = db.getWxConversation(req.params.id);
    if (!conversation) return res.status(404).json({ error: "会话不存在" });
    db.deleteWxMessagesByConversation(conversation.id);
    db.updateWxConversation(conversation.id, { sdk_session_id: null, message_count: 0 });
    logger.info("admin", `已重置会话上下文 ${conversation.id}`);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "重置失败" });
  }
});

router.delete("/conversations/:id", (req, res) => {
  try {
    const success = db.deleteWxConversation(req.params.id);
    if (!success) return res.status(404).json({ error: "会话不存在" });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "删除失败" });
  }
});

router.delete("/conversations", (_req, res) => {
  const removed = db.clearWxConversations();
  logger.info("admin", `已清空全部对话（${removed} 个会话）`);
  res.json({ success: true, removed });
});

// ============= 日志 =============

router.get("/logs", (req, res) => {
  try {
    const limit = Number(req.query.limit) || 100;
    const level = typeof req.query.level === "string" && req.query.level !== "all" ? req.query.level : undefined;
    res.json({ items: db.listLogs({ limit, level }), total: db.countLogs() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取日志失败" });
  }
});

router.delete("/logs", (_req, res) => {
  const removed = db.clearLogs();
  res.json({ success: true, removed });
});

// ============= 调试台：模拟微信入站消息，走完整管线 =============

/**
 * 支持一次性参数覆盖（provider / model / systemPrompt / maxContextMessages / temperature），
 * 覆盖仅作用于本次调用、不写入数据库，便于在调试台中实时对比不同参数的效果。
 */
router.post("/playground", async (req, res) => {
  const startedAt = Date.now();
  try {
    const body = req.body || {};
    const text = String(body.text ?? "").trim();
    if (!text) return res.status(400).json({ error: "请输入要发送的内容" });

    const settings = loadSettings();
    const channelId = String(body.channel || settings.wechat.channel);
    const externalUserId = String(body.externalUserId || "playground-user");

    const aiOverride: Partial<AppSettings["ai"]> = {};
    if (body.provider) aiOverride.provider = String(body.provider);
    if (typeof body.model === "string") aiOverride.model = body.model;
    if (typeof body.systemPrompt === "string" && body.systemPrompt.trim()) aiOverride.systemPrompt = body.systemPrompt;
    if (body.maxContextMessages != null && Number.isFinite(Number(body.maxContextMessages))) {
      aiOverride.maxContextMessages = Number(body.maxContextMessages);
    }
    if (body.temperature != null && Number.isFinite(Number(body.temperature))) {
      aiOverride.temperature = Number(body.temperature);
    }

    const override: SettingsOverride = {};
    if (Object.keys(aiOverride).length > 0) override.ai = aiOverride;

    const inbound = createSyntheticInbound(channelId, externalUserId, text);
    const result = await processInboundMessage(inbound, {
      settingsOverride: Object.keys(override).length > 0 ? override : undefined,
      providerOverride: aiOverride.provider,
      modelOverride: typeof body.model === "string" ? body.model : undefined,
    });

    res.json({
      ...result,
      request: {
        method: "POST",
        url: "/api/admin/playground",
        at: new Date().toISOString(),
        payload: {
          text,
          externalUserId,
          channel: channelId,
          ...(Object.keys(aiOverride).length > 0 ? { aiOverride } : {}),
        },
      },
      totalMs: Date.now() - startedAt,
    });
  } catch (error: any) {
    logger.error("playground", `调试调用失败：${error?.message || String(error)}`);
    res.status(500).json({ error: error?.message || "调试调用失败", totalMs: Date.now() - startedAt });
  }
});

export default router;
