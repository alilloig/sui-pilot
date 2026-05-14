/**
 * Structured JSON logging for the sui-prover MCP server. Mirrors the shape
 * of mcp/move-lsp-mcp/src/logger.ts so operator dashboards can ingest both.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  event: string;
  level: LogLevel;
  timestamp: string;
  message: string;
  [key: string]: unknown;
}

let currentLogLevel: LogLevel = 'info';

const logLevels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

export function shouldLog(level: LogLevel): boolean {
  return logLevels[level] >= logLevels[currentLogLevel];
}

export function log(level: LogLevel, message: string, extra?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    event: 'sui_prover_mcp',
    level,
    timestamp: new Date().toISOString(),
    message,
    ...extra,
  };

  // stderr only — stdout is the MCP transport channel.
  console.error(JSON.stringify(entry));
}

export const debug = (m: string, e?: Record<string, unknown>) => log('debug', m, e);
export const info = (m: string, e?: Record<string, unknown>) => log('info', m, e);
export const warn = (m: string, e?: Record<string, unknown>) => log('warn', m, e);
export const error = (m: string, e?: Record<string, unknown>) => log('error', m, e);
