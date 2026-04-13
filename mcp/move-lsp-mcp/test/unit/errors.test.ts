/**
 * Unit tests for error classes
 */

import { describe, test, expect } from 'vitest';
import {
  MoveLspError,
  BinaryNotFoundError,
  NoWorkspaceError,
  LspStartFailedError,
  LspTimeoutError,
  LspCrashedError,
  LspProtocolError,
  SymbolNotFoundError,
  BINARY_NOT_FOUND,
  NO_WORKSPACE,
  LSP_START_FAILED,
  LSP_TIMEOUT,
  LSP_CRASHED,
  LSP_PROTOCOL_ERROR,
  SYMBOL_NOT_FOUND,
} from '../../src/errors.js';

describe('MoveLspError', () => {
  test('should create error with message, code, and details', () => {
    const error = new MoveLspError('test message', 'TEST_CODE', { foo: 'bar' });

    expect(error.message).toBe('test message');
    expect(error.code).toBe('TEST_CODE');
    expect(error.details).toEqual({ foo: 'bar' });
    expect(error.name).toBe('MoveLspError');
    expect(error instanceof Error).toBe(true);
  });
});

describe('BinaryNotFoundError', () => {
  test('should have BINARY_NOT_FOUND code', () => {
    const error = new BinaryNotFoundError();
    expect(error.code).toBe(BINARY_NOT_FOUND);
  });

  test('should include path in message when provided', () => {
    const error = new BinaryNotFoundError('/custom/path');
    expect(error.message).toContain('/custom/path');
  });
});

describe('NoWorkspaceError', () => {
  test('should have NO_WORKSPACE code', () => {
    const error = new NoWorkspaceError('/some/path');
    expect(error.code).toBe(NO_WORKSPACE);
  });

  test('should include path in message', () => {
    const error = new NoWorkspaceError('/some/path');
    expect(error.message).toContain('/some/path');
  });
});

describe('LspStartFailedError', () => {
  test('should have LSP_START_FAILED code', () => {
    const error = new LspStartFailedError('connection refused');
    expect(error.code).toBe(LSP_START_FAILED);
  });

  test('should include reason in message', () => {
    const error = new LspStartFailedError('connection refused');
    expect(error.message).toContain('connection refused');
  });
});

describe('LspTimeoutError', () => {
  test('should have LSP_TIMEOUT code', () => {
    const error = new LspTimeoutError('initialize', 10000);
    expect(error.code).toBe(LSP_TIMEOUT);
  });

  test('should include method and timeout in message', () => {
    const error = new LspTimeoutError('initialize', 10000);
    expect(error.message).toContain('initialize');
    expect(error.message).toContain('10000');
  });

  test('should include method and timeout in details', () => {
    const error = new LspTimeoutError('textDocument/hover', 5000);
    expect(error.details).toEqual({ method: 'textDocument/hover', timeoutMs: 5000 });
  });
});

describe('LspCrashedError', () => {
  test('should have LSP_CRASHED code', () => {
    const error = new LspCrashedError(1, null);
    expect(error.code).toBe(LSP_CRASHED);
  });

  test('should include exit code in message', () => {
    const error = new LspCrashedError(1, null);
    expect(error.message).toContain('1');
  });

  test('should include signal when provided', () => {
    const error = new LspCrashedError(null, 'SIGKILL');
    expect(error.message).toContain('SIGKILL');
  });

  test('should include exitCode and signal in details', () => {
    const error = new LspCrashedError(1, 'SIGTERM');
    expect(error.details).toEqual({ exitCode: 1, signal: 'SIGTERM' });
  });
});

describe('LspProtocolError', () => {
  test('should have LSP_PROTOCOL_ERROR code', () => {
    const error = new LspProtocolError('invalid JSON-RPC message');
    expect(error.code).toBe(LSP_PROTOCOL_ERROR);
  });

  test('should include message', () => {
    const error = new LspProtocolError('invalid JSON-RPC message');
    expect(error.message).toContain('invalid JSON-RPC message');
  });
});

describe('SymbolNotFoundError', () => {
  test('should have SYMBOL_NOT_FOUND code', () => {
    const error = new SymbolNotFoundError('MyStruct');
    expect(error.code).toBe(SYMBOL_NOT_FOUND);
  });

  test('should include symbol name in message', () => {
    const error = new SymbolNotFoundError('MyStruct');
    expect(error.message).toContain('MyStruct');
  });

  test('should include location when provided', () => {
    const error = new SymbolNotFoundError('MyStruct', 'file.move:10:5');
    expect(error.message).toContain('file.move:10:5');
  });

  test('should include symbol and location in details', () => {
    const error = new SymbolNotFoundError('MyStruct', 'file.move:10:5');
    expect(error.details).toEqual({ symbol: 'MyStruct', location: 'file.move:10:5' });
  });
});

describe('Error codes', () => {
  test('should export all required error codes', () => {
    expect(LSP_TIMEOUT).toBe('LSP_TIMEOUT');
    expect(LSP_CRASHED).toBe('LSP_CRASHED');
    expect(LSP_PROTOCOL_ERROR).toBe('LSP_PROTOCOL_ERROR');
    expect(SYMBOL_NOT_FOUND).toBe('SYMBOL_NOT_FOUND');
  });
});
