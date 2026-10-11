/**
 * 微信报文工具：签名计算、XML 解析与构造
 */
import crypto from "crypto";

/** 计算微信服务器配置校验签名：sha1(sort(token, timestamp, nonce)) */
export function computeSignature(token: string, timestamp: string, nonce: string): string {
  const raw = [token, timestamp, nonce].sort().join("");
  return crypto.createHash("sha1").update(raw, "utf8").digest("hex");
}

/** 恒定时间比较，避免时序侧信道 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * 解析微信 XML 报文（扁平结构）。
 * 同时支持 <Tag>value</Tag> 与 <Tag><![CDATA[value]]></Tag> 两种形式。
 *
 * 注意：非 CDATA 分支使用 [^<]* 而非 [\s\S]*?，否则外层根标签 <xml>
 * 会把整段子标签内容吞掉，导致子标签一个都解析不出来。
 */
export function parseWeChatXml(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!xml) return result;
  const pattern = /<([A-Za-z0-9_]+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    const key = match[1];
    const value = match[2] !== undefined ? match[2] : match[3] ?? "";
    // 同名标签取第一个（微信扁平报文中不重复）
    if (!(key in result)) result[key] = value.trim();
  }
  return result;
}

/** XML 特殊字符转义（用于非 CDATA 场景） */
export function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** CDATA 安全包装：拆断内容中的 ]]> 序列 */
export function cdata(value: string): string {
  const safe = String(value).replace(/]]>/g, "]]]]><![CDATA[>");
  return `<![CDATA[${safe}]]>`;
}

/** 构造被动回复文本报文 */
export function buildTextReplyXml(params: {
  toUser: string;
  fromUser: string;
  content: string;
  createTime?: number;
}): string {
  const createTime = params.createTime ?? Math.floor(Date.now() / 1000);
  return [
    "<xml>",
    `<ToUserName>${cdata(params.toUser)}</ToUserName>`,
    `<FromUserName>${cdata(params.fromUser)}</FromUserName>`,
    `<CreateTime>${createTime}</CreateTime>`,
    `<MsgType>${cdata("text")}</MsgType>`,
    `<Content>${cdata(params.content)}</Content>`,
    "</xml>",
  ].join("");
}

/** 被动回复内容上限（微信限制 2048 字节，这里按字符保守裁剪） */
export const PASSIVE_REPLY_MAX_CHARS = 1200;
/** 客服消息文本上限（保守裁剪） */
export const PUSH_TEXT_MAX_CHARS = 1800;

export function truncateForWeChat(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars - 20)}\n\n…（内容过长已截断）`;
}
