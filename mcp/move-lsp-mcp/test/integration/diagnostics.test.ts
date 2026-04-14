/**
 * Integration tests for move_diagnostics tool
 */

import { describe, test, expect, beforeAll, vi } from 'vitest';
import { resolve } from 'path';
import { discoverBinary } from '../../src/binary-discovery.js';
import { createServer } from '../../src/server.js';
import { BinaryNotFoundError } from '../../src/errors.js';

// Mock logger to avoid noise during tests
vi.mock('../../src/logger.js');

// Check for binary SYNCHRONOUSLY at module load time
// This is required because test.runIf() evaluates its condition at definition time
function checkBinarySync(): boolean {
  try {
    discoverBinary();
    return true;
  } catch (error) {
    if (error instanceof BinaryNotFoundError) {
      console.warn('move-analyzer not found, skipping integration tests');
      return false;
    }
    throw error;
  }
}

const binaryAvailable = checkBinarySync();

describe('diagnostics integration', () => {
  const testFixturePath = resolve(__dirname, '../fixtures/simple-package/sources/example.move');
  let server: ReturnType<typeof createServer>;

  beforeAll(async () => {
    if (binaryAvailable) {
      server = createServer();
    }
  });

  test.runIf(binaryAvailable)('should handle move_diagnostics tool call', async () => {
    // Mock the MCP request handler
    const mockRequest = {
      params: {
        name: 'move_diagnostics',
        arguments: {
          filePath: testFixturePath,
        },
      },
    };

    // Get the tool handler
    const listToolsHandler = server.getRequestHandler('tools/list');
    const callToolHandler = server.getRequestHandler('tools/call');

    expect(listToolsHandler).toBeDefined();
    expect(callToolHandler).toBeDefined();

    // Test listing tools
    const toolsResponse = await listToolsHandler!({} as any);
    expect(toolsResponse).toHaveProperty('tools');
    expect(Array.isArray(toolsResponse.tools)).toBe(true);

    const diagnosticsTool = toolsResponse.tools.find((tool: any) => tool.name === 'move_diagnostics');
    expect(diagnosticsTool).toBeDefined();
    expect(diagnosticsTool).toMatchObject({
      name: 'move_diagnostics',
      description: expect.stringContaining('Move language diagnostics'),
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: expect.stringContaining('Path to the Move source file'),
          },
          content: {
            type: 'string',
            description: expect.stringContaining('Optional file content'),
          },
          scope: {
            type: 'string',
            enum: ['file', 'package', 'workspace'],
            description: expect.stringContaining('Analysis scope'),
          },
        },
        required: ['filePath'],
      },
    });

    // Test calling the tool
    const diagnosticsResponse = await callToolHandler!(mockRequest as any);
    expect(diagnosticsResponse).toHaveProperty('content');
    expect(Array.isArray(diagnosticsResponse.content)).toBe(true);
    expect(diagnosticsResponse.content.length).toBeGreaterThan(0);

    const responseContent = diagnosticsResponse.content[0];
    expect(responseContent).toHaveProperty('type', 'text');
    expect(responseContent).toHaveProperty('text');

    // Parse the response
    const result = JSON.parse(responseContent.text);
    expect(result).toHaveProperty('workspaceRoot');
    expect(result).toHaveProperty('diagnostics');
    expect(typeof result.workspaceRoot).toBe('string');
    expect(Array.isArray(result.diagnostics)).toBe(true);

    // Verify workspace root points to the test fixture directory
    expect(result.workspaceRoot).toContain('simple-package');
  });

  test.runIf(binaryAvailable)('should handle invalid file path', async () => {
    const mockRequest = {
      params: {
        name: 'move_diagnostics',
        arguments: {
          filePath: '/nonexistent/file.move',
        },
      },
    };

    const callToolHandler = server.getRequestHandler('tools/call');
    const response = await callToolHandler!(mockRequest as any);

    expect(response).toHaveProperty('content');
    expect(response).toHaveProperty('isError', true);

    const responseContent = response.content[0];
    const result = JSON.parse(responseContent.text);
    expect(result).toHaveProperty('error');
    expect(result.error).toHaveProperty('code', 'FILE_NOT_FOUND');
  });

  test.runIf(binaryAvailable)('should handle missing filePath argument', async () => {
    const mockRequest = {
      params: {
        name: 'move_diagnostics',
        arguments: {},
      },
    };

    const callToolHandler = server.getRequestHandler('tools/call');
    const response = await callToolHandler!(mockRequest as any);

    expect(response).toHaveProperty('content');
    expect(response).toHaveProperty('isError', true);

    const responseContent = response.content[0];
    const result = JSON.parse(responseContent.text);
    expect(result).toHaveProperty('error');
    expect(result.error).toHaveProperty('code', 'INVALID_FILE_PATH');
  });

  test.runIf(binaryAvailable)('should handle file outside workspace', async () => {
    // Use a path outside any Move workspace with content to bypass file existence check
    const tempFilePath = resolve('/tmp/not-in-workspace.move');

    const mockRequest = {
      params: {
        name: 'move_diagnostics',
        arguments: {
          filePath: tempFilePath,
          content: 'module test::example {}', // Provide content to bypass file existence check
        },
      },
    };

    const callToolHandler = server.getRequestHandler('tools/call');
    const response = await callToolHandler!(mockRequest as any);

    expect(response).toHaveProperty('content');
    expect(response).toHaveProperty('isError', true);

    const responseContent = response.content[0];
    const result = JSON.parse(responseContent.text);
    expect(result).toHaveProperty('error');
    expect(result.error).toHaveProperty('code', 'NO_WORKSPACE');
  });

  test.skip('should skip integration tests when move-analyzer not available', () => {
    // This test documents the skip behavior
    if (!binaryAvailable) {
      expect(true).toBe(true); // Placeholder assertion
    }
  });
});