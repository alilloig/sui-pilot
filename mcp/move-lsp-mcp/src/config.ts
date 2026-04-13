/**
 * Configuration management for Move LSP MCP server
 */

export interface Config {
  moveAnalyzerPath: string;
  moveLspTimeoutMs: number;
  moveLspLogLevel: string;
  moveLspMaxRestarts: number;
}

/**
 * Parse configuration from environment variables
 */
export function parseConfig(): Config {
  return {
    moveAnalyzerPath: process.env.MOVE_ANALYZER_PATH || '',
    moveLspTimeoutMs: parseInt(process.env.MOVE_LSP_TIMEOUT_MS || '10000', 10),
    moveLspLogLevel: process.env.MOVE_LSP_LOG_LEVEL || 'info',
    moveLspMaxRestarts: parseInt(process.env.MOVE_LSP_MAX_RESTARTS || '3', 10),
  };
}

/**
 * Validate configuration values
 */
export function validateConfig(config: Config): void {
  if (config.moveLspTimeoutMs <= 0) {
    throw new Error('MOVE_LSP_TIMEOUT_MS must be a positive number');
  }

  if (config.moveLspMaxRestarts < 0) {
    throw new Error('MOVE_LSP_MAX_RESTARTS must be non-negative');
  }

  if (!['debug', 'info', 'warn', 'error'].includes(config.moveLspLogLevel)) {
    throw new Error('MOVE_LSP_LOG_LEVEL must be one of: debug, info, warn, error');
  }
}