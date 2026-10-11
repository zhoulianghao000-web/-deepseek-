# 微信 AI 接入网关

基于 **CodeBuddy Agent SDK** 构建的微信公众号 AI 接入网关：让微信用户直接和 AI 对话，并提供一个简洁的 Web 管理控制台来配置 API-Key、查看对话记录、监控运行状态。

```
微信用户 ⇄ 微信公众号 ⇄ 本服务(/wechat) ⇄ 对话管线 ⇄ AI 提供方(可替换) ⇄ SQLite
                                        ↓
                                  Web 管理控制台
```

---

## 功能特性

| 能力 | 说明 |
| --- | --- |
| 微信消息接收与解析 | 服务器地址签名校验（sha1）、XML 报文解析（文本/图片/语音/位置/事件）、消息去重（防微信重试重复处理） |
| API-Key 配置与管理 | 控制台可视化配置，密钥落库且**响应与日志全程脱敏**，支持连通性自检与一键清除 |
| AI 对话请求与响应处理 | 提供方抽象层：`CodeBuddy Agent SDK` / `OpenAI 兼容服务` / `Mock`，未配置时自动回退并告警 |
| 对话上下文维护 | 按「渠道 + 用户」维护独立会话；支持原生会话续接（CodeBuddy `resume`）与本地滑动窗口两种模式，支持关键词重置 |
| Web 管理控制台 | 运行概览 / 对话记录 / 调试台 / API-Key 配置 / 微信接入 / 运行日志 六个页面 |
| 调试台（开发阶段） | 构造模拟消息、**管线逐阶段追踪**、响应原文与等价 cURL、一次性参数覆盖、浏览器控制台输出捕获 |
| 回复下发策略 | `自动`（有 AppID/AppSecret 走客服消息异步推送，否则被动回复）/ `始终被动回复` / `始终异步推送` |
| 运行状态监控 | 服务运行信息、消息与错误统计、提供方状态、微信接入状态、实时日志 |

---

## 技术栈

- **后端**：Node.js + Express + TypeScript（`tsx` 运行）
- **前端**：React 18 + TypeScript + Vite + Tailwind CSS（自研轻量组件，支持深色模式）
- **AI**：CodeBuddy Agent SDK（`@tencent-ai/agent-sdk`）/ OpenAI 兼容 HTTP 接口
- **存储**：SQLite（`better-sqlite3`）

---

## 快速开始

```bash
npm install
cp .env.example .env      # 可选：也可全部在控制台里配置
npm run dev               # 同时启动后端(3000) 与前端(5173)
```

打开 <http://localhost:5173> 进入管理控制台。

**零配置即可跑通**：默认使用 `Mock` 提供方（本地确定性回复，不产生网络请求），可在「消息调试」页立刻验证「接收 → 上下文 → 回复」全链路。

生产模式（后端同时托管前端构建产物，只暴露一个端口）：

```bash
npm run build
npm run server            # 访问 http://localhost:3000
```

### 一键启动（推荐给非开发者）

```bash
npm run start             # 等价于 node scripts/launch.mjs
```

Windows 下也可直接双击项目根目录的 **`启动.cmd`**（发行包内已自带 Node 运行时与依赖，
双击 `启动.cmd` 或桌面快捷方式即可）。

启动器行为：

1. 若目标端口已有本服务在运行 → 只打开控制台，不重复启动；
2. 自检 `node_modules` / `tsx` / `dist`，缺失时给出可操作提示；
3. 启动服务端，轮询 `/api/health` 就绪后**自动打开管理控制台**；
4. `Ctrl+C` 或关闭窗口即停止服务。

可选环境变量（`cmd` 下用 `set` 前缀）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务端口，如 `set PORT=3100 && 启动.cmd` |
| `NO_OPEN` | 未设置 | 设为 `1` 时不自动打开浏览器 |

> 发行包目录结构：`启动.cmd` + `runtime\node\`（便携运行时）+ `node_modules\` + `dist\` + `server\`/`src\` 源码 + `docs\`。
> 首次启动会以空数据库初始化（`data/chat.db`），不会携带任何历史对话或密钥。

---

## 接入微信公众号

1. 准备已认证的公众号，在「设置与开发 → 基本配置」获取 `AppID` / `AppSecret`。
2. 为本机服务准备公网可达地址（云服务器或内网穿透），例如 `https://your-domain.com/wechat`。
   开发阶段可用内网穿透映射 **5173**（已配置 `/wechat` 与 `/api` 反向代理）或 **3000**。
3. 在控制台「微信接入」页填写 `Token` / `AppID` / `AppSecret`，回复模式选「自动」，保存。
4. 公众号后台「服务器配置」：URL 填上一步的地址，Token 与页面一致，**消息加解密方式选「明文模式」**，提交。
5. 提交时微信会请求该地址做签名校验（本服务已实现 GET 校验逻辑），通过后启用配置。
6. 用微信给公众号发送消息即可收到 AI 回复。

> 可先用控制台「消息调试」页在本地验证全链路，无需等待公网配置。

---

## 目录结构

```
├── server/
│   ├── index.ts                # 入口：挂载微信路由、管理路由、原 Agent API、静态托管
│   ├── config.ts               # 环境变量加载与运行时常量
│   ├── db.ts                   # SQLite：会话/消息/设置/微信会话/微信消息/日志
│   ├── logger.ts               # 日志服务（落库 + 控制台 + 字段级脱敏）
│   ├── settings.ts             # 配置服务（读取/保存/脱敏公开视图）
│   ├── conversation.ts         # 对话上下文维护（会话解析、落库、窗口装填、重置）
│   ├── ai/                     # AI 提供方抽象层
│   │   ├── types.ts            #   AIProvider 接口
│   │   ├── codebuddy.ts        #   CodeBuddy Agent SDK（支持 resume 会话续接）
│   │   ├── openai.ts           #   OpenAI 兼容 /chat/completions
│   │   ├── mock.ts             #   本地模拟（零配置联调）
│   │   └── index.ts            #   注册表 + 回退策略
│   ├── wechat/                 # 微信渠道抽象层
│   │   ├── types.ts            #   InboundMessage / WeChatChannel 接口
│   │   ├── xml.ts              #   签名计算、XML 解析与构造
│   │   ├── official-account.ts #   公众号渠道（校验/解析/被动回复/客服消息推送）
│   │   └── index.ts            #   渠道注册表 + 统一消息处理管线
│   └── routes/
│       ├── wechat.ts           # GET/POST /wechat
│       └── admin.ts            # /api/admin/*
├── src/
│   ├── api/client.ts           # 前端 API 客户端（含可选管理令牌）
│   ├── components/             # Layout + 基础 UI 组件
│   ├── pages/                  # 六个控制台页面（含 DebugPage 调试台）
│   └── App.tsx                 # 路由与布局
├── scripts/verify-wechat.mjs   # 端到端冒烟测试（24 项断言）
└── data/chat.db                # SQLite 数据库（自动创建）
```

---

## 配置说明

### 控制台配置（推荐）

写库持久化，重启后仍然生效；**响应与日志中的密钥均为脱敏值**，密钥明文只存在于服务端。

| 分组 | 字段 |
| --- | --- |
| AI | 提供方、模型 ID、系统提示词、上下文条数（1–50）、temperature |
| CodeBuddy | API Key、Auth Token、Base URL、网络环境 |
| OpenAI 兼容 | API Key、Base URL、默认模型 |
| 微信 | 渠道、Token、AppID、AppSecret、回复模式、签名校验开关、欢迎语、重置关键词 |

密钥字段采用「**留空即不修改**」语义；需要清空时点击对应的「清除 Key」按钮。

### 环境变量（可选）

见 `.env.example`：`PORT`、`ADMIN_TOKEN`、`PUBLIC_BASE_URL`、`CODEBUDDY_*`、`OPENAI_*`、`WECHAT_*`。
环境变量只在首次启动、且库中尚无配置时作为默认值；`.env` 的值不会覆盖已保存的控制台配置。

---

## API 端点

### 微信接入

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/wechat` | GET | 服务器地址校验（签名校验 + 回显 echostr） |
| `/wechat` | POST | 接收用户消息，按回复模式被动回复或异步推送 |

### 管理控制台（`/api/admin`，可被 `ADMIN_TOKEN` 保护）

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/overview` | GET | 运行状态总览（服务/AI/微信/统计/最近会话/最近日志） |
| `/settings` | GET | 配置（脱敏）+ 提供方清单 + 渠道清单 |
| `/settings` | PUT | 保存配置（`clear` 数组用于清空指定密钥） |
| `/settings/test` | POST | 提供方连通性测试 |
| `/conversations` | GET | 会话列表（支持 `q` / `limit` / `offset`） |
| `/conversations/:id` | GET | 会话详情 + 消息时间线 |
| `/conversations/:id/reset` | POST | 重置该会话上下文 |
| `/conversations/:id` | DELETE | 删除会话及消息 |
| `/conversations` | DELETE | 清空全部会话 |
| `/logs` | GET / DELETE | 运行日志查询 / 清空 |
| `/playground` | POST | 调试台：模拟入站消息走完整管线；支持一次性参数覆盖（`provider`/`model`/`systemPrompt`/`maxContextMessages`/`temperature`），返回 `trace` 管线追踪与 `request` 快照 |

### 保留的原 Agent API

`/api/health`、`/api/check-login`、`/api/models`、`/api/sessions*`、`/api/chat`（SSE 流式）、`/api/permission-response`。

---

## 扩展点

### 接入新的 AI 服务

1. 新建 `server/ai/your-provider.ts`，实现 `AIProvider` 接口（`chat` / `test` / `isConfigured`）。
2. 在 `server/ai/index.ts` 的 `providers` 数组中注册。
3. 在 `server/settings.ts` 的 `AppSettings` 中补充该提供方的配置字段（如需）。

控制台会自动列出新提供方，无需改动前端。

### 接入新的微信渠道

1. 新建 `server/wechat/your-channel.ts`，实现 `WeChatChannel` 接口（`verify` / `parse` / `buildPassiveReply` / `push` / `canPush`）。
2. 在 `server/wechat/index.ts` 的 `channels` 数组中注册。

消息处理管线（去重 → 会话 → 指令 → 上下文 → AI → 落库）完全与渠道解耦，可复用于企业微信、小程序客服、微信客服等。

---

## 验证

```bash
npm run server            # 终端 A：启动后端
npm run verify            # 终端 B：运行 24 项端到端断言
```

覆盖：健康检查、配置读写与脱敏、合法/非法签名校验、消息接收解析、被动回复 XML、
多轮上下文维护与重置、提供方自检、消息调试、运行状态、日志接口、关注事件欢迎语。

---

## 提交规范

每次提交代码前，先在 `docs/commits/` 下生成实施计划（复制 `_TEMPLATE.md` 为 `<YYYY-MM-DD>-<序号>-<slug>.md`），
计划必须包含五部分：**① 本次提交的目标　② 涉及的模块与文件　③ 具体修改步骤　④ 潜在风险　⑤ 回滚方案**，
并附「验证证据」与「提交信息建议」。计划随代码一并提交，便于团队评审与后续追溯。

- 模板：`docs/commits/_TEMPLATE.md`
- 示例：`docs/commits/2026-10-11-01-wechat-ai-gateway-baseline.md`

## 已知限制与生产建议

- **仅支持明文模式**：安全模式（EncodingAESKey）留作扩展点，需在 `official-account.ts` 中补充 AES 解密。
- **被动回复受微信 5 秒超时限制**：AI 较慢时会被微信重试（已做消息去重）；生产建议使用「自动/异步推送」模式。
- **仅处理文本消息**：图片/语音等返回友好提示，可按需扩展多模态处理。
- **管理接口鉴权**：默认关闭，生产环境请设置 `ADMIN_TOKEN`（控制台左下角填入同一令牌）。
- **单实例内存态**：消息去重与 access_token 缓存为进程内缓存，多实例部署需替换为 Redis 等共享存储。
- 建议将服务置于反向代理（HTTPS）之后，并只暴露 `/wechat` 与必要的管理接口。

## License

MIT
