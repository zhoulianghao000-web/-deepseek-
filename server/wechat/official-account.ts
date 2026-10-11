/**
 * 微信公众号渠道实现
 *
 * - 服务器地址校验（GET 签名校验）
 * - 消息接收（POST XML，含签名校验）
 * - 被动回复（同步返回 XML）
 * - 客服消息推送（异步回复，需要 appId/appSecret）
 *
 * 说明：当前实现面向「明文模式」，加密模式（EncodingAESKey）留作扩展点。
 */
import type { AppSettings } from "../settings.js";
import type { InboundMessage, InboundMsgType, VerifyResult, WeChatChannel } from "./types.js";
import { buildTextReplyXml, computeSignature, parseWeChatXml, safeEqual, truncateForWeChat, PASSIVE_REPLY_MAX_CHARS, PUSH_TEXT_MAX_CHARS } from "./xml.js";
import logger from "../logger.js";

const API_BASE = "https://api.weixin.qq.com";

const MSG_TYPE_MAP: Record<string, InboundMsgType> = {
  text: "text",
  image: "image",
  voice: "voice",
  video: "video",
  shortvideo: "video",
  location: "location",
  link: "link",
  event: "event",
};

/** access_token 内存缓存 */
let tokenCache: { token: string; expiresAt: number; appId: string } | null = null;

export function clearAccessTokenCache(): void {
  tokenCache = null;
}

async function getAccessToken(settings: AppSettings): Promise<string> {
  const { appId, appSecret } = settings.wechat;
  if (!appId || !appSecret) throw new Error("缺少 appId / appSecret，无法推送客服消息");

  if (tokenCache && tokenCache.appId === appId && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  const url = `${API_BASE}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const response = await fetch(url);
  const data = (await response.json()) as any;
  if (!data?.access_token) {
    throw new Error(`获取 access_token 失败: ${JSON.stringify(data).slice(0, 200)}`);
  }
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 7200) * 1000,
    appId,
  };
  return tokenCache.token;
}

function signatureOk(query: Record<string, any>, settings: AppSettings): { ok: boolean; error?: string } {
  if (!settings.wechat.signatureCheck) return { ok: true };

  const token = settings.wechat.token;
  if (!token) return { ok: false, error: "尚未配置 Token，无法校验签名" };

  const signature = String(query.signature ?? "");
  const timestamp = String(query.timestamp ?? "");
  const nonce = String(query.nonce ?? "");
  if (!signature || !timestamp || !nonce) return { ok: false, error: "缺少签名参数" };

  const expected = computeSignature(token, timestamp, nonce);
  if (!safeEqual(expected, signature)) return { ok: false, error: "签名校验失败" };
  return { ok: true };
}

function pickContent(parsed: Record<string, string>, msgType: InboundMsgType): string {
  switch (msgType) {
    case "text":
      return parsed.Content ?? "";
    case "image":
      return parsed.PicUrl ? `[图片] ${parsed.PicUrl}` : "[图片]";
    case "voice":
      return parsed.Recognition ? `[语音] ${parsed.Recognition}` : "[语音]";
    case "video":
      return "[视频]";
    case "location":
      return `[位置] ${parsed.Label ?? ""} ${parsed.Location_X ?? ""},${parsed.Location_Y ?? ""}`.trim();
    case "link":
      return `[链接] ${parsed.Title ?? ""} ${parsed.Url ?? ""}`.trim();
    case "event":
      return parsed.Event ?? "event";
    default:
      return "[不支持的消息类型]";
  }
}

export const officialAccountChannel: WeChatChannel = {
  id: "official_account",
  label: "微信公众号",
  description: "通过公众号服务器配置接收用户消息，支持被动回复与客服消息推送。",

  isConfigured(settings: AppSettings): boolean {
    return Boolean(settings.wechat.token);
  },

  verify(query: Record<string, any>, settings: AppSettings): VerifyResult {
    const check = signatureOk(query, settings);
    if (!check.ok) return { ok: false, error: check.error };
    const echo = String(query.echostr ?? "");
    if (!echo) return { ok: false, error: "缺少 echostr 参数" };
    return { ok: true, echo };
  },

  parse(rawBody: string, query: Record<string, any>, settings: AppSettings): InboundMessage | null {
    const check = signatureOk(query, settings);
    if (!check.ok) {
      logger.warn("wechat", `拒绝消息：${check.error}`, { signature: query.signature });
      return null;
    }

    const parsed = parseWeChatXml(rawBody);
    const fromUser = parsed.FromUserName;
    if (!fromUser) {
      logger.warn("wechat", "无法解析消息：缺少 FromUserName");
      return null;
    }

    const rawType = (parsed.MsgType || "").toLowerCase();
    const msgType = MSG_TYPE_MAP[rawType] ?? "unsupported";

    return {
      channel: this.id,
      externalUserId: fromUser,
      displayName: parsed.FromUserName,
      msgType,
      content: pickContent(parsed, msgType),
      event: parsed.Event,
      eventKey: parsed.EventKey,
      msgId: parsed.MsgId,
      toUser: parsed.ToUserName,
      fromUser,
      createTime: parsed.CreateTime ? Number(parsed.CreateTime) : undefined,
      raw: rawBody.slice(0, 4000),
      dedupeKey: parsed.MsgId ? `${this.id}:${parsed.MsgId}` : `${this.id}:${fromUser}:${parsed.CreateTime ?? ""}:${parsed.Content ?? ""}`,
    };
  },

  buildPassiveReply(inbound: InboundMessage, content: string): string {
    return buildTextReplyXml({
      toUser: inbound.fromUser || inbound.externalUserId,
      fromUser: inbound.toUser || "",
      content: truncateForWeChat(content, PASSIVE_REPLY_MAX_CHARS),
    });
  },

  canPush(settings: AppSettings): boolean {
    return Boolean(settings.wechat.appId && settings.wechat.appSecret);
  },

  async push(inbound: InboundMessage, content: string, settings: AppSettings): Promise<void> {
    const token = await getAccessToken(settings);
    const response = await fetch(`${API_BASE}/cgi-bin/message/custom/send?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        touser: inbound.externalUserId,
        msgtype: "text",
        text: { content: truncateForWeChat(content, PUSH_TEXT_MAX_CHARS) },
      }),
    });
    const data = (await response.json()) as any;
    if (data?.errcode && data.errcode !== 0) {
      // 40001/42001 表示 token 失效，清缓存便于下次重取
      if (data.errcode === 40001 || data.errcode === 42001) clearAccessTokenCache();
      throw new Error(`客服消息推送失败: ${data.errcode} ${data.errmsg ?? ""}`);
    }
  },
};

export default officialAccountChannel;
