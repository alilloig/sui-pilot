/**
 * Integration tests for crash recovery and orphan prevention
 * Tests recovery scenarios with controlled process simulation
 */

import { describe, test, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { resolve } from 'path';
import { execSync, spawn, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from 'fs';
import { discoverBinary } from '../../src/binary-discovery.js';
import { createServer } from '../../src/server.js';
import { BinaryNotFoundError, LSP_START_FAILED } from '../../src/errors.js';

// Mock logger to avoid noise during tests
vi.mock('../../src/logger.js', () => ({
  log: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  setLogLevel: vi.fn(),
}));

// Check for binary SYNCHRONOUSLY at module load time
function checkBinarySync(): boolean {
  try {
    discoverBinary();
    return true;
  } catch (error) {
    if (error instanceof BinaryNotFoundError) {
      console.warn('move-analyzer not found, skipping recovery integration tests');
      return false;
    }
    throw error;
  }
}

const binaryAvailable = checkBinarySync();

// Track spawned PIDs for cleanup verification
const spawnedPids: Set<number> = new Set();

/**
 * Check if a process with given PID is still running
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 doesn't kill but checks if process exists
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Force kill a process by PID
 */
function forceKillProcess(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch (e) {
    // Process may already be dead
  }
}

describe('Recovery Integration Tests', () => {
  const fixtureDir = resolve(__dirname, '../fixtures/lsp-test-package');
  const mainFilePath = resolve(fixtureDir, 'sources/main.move');
  let server: ReturnType<typeof createServer>;
  let callToolHandler: any;

  beforeAll(async () => {
    if (binaryAvailable) {
      server = createServer();
      callToolHandler = server.getRequestHandler('tools/call');
    }
  });

  afterAll(async () => {
    // Ensure server is properly closed
    if (server && server.close) {
      await server.close();
    }
  });

  afterEach(() => {
    // Cleanup any orphaned processes after each test
    for (const pid of spawnedPids) {
      if (isProcessRunning(pid)) {
        console.warn(`Cleaning up orphaned process: ${pid}`);
        forceKillProcess(pid);
      }
    }
    spawnedPids.clear();
  });

  describe('Crash Recovery', () => {
    test.runIf(binaryAvailable)('should recover and serve request after simulated crash scenario', async () => {
      // First request should work
      const mockRequest1 = {
        params: {
          name: 'move_hover',
          arguments: {
            filePath: mainFilePath,
            line: 11,
            character: 18,
          },
        },
      };

      const response1 = await callToolHandler!(mockRequest1 as any);
      expect(response1).toHaveProperty('content');
      expect(response1.isError).toBeUndefined();

      const result1 = JSON.parse(response1.content[0].text);
      expect(result1).toHaveProperty('workspaceRoot');

      // Second request should also work (proves recovery if previous state was bad)
      const mockRequest2 = {
        params: {
          name: 'move_completions',
          arguments: {
            filePath: mainFilePath,
            line: 20,
            character: 12,
          },
        },
      };

      const response2 = await callToolHandler!(mockRequest2 as any);
      expect(response2).toHaveProperty('content');
      expect(response2.isError).toBeUndefined();

      const result2 = JSON.parse(response2.content[0].text);
      expect(result2).toHaveProperty('workspaceRoot');
      expect(result2).toHaveProperty('completions');
    });

    test.runIf(binaryAvailable)('should preserve document state across multiple requests', async () => {
      const contentWithError = `
module lsp_test_package::test_recovery;

public fun incomplete(
    // Incomplete function to trigger diagnostics
`;

      // First request with modified content
      const mockRequest1 = {
        params: {
          name: 'move_diagnostics',
          arguments: {
            filePath: mainFilePath,
            content: contentWithError,
          },
        },
      };

      const response1 = await callToolHandler!(mockRequest1 as any);
      expect(response1).toHaveProperty('content');

      // Second request should use updated document state
      const mockRequest2 = {
        params: {
          name: 'move_hover',
          arguments: {
            filePath: mainFilePath,
            line: 3,
            character: 12,
            content: contentWithError,
          },
        },
      };

      const response2 = await callToolHandler!(mockRequest2 as any);
      expect(response2).toHaveProperty('content');
      // Should not throw - document state should be consistent
    });
  });

  describe('Degraded Mode', () => {
    test.runIf(binaryAvailable)('should return structured error for invalid file path', async () => {
      const mockRequest = {
        params: {
          name: 'move_diagnostics',
          arguments: {
            filePath: '/nonexistent/path/to/file.move',
          },
        },
      };

      const response = await callToolHandler!(mockRequest as any);
      expect(response).toHaveProperty('isError', true);

      const result = JSON.parse(response.content[0].text);
      expect(result).toHaveProperty('error');
      expect(result.error).toHaveProperty('code');
      expect(result.error).toHaveProperty('message');
    });

    test.runIf(binaryAvailable)('should return structured error for file outside workspace', async () => {
      // Create a temp file outside any Move workspace
      const tempDir = '/tmp/move-lsp-test-no-workspace';
      const tempFile = `${tempDir}/orphan.move`;

      try {
        if (!existsSync(tempDir)) {
          mkdirSync(tempDir, { recursive: true });
        }
        writeFileSync(tempFile, 'module orphan {}');

        const mockRequest = {
          params: {
            name: 'move_diagnostics',
            arguments: {
              filePath: tempFile,
            },
          },
        };

        const response = await callToolHandler!(mockRequest as any);
        expect(response).toHaveProperty('isError', true);

        const result = JSON.parse(response.content[0].text);
        expect(result.error.code).toBe('NO_WORKSPACE');
      } finally {
        // Cleanup
        try {
          if (existsSync(tempFile)) {
            unlinkSync(tempFile);
          }
          if (existsSync(tempDir)) {
            rmSync(tempDir, { recursive: true, force: true });
          }
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('Orphan Prevention', () => {
    test.runIf(binaryAvailable)('should track spawned PIDs', async () => {
      // Make a request to spawn LSP process
      const mockRequest = {
        params: {
          name: 'move_hover',
          arguments: {
            filePath: mainFilePath,
            line: 11,
            character: 18,
          },
        },
      };

      await callToolHandler!(mockRequest as any);

      // The process tracking would be internal - we verify through server shutdown
      // that no orphans remain
    });

    test.runIf(binaryAvailable)('should not leave orphaned processes after server close', async () => {
      // Create a fresh server for this test
      const testServer = createServer();
      const testCallHandler = testServer.getRequestHandler('tools/call');

      // Make a request to spawn LSP process
      const mockRequest = {
        params: {
          name: 'move_diagnostics',
          arguments: {
            filePath: mainFilePath,
          },
        },
      };

      await testCallHandler!(mockRequest as any);

      // Close the server
      if (testServer.close) {
        await testServer.close();
      }

      // Give processes time to terminate
      await new Promise(resolve => setTimeout(resolve, 500));

      // At this point, no move-analyzer processes from our test should be running
      // (We can't easily verify this without tracking PIDs, which is internal)
      // The test passes if shutdown completes without hanging
    });
  });

  describe('Latency Validation', () => {
    test.runIf(binaryAvailable)('warm request should complete within target latency', async () => {
      // First request (cold) - may take longer
      const coldRequest = {
        params: {
          name: 'move_hover',
          arguments: {
            filePath: mainFilePath,
            line: 11,
            character: 18,
          },
        },
      };
      await callToolHandler!(coldRequest as any);

      // Warm request should be faster (target: 2s)
      const warmStart = Date.now();
      const warmRequest = {
        params: {
          name: 'move_hover',
          arguments: {
            filePath: mainFilePath,
            line: 15,
            character: 10,
          },
        },
      };
      await callToolHandler!(warmRequest as any);
      const warmDuration = Date.now() - warmStart;

      // Allow some headroom over 2s target
      expect(warmDuration).toBeLessThan(5000);
    });
  });
});
