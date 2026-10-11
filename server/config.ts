/**
 * 服务端全局配置
 *
 * 负责：加载 .env（零依赖实现）、暴露运行时配置常量。
 * 注意：只在此处读取环境变量，业务模块统一从 config / settings 服务获取配置。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 项目根目录（server/ 的上一级） */
export const PROJECT_ROOT = path.resolve(__dirname, "..");

/**
 * 极简 .env 加载器：不覆盖已存在的进程环境变量。
 * 使用零依赖实现，避免额外安装 dotenv。
 */
function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(PROJECT_ROOT, ".env"));

function toNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  /** HTTP 服务端口 */
  port: toNumber(process.env.PORT, 3000),
  /** 管理接口令牌（可选）。设置后 /api/admin/* 需携带 x-admin-token 请求头 */
  adminToken: process.env.ADMIN_TOKEN || "",
  /** AI Agent 工作目录（CodeBuddy SDK cwd） */
  agentCwd: process.env.AGENT_CWD || PROJECT_ROOT,
  /** 是否把日志同时输出到控制台 */
  logToConsole: process.env.LOG_TO_CONSOLE !== "0",
  /** 请求体大小上限 */
  jsonLimit: process.env.JSON_LIMIT || "2mb",
  /** 对外可访问的基础地址（用于展示微信接入 URL），如 https://your-domain.com */
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, ""),
};

export default config;
