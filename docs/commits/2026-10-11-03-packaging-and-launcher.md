# 实施计划：一键启动入口 + 自包含打包发布

| 项 | 内容 |
| --- | --- |
| 计划编号 | `2026-10-11-03` |
| 关联提交 | 待提交 |
| 分支 | `main` |
| 作者 / 日期 | AI 助手 / 2026-10-11 |
| 状态 | 实施中 |
| 变更类型 | 特性（开发者体验）+ 工程（构建产物打包） |

---

## 1. 本次提交的目标

**要解决的问题**

当前启动方式为 `npm run dev` / `npm run server`，要求使用者：已装 Node 且在 PATH 中、会开终端、会敲命令。
实际环境 **Node 未加入系统 PATH**（仅在 `~/.codex/mcp-servers/node-v24.21.0-win-x64`），普通使用者无法直接启动。

**可验收目标（DoD）**

| 编号 | 目标 | 验收标准 |
| --- | --- | --- |
| L1 | 一键启动入口 | 双击快捷方式即可启动服务并自动打开控制台（无需终端命令、无需配置 PATH） |
| L2 | 自包含运行环境 | 包内自带 Node 运行时，在未安装 Node 的机器上也能启动 |
| L3 | 依赖/构建自检 | 启动器能识别缺失的 `node_modules` / `dist` 并给出明确指引；服务已在运行时直接打开浏览器而不重复启动 |
| L4 | 打包产物完整可用 | 解压后目录结构完整（源码 + 依赖 + 构建产物 + 运行时 + 启动器），构建与冒烟测试在包内可通过 |
| L5 | 快捷方式指向正确 | `.lnk` 目标为包内启动器绝对路径、工作目录正确、图标/名称可辨识；双击实测可启动 |

**明确不在本次范围**

- 安装程序（MSI/Inno Setup）与开机自启
- 生产环境进程守护（pm2 / NSSM / Windows 服务）
- 打包体积裁剪（保留完整 devDependencies，便于二次构建；体积优化见 §4 R2）

---

## 2. 涉及的模块与文件

### 2.1 新增（仓库内）

| 路径 | 说明 |
| --- | --- |
| `scripts/launch.mjs` | 启动器：定位工作目录 → 依赖/构建自检 → 启动服务 → 健康探测 → 打开浏览器 → 转发退出信号 |
| `启动.cmd` | Windows 双击入口：按「包内运行时 → 系统 PATH」顺序定位 Node，再调用 `scripts/launch.mjs` |
| `docs/commits/2026-10-11-03-packaging-and-launcher.md` | 本计划 |

### 2.2 修改（仓库内）

| 路径 | 修改点 | 原因 |
| --- | --- | --- |
| `package.json` | ① 新增 `start` 脚本；② 把 `tsx` 由 `devDependencies` 移入 `dependencies` | `npm run server` / 启动器在运行时依赖 tsx，`npm ci --omit=dev` 场景下会缺失（潜在缺陷） |
| `.gitignore` | 新增 `release/` | 打包中间产物不入库 |
| `README.md` | 新增「一键启动」章节 | 使用者入口说明 |

### 2.3 新增（仓库外 · 打包产物）

```
C:\Users\zl\Desktop\自动聊天助手（违法了微信规则，会被封号）\
├── 微信AI接入网关-v1.0.0.zip          # 打包文件（自包含，可解压到任意目录）
├── 微信AI接入网关\                     # 解压后的可运行副本（快捷方式指向此处）
│   ├── 启动.cmd
│   ├── runtime\node\                  # 便携 Node 运行时（102 MB）
│   ├── node_modules\                  # 依赖（846 MB / 107,743 文件）
│   ├── dist\                           # 前端构建产物
│   ├── server\ src\ scripts\ docs\ …
│   └── README.md
└── 启动微信AI接入网关.lnk              # 便携入口（随文件夹移动仍可用）
C:\Users\zl\Desktop\启动微信AI接入网关.lnk   # 桌面主入口
```

### 2.4 明确排除

`data/`（含已保存的微信 Token、AI 配置与真实对话记录，必须让使用者从零初始化）、`.git/`、`release/` 中间产物、`*.tsbuildinfo`

---

## 3. 具体修改步骤

| # | 动作 | 文件 / 命令 | 关键实现点 | 验证方式 |
| --- | --- | --- | --- | --- |
| 1 | 写启动器 | `scripts/launch.mjs` | 先探测 `PORT` 是否已有健康实例（有则仅开浏览器）；再 `spawn(process.execPath, [tsx cli, server/index.ts])`；轮询 `/api/health` 最多 40s；`start "" <url>` 开浏览器；`SIGINT` 转发 | `node scripts/launch.mjs` 实测 |
| 2 | 写双击入口 | `启动.cmd` | `chcp 65001` 防中文乱码；`cd /d %~dp0`；Node 定位顺序：`runtime\node\node.exe` → `where node` → 报错并 `pause` | 双击/`cmd /c 启动.cmd` |
| 3 | 修正依赖归属 | `package.json` | `tsx` 迁至 `dependencies`；新增 `"start": "node scripts/launch.mjs"` | `npm install` 后 `npm run start` |
| 4 | 忽略打包产物 | `.gitignore` | 追加 `release/` | `git check-ignore -v release` |
| 5 | 文档入口 | `README.md` | 顶部新增「一键启动」：开发方式 / 打包方式 / 数据位置 / 端口修改 | 人工核对 |
| 6 | 回归验证 | `npm run build` + `verify-wechat.mjs` | 确认 1–5 未破坏既有功能 | 构建 exit 0、冒烟 31/31 |
| 7 | 组装打包目录 | `robocopy /MT:16` | 源文件取 `git ls-files`（= 已提交内容，无脏文件）；复制 `node_modules`、`dist`、`runtime\node`；**不复制** `data/`、`.git/` | 目录清单比对 |
| 8 | 生成压缩包 | `[ZipFile]::CreateFromDirectory(..., Fastest, true)` | 用 .NET 原生压缩（`Compress-Archive` 在 10 万文件级下过慢） | 解压后目录结构校验 |
| 9 | 部署到桌面 | 复制压缩包 + 解压副本至目标文件夹 | 目标路径含中文与全角括号，全程用引号包裹 | 路径存在性检查 |
| 10 | 创建快捷方式 | `WScript.Shell` COM 生成 `.lnk` | `TargetPath`=包内 `启动.cmd`；`WorkingDirectory`=包根；`IconLocation` 使用系统图标 | 读回 `.lnk` 属性校验 + 实测双击 |
| 11 | 包内端到端验证 | 在目标目录运行启动器 | 确认包内自带 Node 生效、健康检查通过、`/api/health` 返回 ok | `Invoke-RestMethod http://localhost:PORT/api/health` |
| 12 | 提交并推送 | `git commit` + `git push` | 提交信息引用本计划编号 | `git ls-remote` sha 一致 |

---

## 4. 潜在风险

| # | 风险 | 影响面 | 可能性 | 应对措施 |
| --- | --- | --- | --- | --- |
| R1 | 目标路径含中文 + 全角括号，命令拼接易出错 | 打包/部署失败 | 中 | 所有路径用双引号包裹；避免拼接未转义字符串；关键步骤后做 `Test-Path` 校验 |
| R2 | `node_modules` 846 MB / 107,743 文件，复制与压缩耗时长 | 打包时间与磁盘占用 | 高 | 用 `robocopy /MT:16` 多线程复制；压缩用 .NET `Fastest` 级别；体积裁剪列为后续 TODO |
| R3 | 打包副本含 `data/chat.db`（内有测试 Token 与真实对话） | 数据泄漏 | 中 | **明确排除** `data/`；打包后校验目录树无 `data`；启动器首次运行自动重建空库 |
| R4 | 端口 3000 被占用（本机已有实例在跑） | 启动失败 | 高 | 启动器先探测健康实例：已在运行则直接打开浏览器，不重复启动；`.cmd` 支持 `set PORT=xxxx` 覆盖 |
| R5 | 包内 Node 运行时被误删或架构不符 | 无法启动 | 低 | 启动器回退到系统 PATH 的 `node`，并给出明确错误提示与安装指引 |
| R6 | `tsx` 迁入 `dependencies` 引发锁文件变动 | 依赖一致性 | 低 | 执行 `npm install` 重新解析并验证构建 + 冒烟；失败则回滚该项（不影响打包） |
| R7 | 快捷方式因路径移动而失效 | 入口不可用 | 中 | `WorkingDirectory` 与 `TargetPath` 均使用绝对路径；同时在包内放一份相对入口；README 说明移动后需重建快捷方式 |
| R8 | 前端 `dist` 未构建即打包 | 控制台白屏 | 低 | 打包前强制 `npm run build`；启动器检测 `dist/index.html` 缺失时给出提示 |
| R9 | 压缩包在解压后因中文文件名乱码失败 | 包不可用 | 低 | 文件名含中文，测试用 .NET 压缩并解压校验；必要时改用 exe 自解压或英文包名 |
| R10 | 使用者误把「自动聊天助手」用于个人微信自动化 | 账号被封 | 中 | 本应用走**微信公众号官方服务器接口**（合规路径）；README 已注明仅支持公众号明文模式，不涉及个人微信协议逆向 |
| R11 | **`.NET ZipFile.CreateFromDirectory` 生成的 ZIP 不符合规范**：条目名使用反斜杠分隔、且把父目录名当基础目录 | 跨平台解压异常、多一层目录 | **高（已实际发生）** | 已改用系统自带 bsdtar（libarchive）打包；新增校验断言：反斜杠条目数 = 0、全部条目以 `微信AI接入网关/` 开头、关键条目哈希抽样比对 |

---

## 5. 回滚方案

**触发条件**

- 打包副本启动失败或健康检查不通过
- 快捷方式指向错误/双击无反应
- 包内出现 `data/` 等敏感内容

**代码层回滚**

```bash
git revert <本次 sha>          # 撤销启动器与 package.json/.gitignore/README 改动
# 若仅 tsx 依赖归属有问题：
#   把 tsx 移回 devDependencies 并 npm install
```

**产物层回滚（仓库外，无需 git）**

```powershell
# 删除桌面产物（按需，逐项确认后再执行）
Remove-Item -Recurse -Force 'C:\Users\zl\Desktop\自动聊天助手（违法了微信规则，会被封号）\微信AI接入网关'
Remove-Item -Force 'C:\Users\zl\Desktop\自动聊天助手（违法了微信规则，会被封号）\微信AI接入网关-v1.0.0.zip'
Remove-Item -Force 'C:\Users\zl\Desktop\启动微信AI接入网关.lnk'
```

**降级手段**

- 快捷方式失效时：直接双击包内 `启动.cmd`
- 端口冲突时：`set PORT=3100 && 启动.cmd`
- 不想开浏览器：`set NO_OPEN=1 && 启动.cmd`
- 完全绕开启动器：`npm run server`（开发方式，功能等价）

**回滚后验证**

```powershell
Test-Path 'C:\Users\zl\Desktop\自动聊天助手（违法了微信规则，会被封号）'   # 目标文件夹仍在（用户自有目录，不删除）
Set-Location <项目根>; npm run build; node scripts/verify-wechat.mjs      # 期望 31/31
```

---

## 附 A. 验证证据（已回填 · 2026-10-11 实测）

| 验证项 | 命令 / 操作 | 结果 |
| --- | --- | --- |
| 打包前测试 | `npm run build` + `node scripts/verify-wechat.mjs` | 构建 exit **0**；冒烟 **31/31** ✅ |
| 启动器（开发目录） | `cmd /c 启动.cmd`（`NO_OPEN=1`） | 自动定位 `runtime\node\node.exe`（v24.21.0），健康检查通过，日志中文正常 ✅ |
| 重复启动保护 | 再次运行启动器 | 输出「检测到服务已在运行」并以 **exit 0** 退出，端口未重复监听 ✅ |
| 启动器（包内副本） | 桌面副本 `启动.cmd` | 健康检查通过；服务进程路径 = 包内 `…\微信AI接入网关\runtime\node\node.exe` ✅ |
| 控制台可访问 | `GET /` | **200**，HTML 629 字节（后端静态托管 SPA）✅ |
| 包内无运行数据 | 目录检查 | 无 `data/`、无 `.git/`、无 `.codebuddy/` ✅ |
| 压缩包生成 | bsdtar（规范 ZIP） | **306.8 MB** / 117,132 条目（109,788 文件 + 7,344 目录）✅ |
| 压缩包规范性 | 条目名检查 | 反斜杠条目 **0**；全部以 `微信AI接入网关/` 开头 ✅ |
| 压缩包完整性 | 7 个关键条目抽样解压 + SHA256 比对 | 全部 **一致** ✅ |
| 敏感内容排除（包内） | 应用级路径正则检查 | `data/` `.git/` `.env` `*.db` `.codebuddy/` `*.tsbuildinfo` 均 **0** ✅ |
| 快捷方式属性 | 读回 `.lnk` | `TargetPath` / `WorkingDirectory` / `IconLocation` 全部存在且正确 ✅ |
| 双击等价启动 | `Start-Process <桌面快捷方式>` | 健康检查通过；cmd 窗口命令行指向包内 `启动.cmd` ✅ |
| 部署清单 | 目标文件夹 | `微信AI接入网关\` + `微信AI接入网关-v1.0.0.zip` + `启动微信AI接入网关.lnk`；桌面根另有同名快捷方式 ✅ |

**实测发现并修复的 3 个缺陷**

1. `.NET ZipFile.CreateFromDirectory` 生成的 ZIP 条目名使用**反斜杠**且把父目录名 `pkg` 当作基础目录 → 跨平台解压异常且多一层目录；改用系统自带 **bsdtar/libarchive** 重新打包，并增加规范性断言（见 §4 R11）。
2. 开发目录双击 `启动.cmd` 报「未找到 Node 运行时」——本机 Node 不在系统 PATH；已增加三级定位（包内 `runtime\node\` → PATH → 常见安装位置），并把便携运行时放入项目 `runtime/` 供打包复用。
3. 压缩耗时远超预期（.NET 1262 s / bsdtar 1122 s，因 109,788 个小文件 I/O 密集），已在 §4 R2 记录并列为后续优化项。

## 附 B. 提交信息建议

```
feat(dev): 新增一键启动器与自包含打包支持

- scripts/launch.mjs：依赖/构建自检、端口占用探测、健康探测后自动打开浏览器
- 启动.cmd：包内便携 Node → 系统 PATH 的定位顺序，双击即可启动
- package.json：新增 start 脚本；tsx 由 devDependencies 移入 dependencies
  （npm run server 运行时依赖它，omit=dev 安装会缺失）
- .gitignore：排除打包中间产物 release/
- README：新增「一键启动」章节

验证：构建 exit 0；冒烟 31/31；包内启动与健康检查通过
ref: docs/commits/2026-10-11-03-packaging-and-launcher.md
```

## 附 C. 遗留 TODO

- [ ] 打包体积裁剪：生产安装可 `--omit=dev` + 编译服务端为 JS，去掉 tsx 与前端构建依赖（预计 846 MB → ~150 MB）
- [ ] 安装程序化（Inno Setup）与开机自启、进程守护
- [ ] `.gitattributes` 统一行尾（承接计划 02 附 D）
