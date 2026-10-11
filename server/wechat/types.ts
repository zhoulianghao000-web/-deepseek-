/**
 * 微信渠道抽象层类型
 *
 * 扩展点：实现 WeChatChannel 接口并在 server/wechat/index.ts 注册，
 * 即可接入企业微信、小程序客服、微信客服等更多渠道。
 */
import type { AppSettings } from "../settings.js";

export type InboundMsgType =
  | "text"
  | "image"
  | "voice"
  | "video"
  | "location"
  | "link"
  | "event"
  | "unsupported";

/** 归一化后的入站消息（与具体渠道协议解耦） */
export interface InboundMessage {
  channel: string;
  /** 渠道内唯一用户标识（公众号为 openid） */
  externalUserId: string;
  /** 展示名（如可获得） */
  displayName?: string;
  msgType: InboundMsgType;
  content: string;
  /** 事件类型（subscribe / unsubscribe / CLICK …） */
  event?: string;
  eventKey?: string;
  /** 原始消息 ID，用于去重 */
  msgId?: string;
  /** 接收方（公众号原始 ID） */
  toUser?: string;
  /** 发送方（用户 openid） */
  fromUser?: string;
  createTime?: number;
  /** 原始报文（截断后入库） */
  raw: string;
  /** 去重键 */
  dedupeKey?: string;
}

export interface VerifyResult {
  ok: boolean;
  echo?: string;
  error?: string;
}

export interface WeChatChannel {
  id: string;
  label: string;
  description: string;
  /** 服务器地址（URL）校验，对应微信后台「服务器配置」的提交校验 */
  verify(query: Record<string, any>, settings: AppSettings): VerifyResult;
  /** 解析入站消息；签名校验失败或无法解析时返回 null */
  parse(rawBody: string, query: Record<string, any>, settings: AppSettings): InboundMessage | null;
  /** 构造被动回复报文 */
  buildPassiveReply(inbound: InboundMessage, content: string): string;
  /** 是否具备主动推送能力（客服消息需要 appId/appSecret） */
  canPush(settings: AppSettings): boolean;
  /** 主动推送消息 */
  push(inbound: InboundMessage, content: string, settings: AppSettings): Promise<void>;
  /** 是否已完成接入配置 */
  isConfigured(settings: AppSettings): boolean;
}
