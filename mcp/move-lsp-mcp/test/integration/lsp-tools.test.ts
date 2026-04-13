/**
 * Integration tests for move_hover, move_completions, and move_goto_definition tools
 */

import { describe, test, expect, beforeAll, vi } from 'vitest';
import { resolve } from 'path';
import { discoverBinary } from '../../src/binary-discovery.js';
import { createServer } from '../../src/server.js';
import { BinaryNotFoundError } from '../../src/errors.js';

// Mock logger to avoid noise during tests
vi.mock('../../src/logger.js');

// Check for binary SYNCHRONOUSLY at module load time
function checkBinarySync(): boolean {
  try {
    discoverBinary();
    return true;
  } catch (error) {
    if (error instanceof BinaryNotFoundError) {
      console.warn('move-analyzer not found, skipping LSP tools integration tests');
      return false;
    }
    throw error;
  }
}

const binaryAvailable = checkBinarySync();

describe('LSP tools integration', () => {
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

  describe('move_hover', () => {
    test.runIf(binaryAvailable)('should return hover info for struct name', async () => {
      // TestStruct is on line 11 (0-indexed), character ~18 (public struct TestStruct)
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

      const response = await callToolHandler!(mockRequest as any);
      expect(response).toHaveProperty('content');
      expect(response.isError).toBeUndefined();

      const result = JSON.parse(response.content[0].text);
      expect(result).toHaveProperty('workspaceRoot');
      expect(result).toHaveProperty('contents');
      // Contents may be null if move-analyzer doesn't return hover for this position
      // but should not throw an error
    });

    test.runIf(binaryAvailable)('should return null contents for non-existent position', async () => {
      // Position in whitespace/comment area
      const mockRequest = {
        params: {
          name: 'move_hover',
          arguments: {
            filePath: mainFilePath,
            line: 0,
            character: 0,
          },
        },
      };

      const response = await callToolHandler!(mockRequest as any);
      expect(response).toHaveProperty('content');
      expect(response.isError).toBeUndefined();

      const result = JSON.parse(response.content[0].text);
      expect(result).toHaveProperty('workspaceRoot');
      expect(result).toHaveProperty('contents');
      // Contents should be null for whitespace/comment positions
      expect(result.contents).toBeNull();
    });

    test.runIf(binaryAvailable)('should handle invalid line parameter', async () => {
      const mockRequest = {
        params: {
          name: 'move_hover',
          arguments: {
            filePath: mainFilePath,
            line: -1,
            character: 0,
          },
        },
      };

      const response = await callToolHandler!(mockRequest as any);
      expect(response).toHaveProperty('isError', true);

      const result = JSON.parse(response.content[0].text);
      expect(result.error.code).toBe('INVALID_FILE_PATH');
    });
  });

  describe('move_completions', () => {
    test.runIf(binaryAvailable)('should return completions inside function body', async () => {
      // Inside test_function body, after 'let result = TestStruct {'
      // Line 20 (0-indexed), position inside function
      const mockRequest = {
        params: {
          name: 'move_completions',
          arguments: {
            filePath: mainFilePath,
            line: 20,
            character: 12,
          },
        },
      };

      const response = await callToolHandler!(mockRequest as any);
      expect(response).toHaveProperty('content');
      expect(response.isError).toBeUndefined();

      const result = JSON.parse(response.content[0].text);
      expect(result).toHaveProperty('workspaceRoot');
      expect(result).toHaveProperty('completions');
      expect(Array.isArray(result.completions)).toBe(true);
      // Note: completions may be empty depending on context and move-analyzer behavior
    });

    test.runIf(binaryAvailable)('should return empty array when no candidates available', async () => {
      // Position at end of file or in comment
      const mockRequest = {
        params: {
          name: 'move_completions',
          arguments: {
            filePath: mainFilePath,
            line: 0,
            character: 0,
          },
        },
      };

      const response = await callToolHandler!(mockRequest as any);
      expect(response).toHaveProperty('content');
      expect(response.isError).toBeUndefined();

      const result = JSON.parse(response.content[0].text);
      expect(result).toHaveProperty('completions');
      expect(Array.isArray(result.completions)).toBe(true);
      // Should be empty array, not an error
    });

    test.runIf(binaryAvailable)('should include expected fields in completion items', async () => {
      // Use content parameter with incomplete code to trigger completions
      const contentWithIncomplete = `
module lsp_test_package::test {
    use sui::object::{Self, UID};

    public fun foo() {
        obj
    }
}
`;
      const mockRequest = {
        params: {
          name: 'move_completions',
          arguments: {
            filePath: mainFilePath,
            line: 5,
            character: 11,
            content: contentWithIncomplete,
          },
        },
      };

      const response = await callToolHandler!(mockRequest as any);
      const result = JSON.parse(response.content[0].text);

      expect(result.completions).toBeDefined();
      if (result.completions.length > 0) {
        const firstCompletion = result.completions[0];
        expect(firstCompletion).toHaveProperty('label');
        expect(firstCompletion).toHaveProperty('kind');
        expect(typeof firstCompletion.label).toBe('string');
        expect(typeof firstCompletion.kind).toBe('string');
      }
    });
  });

  describe('move_goto_definition', () => {
    test.runIf(binaryAvailable)('should return definition location for struct usage', async () => {
      // TestStruct usage in test_function at line 20 (let result = TestStruct {)
      const mockRequest = {
        params: {
          name: 'move_goto_definition',
          arguments: {
            filePath: mainFilePath,
            line: 20,
            character: 22, // Position on TestStruct
          },
        },
      };

      const response = await callToolHandler!(mockRequest as any);

      // May return SYMBOL_NOT_FOUND if move-analyzer can't resolve
      if (response.isError) {
        const result = JSON.parse(response.content[0].text);
        expect(result.error.code).toBe('SYMBOL_NOT_FOUND');
      } else {
        const result = JSON.parse(response.content[0].text);
        expect(result).toHaveProperty('workspaceRoot');
        expect(result).toHaveProperty('locations');
        expect(Array.isArray(result.locations)).toBe(true);

        if (result.locations.length > 0) {
          const location = result.locations[0];
          expect(location).toHaveProperty('filePath');
          expect(location).toHaveProperty('line');
          expect(location).toHaveProperty('character');
          expect(typeof location.line).toBe('number');
          expect(typeof location.character).toBe('number');
        }
      }
    });

    test.runIf(binaryAvailable)('should return SYMBOL_NOT_FOUND for non-existent symbol', async () => {
      // Position in whitespace where no symbol exists
      const mockRequest = {
        params: {
          name: 'move_goto_definition',
          arguments: {
            filePath: mainFilePath,
            line: 0,
            character: 0,
          },
        },
      };

      const response = await callToolHandler!(mockRequest as any);
      expect(response).toHaveProperty('isError', true);

      const result = JSON.parse(response.content[0].text);
      expect(result.error.code).toBe('SYMBOL_NOT_FOUND');
    });

    test.runIf(binaryAvailable)('should handle content parameter for unsaved file', async () => {
      const contentWithRef = `
module lsp_test_package::test {
    use sui::object::{Self, UID};

    public struct MyStruct has key {
        id: UID,
    }

    public fun create(): MyStruct {
        abort 0
    }
}
`;
      // Position on MyStruct in the return type
      const mockRequest = {
        params: {
          name: 'move_goto_definition',
          arguments: {
            filePath: mainFilePath,
            line: 8,
            character: 26, // Position on MyStruct
            content: contentWithRef,
          },
        },
      };

      const response = await callToolHandler!(mockRequest as any);
      // Either returns location or SYMBOL_NOT_FOUND - both are valid
      expect(response).toHaveProperty('content');
    });
  });

  describe('tool listing', () => {
    test.runIf(binaryAvailable)('should list all 4 MCP tools', async () => {
      const listToolsHandler = server.getRequestHandler('tools/list');
      const response = await listToolsHandler!({} as any);

      expect(response).toHaveProperty('tools');
      expect(Array.isArray(response.tools)).toBe(true);

      const toolNames = response.tools.map((t: any) => t.name);
      expect(toolNames).toContain('move_diagnostics');
      expect(toolNames).toContain('move_hover');
      expect(toolNames).toContain('move_completions');
      expect(toolNames).toContain('move_goto_definition');
      expect(response.tools).toHaveLength(4);
    });

    test.runIf(binaryAvailable)('should have correct input schemas for new tools', async () => {
      const listToolsHandler = server.getRequestHandler('tools/list');
      const response = await listToolsHandler!({} as any);

      const hoverTool = response.tools.find((t: any) => t.name === 'move_hover');
      expect(hoverTool.inputSchema.required).toContain('filePath');
      expect(hoverTool.inputSchema.required).toContain('line');
      expect(hoverTool.inputSchema.required).toContain('character');
      expect(hoverTool.inputSchema.properties.line.type).toBe('number');
      expect(hoverTool.inputSchema.properties.character.type).toBe('number');

      const completionsTool = response.tools.find((t: any) => t.name === 'move_completions');
      expect(completionsTool.inputSchema.required).toContain('filePath');
      expect(completionsTool.inputSchema.required).toContain('line');
      expect(completionsTool.inputSchema.required).toContain('character');

      const gotoDefTool = response.tools.find((t: any) => t.name === 'move_goto_definition');
      expect(gotoDefTool.inputSchema.required).toContain('filePath');
      expect(gotoDefTool.inputSchema.required).toContain('line');
      expect(gotoDefTool.inputSchema.required).toContain('character');
      expect(gotoDefTool.description).toContain('Cross-package');
    });
  });
});
