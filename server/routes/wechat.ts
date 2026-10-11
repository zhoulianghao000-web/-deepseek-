/**
 * 微信接入路由
 *
 * GET  /wechat  服务器地址校验
 * POST /wechat  接收用户消息并回复
 *
 * 注意：该路由必须挂载在 express.json() 之前，并使用 text 解析以保留原始 XML。
 */
import express from "express";
import { loadSettings } from "../settings.js";
import { getChannel, processInboundMessage } from "../wechat/index.js";
import { officialAccountChannel } from "../wechat/official-account.js";
import logger from "../logger.js";

const router = express.Router();

router.get("/", (req, res) => {
  const settings = loadSettings();
  const channel = getChannel(settings.wechat.channel) ?? officialAccountChannel;
  const result = channel.verify(req.query as Record<string, any>, settings);

  if (!result.ok) {
    logger.warn("wechat", `服务器校验未通过：${result.error}`);
    return res.status(403).type("text/plain").send(result.error || "forbidden");
  }

  logger.info("wechat", "服务器地址校验通过");
  return res.type("text/plain").send(result.echo ?? "");
});

router.post("/", async (req, res) => {
  const settings = loadSettings();
  const channel = getChannel(settings.wechat.channel) ?? officialAccountChannel;
  const rawBody = typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";

  if (!rawBody) {
    return res.send("success");
  }

  const inbound = channel.parse(rawBody, req.query as Record<string, any>, settings);
  if (!inbound) {
    // 签名不通过或报文无法解析：不处理，直接确认收到避免微信重试
    logger.warn("wechat", "消息被丢弃（签名校验失败或报文不可解析）");
    return res.send("success");
  }

  const canPush = channel.canPush(settings);
  const shouldPushAsync = settings.wechat.replyMode === "async" || (settings.wechat.replyMode === "auto" && canPush);

  if (shouldPushAsync) {
    // 先立即确认，避免微信 5 秒超时重试；随后通过客服消息异步下发结果
    res.send("success");
    void (async () => {
      try {
        const result = await processInboundMessage(inbound);
        if (!result.reply || result.kind === "duplicate") return;
        await channel.push(inbound, result.reply, loadSettings());
        logger.info("wechat", `已异步推送回复（${result.provider}/${result.model}，${result.latencyMs}ms）`);
      } catch (error: any) {
        logger.error("wechat", `异步回复失败：${error?.message || String(error)}`);
      }
    })();
    return;
  }

  // 被动回复（同步等待 AI 结果，注意微信 5 秒超时限制）
  try {
    const result = await processInboundMessage(inbound);
    if (!result.reply || result.kind === "duplicate") return res.send("success");
    return res.type("application/xml").send(channel.buildPassiveReply(inbound, result.reply));
  } catch (error: any) {
    logger.error("wechat", `被动回复失败：${error?.message || String(error)}`);
    return res.send("success");
  }
});

export default router;
