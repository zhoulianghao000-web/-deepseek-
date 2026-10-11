# 实施计划：微信 AI 接入网关（基线提交 · 模板改造）

| 项 | 内容 |
| --- | --- |
| 计划编号 | `2026-10-11-01` |
| 关联提交 | **待提交**（本机未安装 Git，仓库尚未初始化 → 见 [§4 R9](#4-潜在风险)） |
| 分支 | 建议首个提交落 `main`，后续特性走 `feat/*` |
| 作者 / 日期 | AI 助手 / 2026-10-11 |
| 状态 | 已实施 · 已验证 · 待提交 |
| 变更类型 | 特性 + 破坏性变更（删除模板文件、调整构建配置） |

> 本计划为提交前评审材料，实施与验证均已完成，证据见 [附 A](#附-a-验证证据)。

---

## 1. 本次提交的目标

**要解决的问题**

模板 `init-cbc-sdk-web` 提供的是「浏览器内的 Agent 聊天 UI」，与目标业务（微信用户通过公众号与 AI 对话 + 运维配置 API-Key）不匹配：
`现状` = 面向开发者的 Agent 控制台；`期望` = 面向运营的「微信 AI 接入网关 + 管理控制台」。

**可验收目标（DoD）**

| 编号 | 目标 | 验收标准（可实测） |
| --- | --- | --- |
| G1 | 微信消息接收与解析 | GET `/wechat` 合法签名回显 echostr、非法签名 403；POST `/wechat` 能解析 XML 并返回被动回复 XML |
| G2 | API-Key 配置与管理 | 界面可读写 CodeBuddy / OpenAI 兼容密钥并持久化；**接口响应与日志中不出现密钥明文**；提供连通性自检 |
| G3 | AI 对话请求与响应 | 三种提供方（CodeBuddy SDK / OpenAI 兼容 / Mock）可切换；未配置时自动回退并告警；返回错误可读 |
| G4 | 对话上下文维护 | 按「渠道+用户」隔离会话；多轮消息落库并递增；「重置」后历史清空 |
| G5 | 简洁 Web 管理界面 | 6 个页面（概览 / 对话记录 / 调试台 / API-Key 配置 / 微信接入 / 日志）全部渲染无控制台报错 |
| G6 | 架构可扩展 | 新增 AI 服务 = 实现 `AIProvider` + 注册；新增微信渠道 = 实现 `WeChatChannel` + 注册，前端无需改动 |

补充交付（超出原始需求但对验证必要）：**调试台**页（管线追踪 / 参数覆盖 / 控制台捕获），用于开发阶段反复验证。

**明确不在本次范围**

- 微信「安全模式」EncodingAESKey 解密（仅支持明文模式，留作扩展点）
- 图片 / 语音等多模态消息处理（当前统一返回文字兜底提示）
- 多实例部署所需的共享状态（去重缓存、`access_token` 缓存仍为进程内）
- 生产级账号体系（仅提供可选 `ADMIN_TOKEN` 静态令牌）

---

## 2. 涉及的模块与文件

变更集共 **45 个文件**（不含 `node_modules` / `dist` / `data`）。

### 2.1 新增 · 服务端（15）

| 路径 | 说明 |
| --- | --- |
| `server/config.ts` | 零依赖 `.env` 加载 + 运行时常量（port / adminToken / agentCwd / publicBaseUrl） |
| `server/logger.ts` | 日志服务：落库 + 控制台 + **按键名脱敏**（key/token/secret/password） |
| `server/settings.ts` | 配置服务：JSON 单文档存 SQLite、`loadSettings` / `saveSettings` / `mergeSettings` / `toPublicSettings`（脱敏视图）+ `SettingsOverride` 类型 |
| `server/conversation.ts` | 会话解析、消息落库、上下文装填、上下文重置、模型绑定 |
| `server/ai/types.ts` | `AIProvider` 接口定义（chat / test / isConfigured / supportsSessionResume） |
| `server/ai/codebuddy.ts` | CodeBuddy Agent SDK 提供方（`tools: []` 退化为纯对话、支持 `resume` 续接） |
| `server/ai/openai.ts` | OpenAI 兼容提供方（`/chat/completions`，兼容 DeepSeek / Ollama / vLLM） |
| `server/ai/mock.ts` | 本地模拟提供方（零配置联调与自动化验证） |
| `server/ai/index.ts` | 提供方注册表 + `resolveProvider` 回退策略 + `listProviders` |
| `server/wechat/types.ts` | `InboundMessage` / `WeChatChannel` 接口 |
| `server/wechat/xml.ts` | 签名计算（sha1 + 恒定时间比较）、XML 解析与构造、内容截断 |
| `server/wechat/official-account.ts` | 公众号渠道：服务器校验 / 报文解析 / 被动回复 / 客服消息推送（含 access_token 缓存） |
| `server/wechat/index.ts` | 渠道注册表 + **统一消息处理管线**（去重 → 会话 → 意图 → 上下文 → AI → 落库）+ 管线追踪 `trace` |
| `server/routes/wechat.ts` | `GET/POST /wechat`，按回复模式选择被动回复或异步推送 |
| `server/routes/admin.ts` | 管理 API 全部端点（含可选 `ADMIN_TOKEN` 守卫、调试台接口） |

### 2.2 修改 · 服务端（2）

| 路径 | 修改点 | 影响面 |
| --- | --- | --- |
| `server/db.ts` | 新增 4 张表（`settings` / `wx_conversations` / `wx_messages` / `app_logs`）与对应访问函数；移除 `export default`（修复 TS4023） | 新增表用 `IF NOT EXISTS`，对既有 `sessions` / `messages` 表零影响 |
| `server/index.ts` | ① `/wechat` 路由**先于** `express.json()` 挂载并以 text 解析保留原始 XML；② 挂载 `/api/admin`；③ 生产环境静态托管 `dist/` + SPA 回退；④ 健康检查扩展；⑤ 修复 4 处模板遗留类型错误 | 原 Agent API 全部保留；启动横幅与日志变更 |

### 2.3 新增 · 前端（9）

| 路径 | 说明 |
| --- | --- |
| `src/api/client.ts` | API 客户端（可选管理令牌、统一错误归一化） |
| `src/components/ui.tsx` | 自研轻量组件库（Card/Button/Input/Select/Switch/Tag/StatCard/KeyValue…，明暗双主题） |
| `src/components/Layout.tsx` | 控制台框架：侧边导航（`<lg` 抽屉式）+ 顶部栏 + 管理令牌弹窗 |
| `src/pages/DashboardPage.tsx` | 运行概览：统计、AI 状态、微信接入、最近会话、最近日志 |
| `src/pages/ConversationsPage.tsx` | 对话记录：列表 + 消息时间线 + 重置/删除 |
| `src/pages/DebugPage.tsx` | **调试台**：请求构造 / 参数覆盖 / 管线追踪 / 观察面板 / 控制台捕获 |
| `src/pages/SettingsPage.tsx` | API-Key 配置：提供方选择、密钥管理、连通性测试、对话参数 |
| `src/pages/WeChatPage.tsx` | 微信接入配置 + 接入步骤指引 |
| `src/pages/LogsPage.tsx` | 运行日志：级别过滤、详情展开、清空 |

### 2.4 修改 · 前端与配置（8）

| 路径 | 修改点 |
| --- | --- |
| `src/App.tsx` | 重写为控制台路由（`/` `/conversations` `/debug` `/settings` `/wechat-config` `/logs`） |
| `src/types.ts` | 重写为控制台所需类型（含 `TraceStep` / `SettingsOverride` 相关） |
| `src/main.tsx` | 移除已不使用的 TDesign 样式引入 |
| `src/config.ts` | 应用名与描述 |
| `index.html` | 页面标题 |
| `vite.config.ts` | 新增 `/api` 与 **正则精确匹配** `^/wechat(\?\|$)` 开发代理 |
| `tsconfig.json` | `tsBuildInfoFile` 重定向至 `node_modules/.tmp` |
| `tsconfig.node.json` | 显式 `target/lib/types`，`outDir`/`tsBuildInfoFile` 重定向（修复编译产物污染源码目录） |
| `package.json` | 名称/描述，新增 `npm run verify` |

### 2.5 新增 · 工程与文档（4）

`scripts/verify-wechat.mjs`（31 项端到端冒烟断言）、`.gitignore`、`.env.example`、`docs/commits/`（本计划与模板）

### 2.6 删除（破坏性变更）

| 路径 | 原因 | 下游影响 |
| --- | --- | --- |
| `src/components/`（整目录，模板聊天 UI 组件） | 被新的控制台 UI 取代 | 基于模板二次开发的分支需同步调整 |
| `src/utils/`（`iconMap.ts`） | 仅服务于被删组件 | 无 |
| `src/hooks/use{Agents,Chat,Models,Sessions}.ts` | 仅服务于被删的就地聊天逻辑 | 无 |
| `src/pages/ChatPage.tsx` | 同上 | 无 |
| `src/pages/PlaygroundPage.tsx` | 被 `DebugPage.tsx` 取代（同能力超集） | 无（路由 `/playground` → `/debug`） |
| `DEVELOPMENT.md` | 描述的是已删除的模板架构，保留会产生误导 | 文档级，建议改用 `docs/` |

**保持不动**：`src/index.css`、`src/hooks/useTheme.ts`、`tailwind.config.js`、`postcss.config.js`、`server` 既有 `sessions`/`messages` 表结构与全部原 Agent API。

---

## 3. 具体修改步骤

| # | 动作 | 文件 | 关键实现点 | 验证方式 |
| --- | --- | --- | --- | --- |
| 1 | 落地模板 | 全项目 | 从 `init-cbc-sdk-web/templates` 复制完整项目，**不从零编写** | 目录结构比对 |
| 2 | 后端地基 | `config.ts` `logger.ts` `db.ts` | 零依赖 `.env`；日志脱敏；4 张新表 + CRUD | 服务可启动、表已建 |
| 3 | 配置服务 | `settings.ts` | 单 JSON 文档持久化；env 仅作首次默认值；密钥掩码视图 | `/api/admin/settings` 无明文 |
| 4 | AI 抽象层 | `ai/*` | `AIProvider` 接口 + 3 实现 + 注册表 + 回退策略 | `settings/test` 自检通过 |
| 5 | 微信接入层 | `wechat/*` | sha1 签名（恒定时间比较）、XML 解析、被动回复 / 客服消息推送、消息去重 | 冒烟测试 [3][4][9] |
| 6 | 处理管线 | `wechat/index.ts` `conversation.ts` | 渠道无关管线；显式指定提供方时不回退（暴露真实错误）；逐步 `trace` | 冒烟测试 [5][7] |
| 7 | 管理 API | `routes/admin.ts` | overview / settings / conversations / logs / playground；可选令牌守卫 | 冒烟测试 [2][8] |
| 8 | 服务端装配 | `index.ts` | `/wechat` 必须在 `express.json()` 之前挂载；生产静态托管 + SPA 回退（排除 `/api`、`/wechat`） | `GET /wechat` 403、`GET /wechat-config` 返回 SPA |
| 9 | 构建配置修复 | `tsconfig*.json` `vite.config.ts` | 编译产物重定向；代理上下文用正则精确匹配，避免 `^/wechat` 前缀吞掉前端路由 | 根目录与 `server/` 无散落 `.js`/`.d.ts` |
| 10 | 前端控制台 | `src/**` | 6 页面 + 组件库 + 响应式抽屉导航 | Playwright 六页 0 报错、响应式 16 项 |
| 11 | 调试台 | `DebugPage.tsx` | 管线追踪可视化、参数覆盖（不落库）、console 捕获 | 交互验证 17 项 |
| 12 | 工程与文档 | `.gitignore` `.env.example` `scripts/` `README.md` `docs/` | 冒烟脚本可复跑；文档与实现一致 | `npm run verify` 全绿 |
| 13 | 验证与缺陷修复 | 多处 | 修复 6 处实质缺陷（见 §4 R10 备注） | 附 A 全部通过 |

---

## 4. 潜在风险

| # | 风险 | 影响面 | 可能性 | 应对措施 |
| --- | --- | --- | --- | --- |
| R1 | `better-sqlite3` 原生模块与 Node ABI 绑定 | 服务无法启动 | 中 | 锁定 Node 24 + 已装 12.x；换 Node 版本后需重新 `npm install`；已在 README 记录环境 |
| R2 | 密钥以明文存于 SQLite（`data/chat.db`） | 凭证泄漏 | 中 | 响应/日志全程脱敏；`data/` 已 gitignore；生产需限制文件权限 + 磁盘加密 |
| R3 | `/api/admin/*` 默认无鉴权 | 未授权访问配置与对话 | 中 | 提供 `ADMIN_TOKEN`（服务端设 env + 控制台填同一令牌）；README 标注生产必开 |
| R4 | 被动回复受微信 5 秒超时限制 | 用户收不到回复 / 重复处理 | 中 | 默认 `replyMode=auto`（有 AppID/Secret 走异步推送）；已实现消息去重 |
| R5 | 消息去重与 `access_token` 为进程内缓存 | 重启后去重失效；多实例行为不一致 | 中 | 单实例部署；多实例需替换为 Redis（已在 README 列为扩展点） |
| R6 | 模板依赖残留（`tdesign-react`、`@tdesign-react/chat`）已不在前端引用 | 依赖体积与审计噪音；`tailwind.config.js` 中基于 `--td-*` 的颜色别名失去提供者 | 低 | 前端已改用标准 Tailwind 调色板；后续提交可移除这两个依赖（见附 C） |
| R7 | 前端路由名与后端端点名冲突约束（`/wechat` vs `/wechat-config`） | 新增路由时可能再次踩坑 | 低 | `App.tsx` 已加注释；README 已说明；代理使用精确正则 |
| R8 | 环境变量仅在「首次启动且库中无配置」时作为默认值 | 运维误以为改 `.env` 可覆盖已存配置 | 中 | 已在 README 与 `.env.example` 明确说明优先级 |
| R9 | **本机未安装 Git，仓库未初始化** | 无法真正执行「提交」与回溯 | 高 | 需先安装 Git 并 `git init`；本计划文件已按仓库路径落盘，可随首个提交入库 |
| R10 | 删除模板文件属破坏性变更 | 基于模板的下游分支合并冲突 | 中 | 独立基线提交，便于 revert；变更清单见 §2.6 |
| R11 | `tsconfig.node.json` 收紧 `types: ["node"]` | 后续服务端新增依赖的全局类型可能不可见 | 低 | 需要时按依赖追加 `types`；该配置已修复 4 处类型错误与产物污染 |

> 实施期间实际发现并已修复的缺陷（一并纳入本次提交，评审重点）：
> ① XML 解析正则被根标签 `<xml>` 吞掉全部子标签内容 → 微信消息永远解析失败；
> ② `listWxMessages` 子查询引用 `rowid` 报错 → 对话记录 500；
> ③ `tsc -b` 生成 `vite.config.js` 覆盖 `vite.config.ts` → 代理静默失效，且污染 38 个源码文件位置；
> ④ 前端路由 `/wechat` 与后端端点撞名 → 页面被 403 拦截；
> ⑤ 模板遗留 4 处类型错误（`sdk_session_id` 缺失、`tool_result` 联合类型、`duration`/`cost` 字段名、`Map` 迭代）；
> ⑥ 侧边栏固定 232px → 手机端主区域被挤压不可用。

---

## 5. 回滚方案

**触发条件**（满足任一即回滚）

- 服务无法启动（依赖 / 原生模块 / 配置错误）
- 微信校验接口不可用，或消息处理导致重复回复
- 管理接口泄漏密钥明文
- 生产错误日志 `error` 级别持续增长

**全量回滚**

```bash
# 情况 A：尚未提交（当前状态）—— 直接丢弃工作区
#   重新从官方模板复制覆盖即可恢复基线：
#   cp -r ~/.codebuddy/plugins/marketplaces/*/codebuddy-chat-web/skills/init-cbc-sdk-web/templates/* ./
#   注意：会一并删除本次新增的全部 server/ src/ scripts/ 目录

# 情况 B：已提交 —— 保留历史地回滚
git revert --no-commit <本次 sha>
git commit -m "revert: 回滚微信 AI 接入网关基线提交"
# 或（紧急，确认无他人基于该提交工作后）
git reset --hard <上个稳定 sha>
```

**按项回滚**（无需整体回退）

| 目标 | 回滚内容 | 代价 |
| --- | --- | --- |
| 只关掉微信接入 | 在公众号后台停用「服务器配置」，或注释 `server/index.ts` 中 `app.use("/wechat", ...)` 挂载 | 微信链路断开，控制台其余功能正常 |
| 只关掉管理接口 | 注释 `app.use("/api/admin", adminRouter)` | 控制台不可用，原 Agent API 保留 |
| 只回退开发代理 | 还原 `vite.config.ts` 的 `server.proxy` | 开发时 `/wechat` 需直连 3000 |
| 恢复被删的模板 UI | 从模板目录重新复制 `src/components`、`src/hooks/*` 、`src/pages/ChatPage.tsx` | 与当前 `App.tsx` 路由不兼容，需一并还原 `App.tsx` |
| 构建配置回退 | 还原 `tsconfig.node.json` / `tsconfig.json` | 会重现「`vite.config.js` 覆盖 `vite.config.ts`」缺陷，**不建议** |

**降级手段（不必回滚即可止血）**

- `ai.provider = mock` → 断开外部 AI 依赖，链路仍可用（控制台或 `PUT /api/admin/settings`）
- `wechat.replyMode = passive` 且清空 AppID/AppSecret → 只走被动回复，不调用客服消息接口
- 设置 `ADMIN_TOKEN` → 立即给管理接口加上访问控制

**数据层回滚**

- 新增表使用 `CREATE TABLE IF NOT EXISTS`，回滚代码**不会**自动删表；如需彻底重置：停止服务 → 删除 `data/chat.db`（含 `-wal` / `-shm`）→ 重启，schema 自动重建
- 配置项集中在 `settings` 表单行（key = `app.settings`），删除该行即恢复为环境变量派生的默认值

**回滚后验证**

```bash
npm run build                                      # 期望 exit 0
npm run server                                     # 期望打印启动横幅
node scripts/verify-wechat.mjs                     # 期望「通过 31 项，失败 0 项」
curl -i "http://localhost:3000/wechat?signature=x&timestamp=1&nonce=1&echostr=y"   # 期望 403
```

> 注意：若已回滚到模板基线，`scripts/verify-wechat.mjs` 不存在，应以模板自带的 `npm run dev` 冒烟为准。

---

## 附 A. 验证证据

| 验证项 | 命令 / 操作 | 结果 |
| --- | --- | --- |
| 类型检查 + 生产构建 | `npm run build` | `tsc -b` 通过，`✓ built`，exit **0** |
| 端到端冒烟（直连 3000） | `node scripts/verify-wechat.mjs` | **31 项通过 / 0 失败** |
| 端到端冒烟（Vite 代理 5173） | `BASE_URL=http://127.0.0.1:5173 node scripts/verify-wechat.mjs` | **31 项通过 / 0 失败** |
| 六页渲染 + 控制台错误 | Playwright 逐页加载并监听 console/pageerror | 6 页均有内容，`total_issues=0` |
| 调试台交互 | Playwright 真实填写并点击发送 | **17 项通过 / 0 失败**，7 个管线阶段全部命中，console 捕获生效 |
| 响应式 | Playwright 390×844 / 1440×900 | **16 项通过 / 0 失败**（抽屉开合、6 路由无横向溢出） |
| 构建产物洁净度 | 检查根目录与 `server/` 下的 `.js`/`.d.ts`/`*.tsbuildinfo` | `clean` / `server` 下 `.js` 计数 `0` |
| 密钥不泄漏 | 冒烟断言 `Token 明文未泄漏` | 通过（响应中仅 `test****n123`） |

## 附 B. 提交信息建议

```
feat(gateway): 微信 AI 接入网关基线（公众号对话 + API-Key 管理 + 管理控制台）

将 init-cbc-sdk-web 模板改造为微信 AI 接入网关：
- 微信接入：签名校验、XML 解析、去重、被动回复/客服消息推送
- AI 抽象：CodeBuddy SDK / OpenAI 兼容 / Mock 三提供方可切换与自动回退
- 上下文：按用户隔离会话、支持 SDK 会话续接与关键词重置
- 管理台：概览/对话记录/调试台/API-Key/微信接入/日志 六页 + 可选 ADMIN_TOKEN
- 调试台：管线逐阶段追踪、一次性参数覆盖、浏览器控制台捕获
- 修复：XML 解析正则、rowid 查询、tsc 产物污染、路由与端点撞名、移动端导航

验证：npm run build 通过；scripts/verify-wechat.mjs 31/31；六页 0 console 错误
ref: docs/commits/2026-10-11-01-wechat-ai-gateway-baseline.md
```

## 附 C. 遗留 TODO（转入下一次提交的计划）

- [ ] 移除已无引用的 `tdesign-react`、`@tdesign-react/chat`、`tdesign-icons-react`，并清理 `tailwind.config.js` 中基于 `--td-*` 的颜色别名（R6）
- [ ] 微信「安全模式」EncodingAESKey 解密支持
- [ ] 关注事件（subscribe）以外的菜单/扫码事件分支
- [ ] 图片/语音消息的多模态处理或明确的引导话术
- [ ] 去重缓存与 `access_token` 迁移至 Redis，支持多实例
- [ ] 管理控制台登录态（当前仅静态令牌）
- [ ] 安装 Git 并 `git init`，把本计划与代码一并作为首个提交入库（R9）
