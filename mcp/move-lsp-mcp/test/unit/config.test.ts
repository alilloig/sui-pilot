/**
 * Unit tests for configuration parsing
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { parseConfig, validateConfig } from '../../src/config.js';

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('parseConfig', () => {
    test('should use defaults when no env vars set', () => {
      delete process.env.MOVE_ANALYZER_PATH;
      delete process.env.MOVE_LSP_TIMEOUT_MS;
      delete process.env.MOVE_LSP_LOG_LEVEL;
      delete process.env.MOVE_LSP_MAX_RESTARTS;

      const config = parseConfig();

      expect(config).toEqual({
        moveAnalyzerPath: '',
        moveLspTimeoutMs: 10000,
        moveLspLogLevel: 'info',
        moveLspMaxRestarts: 3,
      });
    });

    test('should use env vars when provided', () => {
      process.env.MOVE_ANALYZER_PATH = '/custom/path/move-analyzer';
      process.env.MOVE_LSP_TIMEOUT_MS = '5000';
      process.env.MOVE_LSP_LOG_LEVEL = 'debug';
      process.env.MOVE_LSP_MAX_RESTARTS = '5';

      const config = parseConfig();

      expect(config).toEqual({
        moveAnalyzerPath: '/custom/path/move-analyzer',
        moveLspTimeoutMs: 5000,
        moveLspLogLevel: 'debug',
        moveLspMaxRestarts: 5,
      });
    });

    test('should handle invalid numeric values gracefully', () => {
      process.env.MOVE_LSP_TIMEOUT_MS = 'invalid';
      process.env.MOVE_LSP_MAX_RESTARTS = 'also-invalid';

      const config = parseConfig();

      // parseInt returns NaN for invalid strings
      expect(config.moveLspTimeoutMs).toBeNaN();
      expect(config.moveLspMaxRestarts).toBeNaN();
    });
  });

  describe('validateConfig', () => {
    test('should accept valid config', () => {
      const config = {
        moveAnalyzerPath: '/path/to/analyzer',
        moveLspTimeoutMs: 10000,
        moveLspLogLevel: 'info',
        moveLspMaxRestarts: 3,
      };

      expect(() => validateConfig(config)).not.toThrow();
    });

    test('should reject negative timeout', () => {
      const config = {
        moveAnalyzerPath: '/path/to/analyzer',
        moveLspTimeoutMs: -1000,
        moveLspLogLevel: 'info',
        moveLspMaxRestarts: 3,
      };

      expect(() => validateConfig(config)).toThrow('MOVE_LSP_TIMEOUT_MS must be a positive number');
    });

    test('should reject zero timeout', () => {
      const config = {
        moveAnalyzerPath: '/path/to/analyzer',
        moveLspTimeoutMs: 0,
        moveLspLogLevel: 'info',
        moveLspMaxRestarts: 3,
      };

      expect(() => validateConfig(config)).toThrow('MOVE_LSP_TIMEOUT_MS must be a positive number');
    });

    test('should reject negative max restarts', () => {
      const config = {
        moveAnalyzerPath: '/path/to/analyzer',
        moveLspTimeoutMs: 10000,
        moveLspLogLevel: 'info',
        moveLspMaxRestarts: -1,
      };

      expect(() => validateConfig(config)).toThrow('MOVE_LSP_MAX_RESTARTS must be non-negative');
    });

    test('should accept zero max restarts', () => {
      const config = {
        moveAnalyzerPath: '/path/to/analyzer',
        moveLspTimeoutMs: 10000,
        moveLspLogLevel: 'info',
        moveLspMaxRestarts: 0,
      };

      expect(() => validateConfig(config)).not.toThrow();
    });

    test('should reject invalid log level', () => {
      const config = {
        moveAnalyzerPath: '/path/to/analyzer',
        moveLspTimeoutMs: 10000,
        moveLspLogLevel: 'invalid',
        moveLspMaxRestarts: 3,
      };

      expect(() => validateConfig(config)).toThrow('MOVE_LSP_LOG_LEVEL must be one of: debug, info, warn, error');
    });

    test('should accept all valid log levels', () => {
      const validLevels = ['debug', 'info', 'warn', 'error'];

      for (const level of validLevels) {
        const config = {
          moveAnalyzerPath: '/path/to/analyzer',
          moveLspTimeoutMs: 10000,
          moveLspLogLevel: level,
          moveLspMaxRestarts: 3,
        };

        expect(() => validateConfig(config)).not.toThrow();
      }
    });
  });
});