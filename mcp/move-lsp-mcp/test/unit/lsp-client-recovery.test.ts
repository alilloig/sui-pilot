/**
 * Unit tests for LSP client crash recovery, timeout handling, and protocol errors
 * Tests error paths without requiring actual move-analyzer binary
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { MoveLspClient } from '../../src/lsp-client.js';
import { Config } from '../../src/config.js';
import {
  LSP_TIMEOUT,
  LSP_PROTOCOL_ERROR,
  LSP_START_FAILED,
  LSP_CRASHED,
} from '../../src/errors.js';

// Mock logger to avoid noise
vi.mock('../../src/logger.js', () => ({
  log: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

/**
 * Create a mock child process with controllable stdin/stdout/stderr
 */
function createMockChildProcess(): ChildProcess & EventEmitter & {
  stdin: { write: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  pid: number;
} {
  const mockProcess = new EventEmitter() as any;
  mockProcess.stdin = { write: vi.fn() };
  mockProcess.stdout = new EventEmitter();
  mockProcess.stderr = new EventEmitter();
  mockProcess.kill = vi.fn();
  mockProcess.pid = 12345;
  return mockProcess;
}

function createTestConfig(overrides: Partial<Config> = {}): Config {
  return {
    moveAnalyzerPath: '/usr/bin/move-analyzer',
    moveLspTimeoutMs: 100, // Short timeout for tests
    moveLspLogLevel: 'error',
    moveLspMaxRestarts: 3,
    ...overrides,
  };
}

/**
 * Send a valid JSON-RPC response to the mock stdout
 */
function sendJsonRpcResponse(
  mockProcess: ReturnType<typeof createMockChildProcess>,
  id: number,
  result: unknown
): void {
  const response = JSON.stringify({ jsonrpc: '2.0', id, result });
  const header = `Content-Length: ${Buffer.byteLength(response)}\r\n\r\n`;
  mockProcess.stdout.emit('data', Buffer.from(header + response));
}

/**
 * Send a malformed JSON-RPC response to trigger protocol error
 */
function sendMalformedResponse(
  mockProcess: ReturnType<typeof createMockChildProcess>
): void {
  const malformed = 'not valid json {{{';
  const header = `Content-Length: ${Buffer.byteLength(malformed)}\r\n\r\n`;
  mockProcess.stdout.emit('data', Buffer.from(header + malformed));
}

describe('MoveLspClient Error Handling', () => {
  let mockProcess: ReturnType<typeof createMockChildProcess>;
  let client: MoveLspClient;
  const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockProcess = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProcess);
  });

  afterEach(async () => {
    // Run any remaining timers to clear pending promises
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Crash Recovery', () => {
    test('should reject all pending requests with LSP_CRASHED on unexpected exit', async () => {
      const config = createTestConfig();
      client = new MoveLspClient('/usr/bin/move-analyzer', config);

      // Start client - will hang waiting for initialize response
      const startPromise = client.start('/workspace');

      // Simulate initialize response so client starts
      await vi.advanceTimersByTimeAsync(10);
      sendJsonRpcResponse(mockProcess, 1, {
        capabilities: {},
      });
      await startPromise;

      expect(client.isReady()).toBe(true);

      // Create a pending request (hover) - don't send response
      const hoverPromise = client.hover('file:///test.move', 0, 0);

      // Give time for the request to be sent
      await vi.advanceTimersByTimeAsync(10);

      // Simulate process crash before response arrives
      mockProcess.emit('exit', 1, 'SIGSEGV');

      // Verify the pending request rejects with LSP_CRASHED
      await expect(hoverPromise).rejects.toMatchObject({
        code: LSP_CRASHED,
      });

      expect(client.isReady()).toBe(false);
      expect(client.getConsecutiveCrashes()).toBe(1);
    });

    test('should enter hard failed state after max startup failures', async () => {
      const config = createTestConfig({ moveLspMaxRestarts: 2 });
      client = new MoveLspClient('/usr/bin/move-analyzer', config);

      // First startup failure - initialize request times out
      const startPromise1 = client.start('/workspace');

      // Advance timers and await rejection in parallel to prevent unhandled rejection
      await Promise.all([
        vi.advanceTimersByTimeAsync(200),
        expect(startPromise1).rejects.toMatchObject({ code: LSP_START_FAILED }),
      ]);

      // First failure recorded
      expect(client.getConsecutiveCrashes()).toBe(1);
      expect(client.hasHardFailed()).toBe(false);

      // Reset mock for second attempt
      mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // Second startup failure
      const startPromise2 = client.start('/workspace');
      await Promise.all([
        vi.advanceTimersByTimeAsync(200),
        expect(startPromise2).rejects.toMatchObject({ code: LSP_START_FAILED }),
      ]);

      // After 2 consecutive startup failures, should be hard failed
      expect(client.getConsecutiveCrashes()).toBe(2);
      expect(client.hasHardFailed()).toBe(true);
    });

    test('should throw LSP_START_FAILED when hard failed', async () => {
      const config = createTestConfig({ moveLspMaxRestarts: 1 });
      client = new MoveLspClient('/usr/bin/move-analyzer', config);

      // First crash to enter hard failed
      const startPromise = client.start('/workspace');
      await vi.advanceTimersByTimeAsync(10);
      sendJsonRpcResponse(mockProcess, 1, { capabilities: {} });
      await startPromise;
      mockProcess.emit('exit', 1, null);

      expect(client.hasHardFailed()).toBe(true);

      // Attempt to start again should throw
      await expect(client.start('/workspace')).rejects.toMatchObject({
        code: LSP_START_FAILED,
      });
    });

    test('should reset consecutive crashes on successful response', async () => {
      const config = createTestConfig();
      client = new MoveLspClient('/usr/bin/move-analyzer', config);

      // Start and crash once
      const startPromise = client.start('/workspace');
      await vi.advanceTimersByTimeAsync(10);
      sendJsonRpcResponse(mockProcess, 1, { capabilities: {} });
      await startPromise;
      mockProcess.emit('exit', 1, null);

      expect(client.getConsecutiveCrashes()).toBe(1);

      // Reset mock for restart
      mockProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // Successful restart
      const startPromise2 = client.start('/workspace');
      await vi.advanceTimersByTimeAsync(10);
      sendJsonRpcResponse(mockProcess, 2, { capabilities: {} });
      await startPromise2;

      // Crashes should be reset after successful start
      expect(client.getConsecutiveCrashes()).toBe(0);
    });
  });

  describe('Timeout Handling', () => {
    test('should reject with LSP_TIMEOUT after timeout period', async () => {
      const config = createTestConfig({ moveLspTimeoutMs: 50 });
      client = new MoveLspClient('/usr/bin/move-analyzer', config);

      // Start client
      const startPromise = client.start('/workspace');
      await vi.advanceTimersByTimeAsync(10);
      sendJsonRpcResponse(mockProcess, 1, { capabilities: {} });
      await vi.advanceTimersByTimeAsync(10);
      // Initialized notification doesn't need response
      await startPromise;

      // Make a request that will timeout
      const hoverPromise = client.hover('file:///test.move', 0, 0);

      // Advance timers and await rejection in parallel to prevent unhandled rejection
      await Promise.all([
        vi.advanceTimersByTimeAsync(60),
        expect(hoverPromise).rejects.toMatchObject({
          code: LSP_TIMEOUT,
        }),
      ]);
    });

    test('should send SIGTERM on timeout', async () => {
      const config = createTestConfig({ moveLspTimeoutMs: 50 });
      client = new MoveLspClient('/usr/bin/move-analyzer', config);

      // Start client
      const startPromise = client.start('/workspace');
      await vi.advanceTimersByTimeAsync(10);
      sendJsonRpcResponse(mockProcess, 1, { capabilities: {} });
      await startPromise;

      // Make a request that will timeout - attach catch immediately to prevent unhandled rejection
      const hoverPromise = client.hover('file:///test.move', 0, 0).catch(() => {});

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(60);
      await hoverPromise;

      // Should have called kill with SIGTERM
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    test('should mark client as unhealthy after timeout', async () => {
      const config = createTestConfig({ moveLspTimeoutMs: 50 });
      client = new MoveLspClient('/usr/bin/move-analyzer', config);

      // Start client
      const startPromise = client.start('/workspace');
      await vi.advanceTimersByTimeAsync(10);
      sendJsonRpcResponse(mockProcess, 1, { capabilities: {} });
      await startPromise;

      expect(client.isReady()).toBe(true);

      // Make a request that will timeout - attach catch immediately to prevent unhandled rejection
      const hoverPromise = client.hover('file:///test.move', 0, 0).catch(() => {});

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(60);
      await hoverPromise;

      // Client should no longer be ready
      expect(client.isReady()).toBe(false);
      expect(client.needsRestart()).toBe(true);
    });

    test('should include method name in timeout error details', async () => {
      const config = createTestConfig({ moveLspTimeoutMs: 50 });
      client = new MoveLspClient('/usr/bin/move-analyzer', config);

      // Start client
      const startPromise = client.start('/workspace');
      await vi.advanceTimersByTimeAsync(10);
      sendJsonRpcResponse(mockProcess, 1, { capabilities: {} });
      await startPromise;

      // Make a hover request that will timeout
      const hoverPromise = client.hover('file:///test.move', 0, 0);

      // Advance timers and await rejection in parallel to prevent unhandled rejection
      await Promise.all([
        vi.advanceTimersByTimeAsync(60),
        expect(hoverPromise).rejects.toMatchObject({
          code: LSP_TIMEOUT,
          details: expect.objectContaining({
            method: 'textDocument/hover',
            timeoutMs: 50,
          }),
        }),
      ]);
    });
  });

  describe('Malformed JSON-RPC Handling', () => {
    test('should reject with LSP_PROTOCOL_ERROR on malformed response', async () => {
      const config = createTestConfig();
      client = new MoveLspClient('/usr/bin/move-analyzer', config);

      // Start client
      const startPromise = client.start('/workspace');
      await vi.advanceTimersByTimeAsync(10);
      sendJsonRpcResponse(mockProcess, 1, { capabilities: {} });
      await startPromise;

      // Make a request
      const hoverPromise = client.hover('file:///test.move', 0, 0);

      // Send malformed response
      sendMalformedResponse(mockProcess);

      await expect(hoverPromise).rejects.toMatchObject({
        code: LSP_PROTOCOL_ERROR,
      });
    });

    test('should kill child process on protocol error', async () => {
      const config = createTestConfig();
      client = new MoveLspClient('/usr/bin/move-analyzer', config);

      // Start client
      const startPromise = client.start('/workspace');
      await vi.advanceTimersByTimeAsync(10);
      sendJsonRpcResponse(mockProcess, 1, { capabilities: {} });
      await startPromise;

      // Make a request - attach catch immediately to prevent unhandled rejection
      const hoverPromise = client.hover('file:///test.move', 0, 0).catch(() => {});

      // Send malformed response
      sendMalformedResponse(mockProcess);
      await hoverPromise;

      // Should have called kill with SIGTERM
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    test('should mark client as unhealthy on protocol error', async () => {
      const config = createTestConfig();
      client = new MoveLspClient('/usr/bin/move-analyzer', config);

      // Start client
      const startPromise = client.start('/workspace');
      await vi.advanceTimersByTimeAsync(10);
      sendJsonRpcResponse(mockProcess, 1, { capabilities: {} });
      await startPromise;

      expect(client.isReady()).toBe(true);

      // Make a request - attach catch immediately to prevent unhandled rejection
      const hoverPromise = client.hover('file:///test.move', 0, 0).catch(() => {});

      // Send malformed response
      sendMalformedResponse(mockProcess);
      await hoverPromise;

      // Client should no longer be ready and needs restart
      expect(client.isReady()).toBe(false);
      expect(client.needsRestart()).toBe(true);
    });
  });

  describe('PID Tracking', () => {
    test('should expose child process PID', async () => {
      const config = createTestConfig();
      client = new MoveLspClient('/usr/bin/move-analyzer', config);

      // Before start, PID should be null
      expect(client.getPid()).toBeNull();

      // Start client
      const startPromise = client.start('/workspace');
      await vi.advanceTimersByTimeAsync(10);
      sendJsonRpcResponse(mockProcess, 1, { capabilities: {} });
      await startPromise;

      // After start, PID should be available
      expect(client.getPid()).toBe(12345);
    });

    test('should return null PID after crash', async () => {
      const config = createTestConfig();
      client = new MoveLspClient('/usr/bin/move-analyzer', config);

      // Start client
      const startPromise = client.start('/workspace');
      await vi.advanceTimersByTimeAsync(10);
      sendJsonRpcResponse(mockProcess, 1, { capabilities: {} });
      await startPromise;

      expect(client.getPid()).toBe(12345);

      // Simulate crash
      mockProcess.emit('exit', 1, null);

      expect(client.getPid()).toBeNull();
    });
  });
});
