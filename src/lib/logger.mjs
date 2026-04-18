/**
 * Backend logging: stdout + optional file (LOG_FILE).
 * LOG_LEVEL=error|warn|info|debug (default info). DEBUG shows Yahoo/benchmark detail.
 */
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const envLevel = (process.env.LOG_LEVEL || "info").toLowerCase();
const minLevel = LEVELS[envLevel] ?? 2;
const logFilePath = (process.env.LOG_FILE || "").trim();

let logDirEnsured = false;

function shouldLog(level) {
  return LEVELS[level] <= minLevel;
}

function formatLine(level, scope, msg, meta) {
  const base = `[${new Date().toISOString()}] ${level.toUpperCase()} [${scope}] ${msg}`;
  if (meta && typeof meta === "object" && Object.keys(meta).length > 0) {
    try {
      return `${base} ${JSON.stringify(meta)}`;
    } catch {
      return `${base} (meta)`;
    }
  }
  return base;
}

async function appendToFile(line) {
  if (!logFilePath) {
    return;
  }
  try {
    if (!logDirEnsured) {
      const dir = path.dirname(logFilePath);
      if (dir && dir !== ".") {
        await mkdir(dir, { recursive: true });
      }
      logDirEnsured = true;
    }
    await appendFile(logFilePath, `${line}\n`, "utf8");
  } catch (err) {
    console.error("[logger] LOG_FILE write failed:", err);
  }
}

/**
 * @param {"error"|"warn"|"info"|"debug"} level
 * @param {string} scope
 * @param {string} message
 * @param {Record<string, unknown>} [meta]
 */
export function logLine(level, scope, message, meta = {}) {
  if (!shouldLog(level)) {
    return;
  }
  const line = formatLine(level, scope, message, meta);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
  void appendToFile(line);
}

export function logError(scope, message, meta) {
  logLine("error", scope, message, meta);
}

export function logWarn(scope, message, meta) {
  logLine("warn", scope, message, meta);
}

export function logInfo(scope, message, meta) {
  logLine("info", scope, message, meta);
}

export function logDebug(scope, message, meta) {
  logLine("debug", scope, message, meta);
}

export function logStartupSummary() {
  logInfo("logger", "config", {
    LOG_LEVEL: envLevel,
    LOG_FILE: logFilePath || "(stdout only)",
  });
}
