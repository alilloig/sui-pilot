/**
 * Structured JSON logging for Move LSP MCP server
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

/**
 * Set the current log level
 */
export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

/**
 * Check if a log level should be output
 */
export function shouldLog(level: LogLevel): boolean {
  return logLevels[level] >= logLevels[currentLogLevel];
}

/**
 * Log a structured message to stderr in JSON format
 */
export function log(level: LogLevel, message: string, extra?: Record<string, unknown>): void {
  if (!shouldLog(level)) {
    return;
  }

  const entry: LogEntry = {
    event: 'move_lsp_mcp',
    level,
    timestamp: new Date().toISOString(),
    message,
    ...extra,
  };

  // Always log to stderr to avoid interfering with MCP protocol on stdout
  console.error(JSON.stringify(entry));
}

/**
 * Log debug message
 */
export function debug(message: string, extra?: Record<string, unknown>): void {
  log('debug', message, extra);
}

/**
 * Log info message
 */
export function info(message: string, extra?: Record<string, unknown>): void {
  log('info', message, extra);
}

/**
 * Log warning message
 */
export function warn(message: string, extra?: Record<string, unknown>): void {
  log('warn', message, extra);
}

/**
 * Log error message
 */
export function error(message: string, extra?: Record<string, unknown>): void {
  log('error', message, extra);
}