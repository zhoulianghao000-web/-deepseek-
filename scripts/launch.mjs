/**
 * 一键启动器
 *
 * 职责：
 *   1. 探测目标端口是否已有健康实例（有则只打开浏览器，不重复启动）
 *   2. 自检运行前置条件（node_modules / tsx / dist）并给出可操作提示
 *   3. 启动服务端（tsx 直接运行 TypeScript 源码）
 *   4. 轮询 /api/health 就绪后自动打开管理控制台
 *   5. 转发退出信号，保持前台可控
 *
 * 用法：
 *   node scripts/launch.mjs          # 或双击 启动.cmd
 *   set PORT=3100 && 启动.cmd        # 换端口
 *   set NO_OPEN=1 && 启动.cmd        # 不自动打开浏览器
 */
import { existsSync } from 'node:fs';
import { exec, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.PORT || '3000';
const url = `http://localhost:${port}`;

const log = (message) => console.log(message);
const warn = (message) => console.warn(message);

/** 目标端口是否已有本服务在运行 */
async function healthOk() {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

function openBrowser() {
  if (process.env.NO_OPEN === '1') {
    log(`已跳过自动打开浏览器（NO_OPEN=1），请手动访问 ${url}`);
    return;
  }
  try {
    if (process.platform === 'win32') exec(`start "" "${url}"`, { shell: 'cmd.exe' });
    else if (process.platform === 'darwin') exec(`open "${url}"`);
    else exec(`xdg-open "${url}"`);
  } catch {
    warn(`无法自动打开浏览器，请手动访问 ${url}`);
  }
}

log('════════════ 微信 AI 接入网关 ════════════');
log(`工作目录   : ${root}`);
log(`Node 运行时: ${process.version}  (${process.execPath})`);
log(`服务端口   : ${port}`);

// 1) 已有实例：直接打开控制台，避免端口冲突
//    退出码 3 = 「无需启动，已有实例」，供 启动.cmd 区分并自动关闭窗口
if (await healthOk()) {
  log(`检测到服务已在运行：${url}`);
  log('无需重复启动，正在打开管理控制台，本窗口将自动关闭。');
  openBrowser();
  process.exit(3);
}

// 2) 运行前置条件自检
if (!existsSync(path.join(root, 'node_modules'))) {
  console.error('[错误] 未找到 node_modules 目录。');
  console.error('       开发环境请执行：npm install');
  console.error('       使用发行包时请确认完整解压（不要只复制部分目录）。');
  process.exit(1);
}

const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
if (!existsSync(tsxCli)) {
  console.error('[错误] 缺少 tsx（node_modules/tsx），无法运行服务端。');
  console.error('       请执行：npm install');
  process.exit(1);
}

if (!existsSync(path.join(root, 'dist', 'index.html'))) {
  warn('[提示] 未找到 dist/index.html —— 管理控制台不可用（微信接入与管理 API 仍可工作）。');
  warn('       如需控制台，请先执行：npm run build');
}

// 3) 启动服务端
log('');
log('正在启动服务……（按 Ctrl+C 停止）');
log('');

const child = spawn(process.execPath, [tsxCli, path.join(root, 'server', 'index.ts')], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PORT: port },
});

// 4) 就绪后打开浏览器
//    becameReady 用于区分「启动失败」与「启动成功后被人为停止」：
//    一旦探测到健康实例，此后的任何退出都视为「停止」（退出码 0），
//    否则在就绪前退出才判定为失败（退出码 1）。
let becameReady = false;
const poller = setInterval(async () => {
  if (becameReady || child.exitCode !== null) return;
  if (await healthOk()) {
    becameReady = true;
    clearInterval(poller);
    log('');
    log(`✅ 服务已就绪：${url}`);
    log('   管理控制台已自动打开；关闭本窗口或按 Ctrl+C 可停止服务。');
    openBrowser();
  }
}, 700);

const giveUp = setTimeout(() => {
  if (!becameReady) warn(`等待服务就绪超时（60s），请手动访问 ${url} 并检查上方日志。`);
}, 60_000);

// 5) 信号转发
const shutdown = (signal) => {
  if (child.exitCode === null) child.kill(signal);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

child.on('exit', (code) => {
  clearInterval(poller);
  clearTimeout(giveUp);
  if (becameReady) {
    // 服务曾正常运行 → 属于「停止」，不是失败（避免正常停止也被报成启动失败）
    process.exit(0);
  }
  console.error('');
  console.error(`[失败] 服务在就绪前退出（退出代码 ${code ?? 'unknown'}），请查看上方日志。`);
  process.exit(1);
});
