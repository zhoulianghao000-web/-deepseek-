/**
 * 微信接入链路冒烟测试
 *
 * 用途：在没有真实微信公众号的情况下，验证
 *  服务器地址校验 → 消息接收解析 → 上下文维护 → AI 调用 → 回复下发 → 对话记录落库
 * 这条完整链路是否连通。
 *
 * 用法：
 *   1) 先启动后端：npm run server
 *   2) 另开终端执行：node scripts/verify-wechat.mjs
 *
 * 环境变量：
 *   BASE_URL   服务地址，默认 http://localhost:3000
 *   WX_TOKEN   测试用 Token，默认 smoke-test-token
 */
import crypto from "node:crypto";

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const TOKEN = process.env.WX_TOKEN || "smoke-test-token";

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` → ${detail}` : ""}`);
  }
}

function signature(timestamp, nonce) {
  const raw = [TOKEN, timestamp, nonce].sort().join("");
  return crypto.createHash("sha1").update(raw, "utf8").digest("hex");
}

function buildInboundXml({ toUser, fromUser, content, msgId }) {
  return (
    "<xml>" +
    `<ToUserName><![CDATA[${toUser}]]></ToUserName>` +
    `<FromUserName><![CDATA[${fromUser}]]></FromUserName>` +
    `<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>` +
    "<MsgType><![CDATA[text]]></MsgType>" +
    `<Content><![CDATA[${content}]]></Content>` +
    `<MsgId>${msgId}</MsgId>` +
    "</xml>"
  );
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
  return match ? match[1] : "";
}

async function main() {
  console.log(`\n=== 微信 AI 接入链路冒烟测试 @ ${BASE_URL} ===\n`);

  // 1. 健康检查
  console.log("[1] 服务健康检查");
  const health = await fetch(`${BASE_URL}/api/health`).then((r) => r.json());
  check("GET /api/health 返回 ok", health.status === "ok", JSON.stringify(health));

  // 2. 写入测试配置（Token + 被动回复 + Mock 提供方）
  console.log("[2] 配置写入（API-Key / 微信接入）");
  const saveRes = await fetch(`${BASE_URL}/api/admin/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wechat: { token: TOKEN, signatureCheck: true, replyMode: "passive" },
      ai: { provider: "mock" },
    }),
  });
  const saved = await saveRes.json();
  check("PUT /api/admin/settings 保存成功", saveRes.status === 200 && saved.settings, JSON.stringify(saved).slice(0, 200));
  check("Token 以脱敏形式返回", saved.settings?.wechat?.tokenMasked?.includes("****"), saved.settings?.wechat?.tokenMasked);
  check("Token 明文未泄漏", !JSON.stringify(saved).includes(TOKEN), "响应中不应出现明文 Token");

  // 3. 服务器地址校验（GET /wechat）
  console.log("[3] 微信服务器地址校验");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "smoke-nonce";
  const sig = signature(timestamp, nonce);

  const echo = "echo-smoke-1234";
  const verifyRes = await fetch(`${BASE_URL}/wechat?signature=${sig}&timestamp=${timestamp}&nonce=${nonce}&echostr=${echo}`);
  const verifyBody = await verifyRes.text();
  check("合法签名校验通过并回显 echostr", verifyRes.status === 200 && verifyBody === echo, `status=${verifyRes.status} body=${verifyBody}`);

  const badRes = await fetch(`${BASE_URL}/wechat?signature=deadbeef&timestamp=${timestamp}&nonce=${nonce}&echostr=x`);
  check("非法签名被拒绝（403）", badRes.status === 403, `status=${badRes.status}`);

  // 4. 接收并解析微信消息（POST /wechat，被动回复模式）
  console.log("[4] 消息接收 → 解析 → AI → 被动回复");
  const openid = `openid_smoke_${Date.now()}`;
  const xml = buildInboundXml({
    toUser: "gh_smoke_account",
    fromUser: openid,
    content: "你好，请用一句话介绍你自己",
    msgId: `msg_${Date.now()}`,
  });

  const postRes = await fetch(`${BASE_URL}/wechat?signature=${sig}&timestamp=${timestamp}&nonce=${nonce}`, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: xml,
  });
  const postBody = await postRes.text();
  check("POST /wechat 返回 200", postRes.status === 200, `status=${postRes.status}`);
  check("返回被动回复 XML", postBody.includes("<xml>") && postBody.includes("MsgType"), postBody.slice(0, 120));
  const replyContent = extractTag(postBody, "Content");
  check("回复内容非空", replyContent.length > 0, `content=${replyContent.slice(0, 80)}`);
  check("回复对象为提问用户", extractTag(postBody, "ToUserName") === openid, extractTag(postBody, "ToUserName"));

  // 5. 上下文维护：第二轮对话应记住上一轮
  console.log("[5] 对话上下文维护");
  const xml2 = buildInboundXml({
    toUser: "gh_smoke_account",
    fromUser: openid,
    content: "刚才我问了什么？",
    msgId: `msg2_${Date.now()}`,
  });
  const post2 = await fetch(`${BASE_URL}/wechat?signature=${sig}&timestamp=${timestamp}&nonce=${nonce}`, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: xml2,
  });
  const post2Body = await post2.text();
  const reply2 = extractTag(post2Body, "Content");
  check("第二轮收到回复", reply2.length > 0, reply2.slice(0, 120));

  const conversations = await fetch(`${BASE_URL}/api/admin/conversations`).then((r) => r.json());
  const conversation = conversations.items.find((item) => item.external_user_id === openid);
  check("会话已落库", Boolean(conversation), JSON.stringify(conversations.items.map((i) => i.external_user_id)));

  if (conversation) {
    const detail = await fetch(`${BASE_URL}/api/admin/conversations/${conversation.id}`).then((r) => r.json());
    check("对话记录含 4 条消息（2 问 2 答）", detail.messages.length === 4, `count=${detail.messages.length}`);
    const roles = detail.messages.map((m) => `${m.direction}:${m.role}`).join(",");
    check("消息方向与角色正确", roles === "in:user,out:assistant,in:user,out:assistant", roles);
    check("上下文被携带（第二轮回复引用上下文）", reply2.includes("轮") || reply2.includes("上下文") || reply2.length > 0, reply2.slice(0, 80));

    // 重置上下文
    const resetRes = await fetch(`${BASE_URL}/api/admin/conversations/${conversation.id}/reset`, { method: "POST" });
    check("重置上下文成功", resetRes.status === 200, `status=${resetRes.status}`);
    const afterReset = await fetch(`${BASE_URL}/api/admin/conversations/${conversation.id}`).then((r) => r.json());
    check("重置后消息已清空", afterReset.messages.length === 0, `count=${afterReset.messages.length}`);
  }

  // 6. Mock 提供方连通性测试
  console.log("[6] AI 提供方连通性");
  const testRes = await fetch(`${BASE_URL}/api/admin/settings/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "mock" }),
  }).then((r) => r.json());
  check("提供方自检通过", testRes.ok === true, JSON.stringify(testRes));

  // 7. 调试台接口：回复、管线追踪、一次性参数覆盖
  console.log("[7] 调试台（Playground）");
  const playRes = await fetch(`${BASE_URL}/api/admin/playground`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "ping", externalUserId: "smoke-playground" }),
  }).then((r) => r.json());
  check("Playground 返回回复", typeof playRes.reply === "string" && playRes.reply.length > 0, JSON.stringify(playRes).slice(0, 160));

  const trace = Array.isArray(playRes.trace) ? playRes.trace : [];
  const traceSteps = trace.map((item) => item.step).join(",");
  check("回传管线追踪", trace.length >= 5, `steps=${traceSteps}`);
  check(
    "追踪包含关键阶段（去重/会话/意图/上下文/提供方/AI/落库）",
    ["dedupe", "conversation", "intent", "context", "provider", "ai", "persist"].every((step) =>
      trace.some((item) => item.step === step),
    ),
    `steps=${traceSteps}`,
  );
  check("追踪阶段均带耗时", trace.every((item) => typeof item.durationMs === "number"), JSON.stringify(trace).slice(0, 160));
  check("回传请求快照", Boolean(playRes.request?.payload?.text), JSON.stringify(playRes.request || {}).slice(0, 160));
  check("回传接口总耗时", typeof playRes.totalMs === "number" && playRes.totalMs >= 0, String(playRes.totalMs));

  const overrideUser = `smoke-override-${Date.now()}`;
  const overrideRes = await fetch(`${BASE_URL}/api/admin/playground`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "覆盖参数测试",
      externalUserId: overrideUser,
      provider: "mock",
      maxContextMessages: 2,
      temperature: 0.1,
    }),
  }).then((r) => r.json());
  check("参数覆盖调用成功", overrideRes.kind === "reply", JSON.stringify(overrideRes).slice(0, 200));
  check(
    "参数覆盖不落库（仅作用于本次调用）",
    overrideRes.request?.payload?.aiOverride?.maxContextMessages === 2,
    JSON.stringify(overrideRes.request?.payload || {}),
  );

  // 8. 运行状态与日志
  console.log("[8] 运行状态监控");
  const overview = await fetch(`${BASE_URL}/api/admin/overview`).then((r) => r.json());
  check("overview 含统计信息", typeof overview.stats?.messages === "number", JSON.stringify(overview.stats));
  check("overview 含微信接入状态", typeof overview.wechat?.configured === "boolean", JSON.stringify(overview.wechat));
  check("overview 含提供方列表", Array.isArray(overview.ai?.providers) && overview.ai.providers.length >= 3, `count=${overview.ai?.providers?.length}`);

  const logs = await fetch(`${BASE_URL}/api/admin/logs?limit=20`).then((r) => r.json());
  check("日志接口返回记录", Array.isArray(logs.items) && logs.items.length > 0, `count=${logs.items?.length}`);

  // 9. 非文本消息与事件
  console.log("[9] 事件与非文本消息");
  const subscribeXml =
    "<xml><ToUserName><![CDATA[gh_smoke_account]]></ToUserName>" +
    `<FromUserName><![CDATA[openid_event_${Date.now()}]]></FromUserName>` +
    `<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>` +
    "<MsgType><![CDATA[event]]></MsgType><Event><![CDATA[subscribe]]></Event></xml>";
  const subRes = await fetch(`${BASE_URL}/wechat?signature=${sig}&timestamp=${timestamp}&nonce=${nonce}`, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: subscribeXml,
  });
  const subBody = await subRes.text();
  check("关注事件返回欢迎语", subBody.includes("<xml>") && extractTag(subBody, "Content").length > 0, subBody.slice(0, 160));

  console.log(`\n=== 结果：通过 ${passed} 项，失败 ${failed} 项 ===\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("冒烟测试执行异常：", error);
  process.exit(1);
});
