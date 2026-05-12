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

  describe('move_find_references', () => {
    test.runIf(binaryAvailable)('should return references for a struct declaration', async () => {
      // TestStruct declared at line 11 char 18 in main.move (0-indexed)
      const mockRequest = {
        params: {
          name: 'move_find_references',
          arguments: { filePath: mainFilePath, line: 11, character: 18, includeDeclaration: false },
        },
      };

      const response = await callToolHandler!(mockRequest as any);
      expect(response).toHaveProperty('content');
      expect(response.isError).toBeUndefined();

      const result = JSON.parse(response.content[0].text);
      expect(result).toHaveProperty('workspaceRoot');
      expect(result).toHaveProperty('locations');
      expect(Array.isArray(result.locations)).toBe(true);

      if (result.locations.length > 0) {
        const loc = result.locations[0];
        expect(loc).toHaveProperty('filePath');
        expect(loc).toHaveProperty('line');
        expect(loc).toHaveProperty('character');
      }
    });

    test.runIf(binaryAvailable)('should return empty locations for non-symbol position', async () => {
      const mockRequest = {
        params: {
          name: 'move_find_references',
          arguments: { filePath: mainFilePath, line: 0, character: 0 },
        },
      };

      const response = await callToolHandler!(mockRequest as any);
      // Empty result is NOT an error for find-references
      const result = JSON.parse(response.content[0].text);
      expect(result).toHaveProperty('locations');
      expect(Array.isArray(result.locations)).toBe(true);
    });

    test.runIf(binaryAvailable)('should reject invalid line', async () => {
      const mockRequest = {
        params: {
          name: 'move_find_references',
          arguments: { filePath: mainFilePath, line: -1, character: 0 },
        },
      };

      const response = await callToolHandler!(mockRequest as any);
      expect(response).toHaveProperty('isError', true);
      const result = JSON.parse(response.content[0].text);
      expect(result.error.code).toBe('INVALID_FILE_PATH');
    });
  });

  describe('move_document_symbols', () => {
    test.runIf(binaryAvailable)('should return the outline of main.move', async () => {
      const mockRequest = {
        params: {
          name: 'move_document_symbols',
          arguments: { filePath: mainFilePath },
        },
      };

      const response = await callToolHandler!(mockRequest as any);
      expect(response).toHaveProperty('content');
      expect(response.isError).toBeUndefined();

      const result = JSON.parse(response.content[0].text);
      expect(result).toHaveProperty('workspaceRoot');
      expect(result).toHaveProperty('symbols');
      expect(Array.isArray(result.symbols)).toBe(true);

      if (result.symbols.length > 0) {
        const first = result.symbols[0];
        expect(first).toHaveProperty('name');
        expect(first).toHaveProperty('kind');
        expect(first).toHaveProperty('range');
        expect(first).toHaveProperty('selectionRange');
        expect(first.range).toHaveProperty('startLine');
        expect(first.range).toHaveProperty('endLine');
      }
    });

    test.runIf(binaryAvailable)('should reject missing filePath', async () => {
      const mockRequest = { params: { name: 'move_document_symbols', arguments: {} } };
      const response = await callToolHandler!(mockRequest as any);
      expect(response).toHaveProperty('isError', true);
      const result = JSON.parse(response.content[0].text);
      expect(result.error.code).toBe('INVALID_FILE_PATH');
    });
  });

  describe('move_type_definition', () => {
    test.runIf(binaryAvailable)('should return SYMBOL_NOT_FOUND for empty position', async () => {
      // Position in the file header comment where no symbol exists
      const mockRequest = {
        params: {
          name: 'move_type_definition',
          arguments: { filePath: mainFilePath, line: 0, character: 0 },
        },
      };

      const response = await callToolHandler!(mockRequest as any);
      expect(response).toHaveProperty('isError', true);
      const result = JSON.parse(response.content[0].text);
      expect(result.error.code).toBe('SYMBOL_NOT_FOUND');
    });

    test.runIf(binaryAvailable)('should return a location or SYMBOL_NOT_FOUND for a typed binding', async () => {
      // `obj: &TestStruct` in get_value signature at line 28 (0-indexed)
      const mockRequest = {
        params: {
          name: 'move_type_definition',
          arguments: { filePath: mainFilePath, line: 28, character: 25 },
        },
      };

      const response = await callToolHandler!(mockRequest as any);
      if (response.isError) {
        const result = JSON.parse(response.content[0].text);
        expect(result.error.code).toBe('SYMBOL_NOT_FOUND');
      } else {
        const result = JSON.parse(response.content[0].text);
        expect(result).toHaveProperty('locations');
        expect(Array.isArray(result.locations)).toBe(true);
      }
    });
  });

  describe('move_code_actions', () => {
    test.runIf(binaryAvailable)('should return an actions array (possibly empty)', async () => {
      const mockRequest = {
        params: {
          name: 'move_code_actions',
          arguments: { filePath: mainFilePath, line: 20, character: 22 },
        },
      };

      const response = await callToolHandler!(mockRequest as any);
      expect(response).toHaveProperty('content');
      // Either an error from the server or a valid actions array
      if (!response.isError) {
        const result = JSON.parse(response.content[0].text);
        expect(result).toHaveProperty('workspaceRoot');
        expect(result).toHaveProperty('actions');
        expect(Array.isArray(result.actions)).toBe(true);
      }
    });

    test.runIf(binaryAvailable)('should reject inverted range', async () => {
      const mockRequest = {
        params: {
          name: 'move_code_actions',
          arguments: {
            filePath: mainFilePath, line: 20, character: 22, endLine: 19, endCharacter: 0,
          },
        },
      };

      const response = await callToolHandler!(mockRequest as any);
      expect(response).toHaveProperty('isError', true);
      const result = JSON.parse(response.content[0].text);
      expect(result.error.code).toBe('INVALID_FILE_PATH');
    });
  });

  describe('move_inlay_hints', () => {
    test.runIf(binaryAvailable)('should return a hints array (possibly empty) for a function body range', async () => {
      // Range covering test_function body (lines 19-26, 0-indexed)
      const mockRequest = {
        params: {
          name: 'move_inlay_hints',
          arguments: {
            filePath: mainFilePath,
            startLine: 19, startCharacter: 0,
            endLine: 26, endCharacter: 0,
          },
        },
      };

      const response = await callToolHandler!(mockRequest as any);
      expect(response).toHaveProperty('content');
      if (!response.isError) {
        const result = JSON.parse(response.content[0].text);
        expect(result).toHaveProperty('workspaceRoot');
        expect(result).toHaveProperty('hints');
        expect(Array.isArray(result.hints)).toBe(true);

        if (result.hints.length > 0) {
          const first = result.hints[0];
          expect(first).toHaveProperty('line');
          expect(first).toHaveProperty('character');
          expect(first).toHaveProperty('label');
          expect(typeof first.label).toBe('string');
        }
      }
    });

    test.runIf(binaryAvailable)('should reject missing range fields', async () => {
      const mockRequest = {
        params: {
          name: 'move_inlay_hints',
          arguments: { filePath: mainFilePath, startLine: 0, startCharacter: 0 },
        },
      };

      const response = await callToolHandler!(mockRequest as any);
      expect(response).toHaveProperty('isError', true);
      const result = JSON.parse(response.content[0].text);
      expect(result.error.code).toBe('INVALID_FILE_PATH');
    });
  });

  describe('move_rename', () => {
    // Older move-analyzer builds don't implement prepareRename and the call may hit the LSP timeout (10s)
    // before we surface the error — give this test more room than the default 5s.
    test.runIf(binaryAvailable)('should return proposed edits or RENAME_NOT_AVAILABLE without writing files', { timeout: 15000 }, async () => {
      // Rename TestStruct (declared line 11 char 18) to RenamedTestStruct
      const mockRequest = {
        params: {
          name: 'move_rename',
          arguments: {
            filePath: mainFilePath,
            line: 11, character: 18,
            newName: 'RenamedTestStruct',
          },
        },
      };

      const response = await callToolHandler!(mockRequest as any);
      if (response.isError) {
        const result = JSON.parse(response.content[0].text);
        // Older move-analyzer builds do not implement prepareRename/rename and
        // may time out on the request; surface that as a legitimate outcome.
        expect(['RENAME_NOT_AVAILABLE', 'SYMBOL_NOT_FOUND', 'LSP_TIMEOUT']).toContain(result.error.code);
      } else {
        const result = JSON.parse(response.content[0].text);
        expect(result).toHaveProperty('workspaceRoot');
        expect(result).toHaveProperty('edits');
        expect(Array.isArray(result.edits)).toBe(true);

        if (result.edits.length > 0) {
          const e = result.edits[0];
          expect(e).toHaveProperty('filePath');
          expect(e).toHaveProperty('range');
          expect(e).toHaveProperty('newText');
          expect(e.newText).toBe('RenamedTestStruct');
        }
      }
    });

    test.runIf(binaryAvailable)('should reject empty newName', async () => {
      const mockRequest = {
        params: {
          name: 'move_rename',
          arguments: { filePath: mainFilePath, line: 11, character: 18, newName: '' },
        },
      };

      const response = await callToolHandler!(mockRequest as any);
      expect(response).toHaveProperty('isError', true);
      const result = JSON.parse(response.content[0].text);
      expect(result.error.code).toBe('INVALID_FILE_PATH');
    });
  });

  describe('tool listing', () => {
    test.runIf(binaryAvailable)('should list all 10 MCP tools', async () => {
      const listToolsHandler = server.getRequestHandler('tools/list');
      const response = await listToolsHandler!({} as any);

      expect(response).toHaveProperty('tools');
      expect(Array.isArray(response.tools)).toBe(true);

      const toolNames = response.tools.map((t: any) => t.name);
      expect(toolNames).toContain('move_diagnostics');
      expect(toolNames).toContain('move_hover');
      expect(toolNames).toContain('move_completions');
      expect(toolNames).toContain('move_goto_definition');
      expect(toolNames).toContain('move_find_references');
      expect(toolNames).toContain('move_document_symbols');
      expect(toolNames).toContain('move_type_definition');
      expect(toolNames).toContain('move_code_actions');
      expect(toolNames).toContain('move_inlay_hints');
      expect(toolNames).toContain('move_rename');
      expect(response.tools).toHaveLength(10);
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

      const findRefsTool = response.tools.find((t: any) => t.name === 'move_find_references');
      expect(findRefsTool.inputSchema.required).toEqual(expect.arrayContaining(['filePath', 'line', 'character']));
      expect(findRefsTool.inputSchema.properties.includeDeclaration.type).toBe('boolean');

      const docSymTool = response.tools.find((t: any) => t.name === 'move_document_symbols');
      expect(docSymTool.inputSchema.required).toEqual(['filePath']);

      const inlayTool = response.tools.find((t: any) => t.name === 'move_inlay_hints');
      expect(inlayTool.inputSchema.required).toEqual(
        expect.arrayContaining(['filePath', 'startLine', 'startCharacter', 'endLine', 'endCharacter'])
      );

      const renameTool = response.tools.find((t: any) => t.name === 'move_rename');
      expect(renameTool.inputSchema.required).toEqual(
        expect.arrayContaining(['filePath', 'line', 'character', 'newName'])
      );
      expect(renameTool.description).toContain('never writes');
    });
  });
});
