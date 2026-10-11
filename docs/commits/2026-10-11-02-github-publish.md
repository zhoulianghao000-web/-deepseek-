# 实施计划：发布到 GitHub 仓库 `zhoulianghao000-web/-deepseek-`

| 项 | 内容 |
| --- | --- |
| 计划编号 | `2026-10-11-02` |
| 关联提交 | 待提交（3 个提交，见 §3） |
| 目标仓库 | `https://github.com/zhoulianghao000-web/-deepseek-` |
| 分支 | `main` |
| 作者 / 日期 | `<待确认>` / 2026-10-11 |
| 状态 | **计划中 · 待批准**（前置条件未满足，见 §1.3） |
| 变更类型 | 工程 / 发布（首次入库） |

---

## 1. 本次提交的目标

### 1.1 目标

把本地已完成的「微信 AI 接入网关」项目发布到指定 GitHub 仓库，形成可评审、可追溯的提交历史起点。

| 编号 | 目标 | 验收标准 |
| --- | --- | --- |
| P1 | 建立仓库并推送 | `git ls-remote origin` 可读到 `refs/heads/main`，sha 与本地 `HEAD` 一致 |
| P2 | 提交历史可评审 | 3 个语义化提交（规范/基线/发布加固），非单个巨型提交 |
| P3 | **公开仓库零密钥泄漏** | `git ls-files` 清单中无 `.env`、`data/`、`dist/`、`node_modules/`、`*.db`；全量密钥模式扫描无真实命中 |
| P4 | 提交可复现 | 提交信息含计划编号引用；克隆后可 `npm install && npm run build && npm run verify` |

### 1.2 仓库现状（已实测）

| 项 | 结果 | 影响 |
| --- | --- | --- |
| 仓库存在性 | HTTP 200，仓库 ID `1414249597` | ✅ 可直接使用 |
| 可见性 | `private: false` → **公开仓库** | ⚠️ 放大了 P3 的重要性：任何误提交将立即对全网可见 |
| 默认分支 | `branches: []` → **空仓库，无任何提交** | ✅ 无需处理历史冲突，可直接首推 |
| 仓库名 | `-deepseek-` | 本项目为多提供方（CodeBuddy / OpenAI 兼容 / Mock），DeepSeek 属于「OpenAI 兼容」路径，README 与 `.env.example` 已含 DeepSeek 示例；命名侧重差异需确认（见 §4 R6） |

### 1.3 前置条件（当前阻塞）

| # | 阻塞项 | 现状 | 解决方式 |
| --- | --- | --- | --- |
| B1 | 本机未安装 Git | 已在 Program Files / LOCALAPPDATA / USERPROFILE / scoop / chocolatey 全量搜索，无 `git.exe` | 需批准安装（`winget install --id Git.Git -e`）或使用便携版 |
| B2 | 推送鉴权 | 尚无任何凭据 | 建议首次 `push` 时由 Git Credential Manager 弹浏览器授权；**不得在对话中粘贴 PAT** |
| B3 | 提交作者身份 | 未确认 | 建议使用 GitHub noreply 邮箱，避免公开仓库暴露私人邮箱 |

### 1.4 明确不在本次范围

- 仓库改名、License 变更、GitHub Actions / CI、README 增删徽章
- 历史重写工具（filter-repo）的预置安装
- 将 `data/chat.db` 等运行数据纳入版本管理（永久排除）

---

## 2. 涉及的模块与文件

### 2.1 变更（本次新增/修改）

| 路径 | 类型 | 说明 |
| --- | --- | --- |
| `.gitignore` | 修改 | 追加 `.codebuddy/settings.local.json`、`*.db`、`*.db-wal`、`*.db-shm`（**已实施**） |
| `docs/commits/_TEMPLATE.md` | 新增 | 提交实施计划模板（已实施） |
| `docs/commits/2026-10-11-01-wechat-ai-gateway-baseline.md` | 新增 | 基线变更集实施计划（已实施） |
| `docs/commits/2026-10-11-02-github-publish.md` | 新增 | 本计划 |
| `README.md` | 修改 | 新增「提交规范」章节（已实施） |
| `.git/` | 新增（仓库外） | 本地仓库元数据，**不入库** |

### 2.2 首次入库内容（来自计划 `2026-10-11-01`）

共 45 个文件 + 4 个 docs 文件：`server/**`（17）、`src/**`（19）、`scripts/**`（1）、工程配置（8）、文档（3）。

### 2.3 明确排除（由 `.gitignore` 保障）

`node_modules/`、`dist/`、`data/`、`.env`、`*.tsbuildinfo`、`.codebuddy/settings.local.json`、`*.db*`

---

## 3. 具体修改步骤

> 拆成 3 个提交，便于逐项评审与独立回滚。

### 提交 A：`docs: 建立提交实施计划规范与模板`

| # | 动作 | 命令 / 文件 | 验证 |
| --- | --- | --- | --- |
| A1 | 确认仅有规范类改动 | `git add docs/commits/_TEMPLATE.md README.md` | `git diff --cached --stat` 只含 2 文件 |
| A2 | 提交 | `git commit -F-`（消息见附 B.1） | `git show --stat HEAD` |

### 提交 B：`feat(gateway): 微信 AI 接入网关基线`

| # | 动作 | 命令 | 验证 |
| --- | --- | --- | --- |
| B1 | 纳入基线代码 | `git add server src scripts index.html package.json package-lock.json vite.config.ts tsconfig*.json tailwind.config.js postcss.config.js .env.example docs/commits/2026-10-11-01-*.md` | — |
| B2 | **入库清单复核** | `git ls-files` | 逐条确认无 `node_modules`/`dist`/`data`/`.env`/`*.db` |
| B3 | **密钥二次扫描** | `git grep -nE 'sk-[A-Za-z0-9]{16,}\|ghp_[A-Za-z0-9]{20,}\|-----BEGIN .*PRIVATE KEY-----' --cached` | 无真实命中（仅 `.env.example` 占位符） |
| B4 | 构建回归 | `npm run build` | exit 0 |
| B5 | 端到端回归 | `npm run server` + `node scripts/verify-wechat.mjs` | 31/31 通过 |
| B6 | 提交 | `git commit -F-`（消息见附 B.2，含 `ref:` 计划编号） | `git show --stat HEAD` |

### 提交 C：`chore: 发布前加固 gitignore 与发布计划`

| # | 动作 | 命令 | 验证 |
| --- | --- | --- | --- |
| C1 | 纳入加固与计划 | `git add .gitignore docs/commits/2026-10-11-02-*.md` | — |
| C2 | 提交 | `git commit -F-`（消息见附 B.3） | — |

### 发布（推送）

| # | 动作 | 命令 | 验证 |
| --- | --- | --- | --- |
| D1 | 建立远程 | `git remote add origin https://github.com/zhoulianghao000-web/-deepseek-.git` | `git remote -v` |
| D2 | 首推 | `git push -u origin main`（首次触发凭据管理器浏览器授权） | 输出 `main -> main` |
| D3 | 远端复核 | `git ls-remote origin refs/heads/main` 与 `git rev-parse HEAD` | 两侧 sha **完全一致** |
| D4 | 仓库文件树抽查 | GitHub API `git/trees/main?recursive=1` | 无敏感路径；文件数与本地 `git ls-files` 一致 |
| D5 | 克隆复现（可选但建议） | 临时目录 `git clone` → `npm install` → `npm run build` | 构建通过，证明仓库自洽 |

### 提交 D：`docs: 回填发布验证证据并校正文件清单`

| # | 动作 | 命令 | 验证 |
| --- | --- | --- | --- |
| E1 | 回填本计划附 A 证据表、勾选附 C 决策项 | 本文件 | 证据与实测输出一致 |
| E2 | 校正计划 `2026-10-11-01` 的文件计数 | 计划 01 §2 | 与 `git ls-files`（47）一致 |
| E3 | 提交并推送 | `git commit -F` + `git push` | `git status` 干净、`origin/main` sha 更新 |

> 提交 D 属于本计划的收尾步骤（其工作内容即附 A 的「回填」），故不另立计划文档。

### 初始化与身份（仅执行一次）

| # | 动作 | 命令 | 说明 |
| --- | --- | --- | --- |
| I1 | `git init -b main` | — | 在项目根目录 |
| I2 | 设置**仅本仓库**作者身份 | `git config user.name "<name>"` / `git config user.email "<noreply>"` | 不使用 `--global`，不影响本机其他仓库 |

---

## 4. 潜在风险

| # | 风险 | 影响面 | 可能性 | 应对措施 |
| --- | --- | --- | --- | --- |
| R1 | **公开仓库泄漏密钥** | 不可逆（爬虫秒级抓取） | 中 | 三重防线：`.gitignore` 加固（已做）→ `git ls-files` 清单人工复核 → `git grep --cached` 模式扫描；推送后再抽查远端文件树 |
| R2 | `data/chat.db` 含测试 Token 与对话内容 | 数据泄漏 | 中 | `data/` 与 `*.db*` 已列入 `.gitignore`；提交前确认 `git ls-files` 无命中 |
| R3 | 首次推送鉴权失败 | 流程中断 | 中 | 使用 Git Credential Manager 浏览器流程；**不接受在对话中粘贴 PAT**；若走 PAT，须用最小权限（仅 `repo`）并事后可撤销 |
| R4 | 提交作者邮箱暴露隐私 | 隐私 | 中 | 使用 GitHub noreply 邮箱 `<用户ID>+<login>@users.noreply.github.com` |
| R5 | 安装 Git 失败（网络/权限） | 阻塞 | 中 | 备选：下载便携版 Git 解压至用户目录并临时注入 PATH |
| R6 | 仓库名 `-deepseek-` 与项目多提供方定位不一致 | 认知偏差 | 中 | README 已列 DeepSeek 为兼容服务；建议后续调整文档侧重或确认命名意图（本计划不擅自改名） |
| R7 | 误入库 `.codebuddy/settings.local.json` 等本地状态 | 噪音/隐私 | 低 | 已加入 `.gitignore`；提交前清单复核 |
| R8 | 误入库 `node_modules`（620 包，超 GitHub 限制） | 推送失败/仓库膨胀 | 低 | `node_modules/` 已 gitignore；`git ls-files \| wc -l` 应在 50 左右而非数千 |
| R9 | 单个巨型提交不易评审 | 评审质量 | 中 | 拆为 3 个语义化提交（§3），每个可独立 revert |
| R10 | 计划与提交内容不一致（文档漂移） | 追溯失真 | 中 | 提交信息强制 `ref:` 计划编号；本计划在推送前定稿 |

---

## 5. 回滚方案

**触发条件**（满足任一即回滚）

- 远端文件树出现 `.env` / `data/` / `*.db` / `node_modules/` 等敏感或冗余路径
- 密钥扫描在**已推送**内容中发现真实凭证
- 构建或冒烟测试在干净克隆后失败

**回滚步骤**

```bash
# 情形 1：尚未推送（最安全）
rm -rf .git                      # 完全撤销本地仓库，工作区文件不受影响

# 情形 2：已推送但仓库应回到空状态（空仓库首次推送后）
git push origin --delete main    # 删除远端分支 → 仓库恢复为空
# 或直接在 GitHub 设置中删除/重建仓库（更彻底）

# 情形 3：已推送且需撤销某个提交（保留历史）
git revert <sha>                 # 追加反向提交，随后 push
```

**敏感信息已推送到公开仓库的应急处置（顺序不可颠倒）**

1. **先轮换密钥**：CodeBuddy API Key / OpenAI Key / 微信 Token 与 AppSecret 立即作废并重新签发（历史重写无法阻止已发生的抓取）；
2. 再清理历史：`git rm --cached <file>` + `git filter-repo --path <file> --invert-paths`（或交互式 rebase）；
3. 强制推送需**用户显式批准**（本仓库为新建空仓库，风险可控）；
4. 复核：GitHub API 文件树 + `git log --all --diff-filter=D --name-only` 确认已清除。

**降级手段（不必回滚）**

- 将仓库转为 `private`（GitHub 设置）→ 立即切断公开暴露面
- 保留本地仓库、暂缓推送（`git status` 干净即可随时继续）

**回滚后验证**

```bash
git ls-remote origin                                    # 期望：无输出或指向已回滚的 sha
node scripts/verify-wechat.mjs                          # 期望：31 项通过 / 0 失败
npm run build                                           # 期望：exit 0
```

---

## 附 A. 验证证据（已回填 · 2026-10-11 实测）

| 验证项 | 命令 / 操作 | 结果 |
| --- | --- | --- |
| 提交前密钥扫描 | 全仓模式扫描 `sk-*` / `ghp_*` / `AKIA*` / `xox[bp]-` / 私钥头 | **无真实命中**（仅 `.env.example` 占位符）✅ |
| `.gitignore` 生效 | `git check-ignore -v node_modules dist data .env .codebuddy/settings.local.json` | 5 项全部命中忽略规则 ✅ |
| 入库清单复核 | `git status --porcelain -uall` | **47 项**，敏感/冗余路径排查 **无命中** ✅ |
| 提交历史 | `git log --oneline --shortstat` | 3 个提交：`3990f49`(1 文件) / `a3c2f81`(44 文件) / `4bcb5dd`(2 文件) ✅ |
| 远端 sha 一致性 | `git rev-parse HEAD` vs `git ls-remote origin refs/heads/main` | **均为 `4bcb5dda4cc049b758a0e4797480610a370e8ef1`** ✅ |
| 远端文件树抽查 | GitHub API `git/trees/main?recursive=1` | blob **47** 个 = 本地入库数；无 `node_modules`/`dist`/`data`/`.env`/`*.db` ✅ |
| 关键文件存在性 | 同一 API 抽查 | `README.md`/`package.json`/`.gitignore`/`.env.example`/`scripts/verify-wechat.mjs`/`server/index.ts`/`src/pages/DebugPage.tsx` 全部存在 ✅ |
| 干净克隆构建 | `git clone --depth 1` + `npm run build` | `tsc -b` 通过、`✓ built in 2.91s`、exit **0** ✅ |
| 克隆内 `.gitignore` 生效 | 构建后 `git status --short` | **clean**（`dist/` 3 个产物被正确忽略）✅ |
| 推送结果 | `git push -u origin main` | `* [new branch] main -> main`，已设置上游跟踪 ✅ |
| 端到端回归（推送前） | `npm run build` + `node scripts/verify-wechat.mjs` | 构建 exit 0；冒烟 **31 项通过 / 0 失败** ✅ |

**环境实测值**

- Git：`2.55.0.windows.5`（`C:\Program Files\Git\cmd\git.exe`，winget 安装，需管理员确认）
- 凭据：`credential.helper=manager`（Git Credential Manager 浏览器授权，未使用 PAT）
- 作者：`zhoulianghao000-web <336448081+zhoulianghao000-web@users.noreply.github.com>`（仅本仓库配置，未改动全局）
- `core.autocrlf=true` → 提交时出现 `LF will be replaced by CRLF` 提示（见附 D）

## 附 B. 提交信息建议

**B.1**

```
docs: 建立提交实施计划规范与模板

统一每次提交前的评审材料结构：目标 / 涉及模块与文件 / 修改步骤 / 潜在风险 / 回滚方案，
并要求附带验证证据与提交信息建议，便于团队审查与后续追溯。

- 新增 docs/commits/_TEMPLATE.md
- README 增加「提交规范」章节
```

**B.2**

```
feat(gateway): 微信 AI 接入网关基线（公众号对话 + API-Key 管理 + 管理控制台）

将 init-cbc-sdk-web 模板改造为微信 AI 接入网关：
- 微信接入：签名校验、XML 解析、去重、被动回复/客服消息推送
- AI 抽象：CodeBuddy SDK / OpenAI 兼容（含 DeepSeek）/ Mock，可切换与自动回退
- 上下文：按用户隔离会话，支持 SDK 会话续接与关键词重置
- 管理台：概览/对话记录/调试台/API-Key/微信接入/日志 六页 + 可选 ADMIN_TOKEN
- 调试台：管线逐阶段追踪、一次性参数覆盖、浏览器控制台捕获
- 修复：XML 解析正则、rowid 查询、tsc 产物污染、路由与端点撞名、移动端导航

验证：npm run build 通过；scripts/verify-wechat.mjs 31/31；六页 0 console 错误
ref: docs/commits/2026-10-11-01-wechat-ai-gateway-baseline.md
```

**B.3**

```
chore: 发布前加固 gitignore 与发布计划

- .gitignore 排除本地 IDE 状态与 SQLite 副本（.codebuddy/settings.local.json、*.db*）
- 新增发布实施计划 docs/commits/2026-10-11-02-github-publish.md
ref: docs/commits/2026-10-11-02-github-publish.md
```

## 附 C. 决策项（已确认并执行）

| # | 决策项 | 结论 | 执行结果 |
| --- | --- | --- | --- |
| D1 | 是否批准安装 Git | ✅ 批准 | `winget install --id Git.Git -e` → 2.55.0.windows.5 |
| D2 | 提交作者身份 | ✅ 用 GitHub noreply 邮箱 | 仅本仓库：`user.name=zhoulianghao000-web`、`user.email=336448081+zhoulianghao000-web@users.noreply.github.com` |
| D3 | 推送鉴权方式 | ✅ 凭据管理器浏览器授权 | `credential.helper=manager`，**全程未使用/未记录 PAT** |
| D4 | 是否可公开 | ✅ 确认可公开 | 仓库保持 `public` |
| D5 | 提交粒度 | ✅ 拆 3 个提交 | `3990f49` / `a3c2f81` / `4bcb5dd`（另追加收尾提交 D 回填证据） |

## 附 D. 遗留 TODO（转入后续提交）

- [ ] **新增 `.gitattributes`**：`core.autocrlf=true` 导致提交时出现 LF→CRLF 提示；建议加 `* text=auto eol=lf` 统一跨平台行尾，避免后续 diff 噪音（属独立工程提交，本次未做以保持已批准的提交范围）
- [ ] 计划 01 的文件计数已在本次提交 D 中校正（原写 45，实际 47）
- [ ] 移除已无引用的 `tdesign-react`、`@tdesign-react/chat`、`tdesign-icons-react` 及其 `tailwind.config.js` 颜色别名
- [ ] 微信「安全模式」EncodingAESKey 解密；多模态消息处理；去重缓存与 `access_token` 迁移至 Redis；管理台登录态
