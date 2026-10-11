/**
 * 统一日志服务
 *
 * - 写入 SQLite（用于 Web 控制台的运行状态 / 日志页）
 * - 可选输出到控制台
 * - 内置脱敏：detail 中键名含 key/token/secret/password 的字段自动打码
 * - 任何写库失败都不会影响主流程
 */
import * as db from "./db.js";
import config from "./config.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEY = /(key|token|secret|password|authorization)/i;

function mask(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 4) return "[deep]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k) && typeof v === "string") {
        out[k] = mask(v);
      } else {
        out[k] = sanitize(v, depth + 1);
      }
    }
    return out;
  }
  if (typeof value === "string") return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  return value;
}

function serializeDetail(detail: unknown): string | null {
  if (detail === undefined || detail === null) return null;
  try {
    return JSON.stringify(sanitize(detail));
  } catch {
    return String(detail);
  }
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function write(level: LogLevel, scope: string, message: string, detail?: unknown): void {
  if (config.logToConsole) {
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${scope}] ${message}`;
    if (level === "error") console.error(line, detail ?? "");
    else if (level === "warn") console.warn(line, detail ?? "");
    else console.log(line, detail ?? "");
  }
  try {
    db.insertLog({ level, scope, message, detail: serializeDetail(detail) });
  } catch {
    // 日志写库失败不应影响业务
  }
}

export const logger = {
  debug: (scope: string, message: string, detail?: unknown) => write("debug", scope, message, detail),
  info: (scope: string, message: string, detail?: unknown) => write("info", scope, message, detail),
  warn: (scope: string, message: string, detail?: unknown) => write("warn", scope, message, detail),
  error: (scope: string, message: string, detail?: unknown) => write("error", scope, message, detail),
  /** 供外部复用的脱敏工具 */
  mask,
};

export { LEVEL_ORDER };
export default logger;
