/**
 * E2E Plugin Workflow Tests
 *
 * Tests the complete plugin workflow:
 * document open -> diagnostics -> hover -> completions -> goto definition
 *
 * These tests require move-analyzer to be installed. They are skipped gracefully
 * if the binary is not available.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess, execFileSync } from 'child_process';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';

// Response type for MCP tool calls
interface ToolResponse {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

// Check if move-analyzer is available using execFileSync (safe, no shell)
function checkBinarySync(): boolean {
  try {
    execFileSync('which', ['move-analyzer'], { stdio: 'pipe' });
    return true;
  } catch {
    console.error('move-analyzer not found, skipping E2E plugin workflow tests');
    return false;
  }
}

const BINARY_AVAILABLE = checkBinarySync();

// Skip all tests if binary not available
const describeWithBinary = BINARY_AVAILABLE ? describe : describe.skip;

describeWithBinary('E2E: Plugin Workflow', () => {
  let serverProcess: ChildProcess | null = null;
  let testWorkspace: string;
  let messageId = 0;

  // MCP SDK uses newline-delimited JSON on stdio — one message per line.
  // (Earlier versions of this test used LSP-style Content-Length framing,
  // which silently broke against MCP SDK >= 1.x.)
  const sendNotification = (method: string, params: Record<string, unknown>): void => {
    if (!serverProcess?.stdin) throw new Error('Server not running');
    const message = JSON.stringify({ jsonrpc: '2.0', method, params });
    serverProcess.stdin.write(message + '\n');
  };

  const sendMessage = (method: string, params: Record<string, unknown>): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      if (!serverProcess || !serverProcess.stdin || !serverProcess.stdout) {
        reject(new Error('Server not running'));
        return;
      }

      const id = ++messageId;
      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params });

      let buffer = '';
      const onData = (data: Buffer) => {
        buffer += data.toString();
        let newlineIdx = buffer.indexOf('\n');
        while (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (line.length > 0) {
            try {
              const response = JSON.parse(line);
              if (response.id === id) {
                serverProcess?.stdout?.removeListener('data', onData);
                if (response.error) {
                  reject(new Error(response.error.message));
                } else {
                  resolve(response.result);
                }
                return;
              }
            } catch {
              // Not JSON or partial — keep reading
            }
          }
          newlineIdx = buffer.indexOf('\n');
        }
      };

      serverProcess.stdout.on('data', onData);

      // Slightly longer than the LSP client's request timeout (default 10s)
      // so that LSP-side timeouts surface as a structured LSP_TIMEOUT error
      // rather than racing the wire-level wait here.
      const timer = setTimeout(() => {
        serverProcess?.stdout?.removeListener('data', onData);
        reject(new Error(`Request timeout for ${method}`));
      }, 13000);

      // Clear timer if we resolve early — wrap the promise's settled callbacks
      const _resolve = resolve;
      const _reject = reject;
      resolve = (v) => { clearTimeout(timer); _resolve(v); };
      reject = (e) => { clearTimeout(timer); _reject(e); };

      serverProcess.stdin.write(message + '\n');
    });
  };

  // Helper to call a tool and validate basic response structure.
  // `allowedErrorCodes` lets a caller tolerate known semantic errors (e.g.
  // SYMBOL_NOT_FOUND for goto-definition at a position move-analyzer can't resolve).
  const callTool = async (
    name: string,
    args: Record<string, unknown>,
    allowedErrorCodes: string[] = []
  ): Promise<{ text: string; parsed: unknown; errorCode: string | null }> => {
    const result = (await sendMessage('tools/call', {
      name,
      arguments: args,
    })) as ToolResponse;

    // Validate content structure
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBeDefined();
    expect(typeof result.content[0].text).toBe('string');
    expect(result.content[0].text.length).toBeGreaterThan(0);

    const text = result.content[0].text;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    let errorCode: string | null = null;
    if (result.isError) {
      const errCode = (parsed as { error?: { code?: string } })?.error?.code;
      errorCode = errCode ?? 'UNKNOWN_ERROR';
      if (!allowedErrorCodes.includes(errorCode)) {
        throw new Error(`Tool ${name} returned isError=true with code=${errorCode}; not in allowed list`);
      }
    }

    return { text, parsed, errorCode };
  };

  beforeAll(async () => {
    // Create test workspace with Move.toml and a Move file
    testWorkspace = join(tmpdir(), `move-e2e-test-${Date.now()}`);
    mkdirSync(testWorkspace, { recursive: true });
    mkdirSync(join(testWorkspace, 'sources'), { recursive: true });

    // Create Move.toml
    writeFileSync(
      join(testWorkspace, 'Move.toml'),
      `[package]
name = "e2e_test"
edition = "2024"

[addresses]
e2e_test = "0x0"
`
    );

    // Create a simple Move module with intentional patterns for testing
    writeFileSync(
      join(testWorkspace, 'sources', 'counter.move'),
      `module e2e_test::counter;

public struct Counter has key, store {
    id: sui::object::UID,
    value: u64,
}

public fun value(counter: &Counter): u64 {
    counter.value
}

public fun increment(counter: &mut Counter) {
    counter.value = counter.value + 1;
}
`
    );

    // Start the MCP server
    const serverPath = join(__dirname, '../../dist/index.js');
    if (!existsSync(serverPath)) {
      throw new Error(`Server not built: ${serverPath}`);
    }

    serverProcess = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MOVE_LSP_LOG_LEVEL: 'error', // Reduce noise
      },
    });

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Initialize MCP connection
    await sendMessage('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e-test', version: '1.0.0' },
    });
    // Modern MCP requires the client to send `notifications/initialized` after
    // the initialize response before the server will accept further requests.
    sendNotification('notifications/initialized', {});
  }, 30000);

  afterAll(async () => {
    // Clean up server
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (!serverProcess.killed) {
        serverProcess.kill('SIGKILL');
      }
    }

    // Clean up test workspace
    if (testWorkspace && existsSync(testWorkspace)) {
      rmSync(testWorkspace, { recursive: true, force: true });
    }
  });

  it('should list available tools', async () => {
    const result = (await sendMessage('tools/list', {})) as { tools: Array<{ name: string }> };
    expect(result.tools).toBeDefined();

    const toolNames = result.tools.map((t) => t.name);
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
    expect(result.tools).toHaveLength(10);
  });

  it('should open document and get diagnostics', async () => {
    const filePath = join(testWorkspace, 'sources', 'counter.move');

    // Use correct parameter name: filePath (camelCase)
    const { text, parsed } = await callTool('move_diagnostics', {
      filePath: filePath,
    });

    // Response should be valid and contain workspace info
    expect(text).toContain('workspaceRoot');

    // If parsed, check structure
    if (parsed && typeof parsed === 'object') {
      const response = parsed as { workspaceRoot?: string; diagnostics?: unknown[] };
      expect(response.workspaceRoot).toBeDefined();
      // Diagnostics array should exist (may be empty for valid code)
      expect(response.diagnostics).toBeDefined();
    }
  });

  it('should provide hover information', async () => {
    const filePath = join(testWorkspace, 'sources', 'counter.move');

    // Use correct parameter names: filePath, line, character (camelCase)
    const { text, parsed } = await callTool('move_hover', {
      filePath: filePath,
      line: 8, // line with 'counter.value' (0-indexed: line 7)
      character: 4, // 'counter' variable
    });

    // Response should contain hover info or indicate no hover
    expect(text.length).toBeGreaterThan(0);

    // If parsed, check structure
    if (parsed && typeof parsed === 'object') {
      const response = parsed as { hover?: { contents?: unknown } };
      // Hover response should have contents if found
      if (response.hover) {
        expect(response.hover.contents).toBeDefined();
      }
    }
  });

  it('should provide completions', async () => {
    const filePath = join(testWorkspace, 'sources', 'counter.move');

    // Use correct parameter names
    const { text, parsed } = await callTool('move_completions', {
      filePath: filePath,
      line: 8,
      character: 12, // after 'counter.'
    });

    // Response should exist
    expect(text.length).toBeGreaterThan(0);

    // If parsed, check structure
    if (parsed && typeof parsed === 'object') {
      const response = parsed as { completions?: unknown[] };
      // Completions should be an array
      if (response.completions) {
        expect(Array.isArray(response.completions)).toBe(true);
      }
    }
  });

  it('should provide goto definition', async () => {
    const filePath = join(testWorkspace, 'sources', 'counter.move');

    // move-analyzer may not resolve every position; SYMBOL_NOT_FOUND is acceptable.
    const { text, errorCode } = await callTool(
      'move_goto_definition',
      { filePath, line: 8, character: 4 },
      ['SYMBOL_NOT_FOUND']
    );

    expect(text.length).toBeGreaterThan(0);
    if (errorCode === null) {
      // If a definition was resolved, it should expose the documented shape.
      const parsed = JSON.parse(text) as { workspaceRoot: string; locations: unknown[] };
      expect(parsed.workspaceRoot).toBeDefined();
      expect(Array.isArray(parsed.locations)).toBe(true);
    }
  });

  it('should return the document outline via move_document_symbols', async () => {
    const filePath = join(testWorkspace, 'sources', 'counter.move');

    const { text } = await callTool('move_document_symbols', { filePath });
    const parsed = JSON.parse(text) as { workspaceRoot: string; symbols: Array<{ name: string }> };
    expect(parsed.workspaceRoot).toBeDefined();
    expect(Array.isArray(parsed.symbols)).toBe(true);
  });

  it('should return references via move_find_references', async () => {
    const filePath = join(testWorkspace, 'sources', 'counter.move');

    // Counter struct at line 2, char 14 (0-indexed)
    const { text } = await callTool('move_find_references', {
      filePath, line: 2, character: 14,
    });
    const parsed = JSON.parse(text) as { workspaceRoot: string; locations: unknown[] };
    expect(parsed.workspaceRoot).toBeDefined();
    expect(Array.isArray(parsed.locations)).toBe(true);
  });

  it('should accept move_type_definition (location or SYMBOL_NOT_FOUND)', async () => {
    const filePath = join(testWorkspace, 'sources', 'counter.move');

    const { errorCode } = await callTool(
      'move_type_definition',
      { filePath, line: 8, character: 4 },
      ['SYMBOL_NOT_FOUND']
    );
    expect(errorCode === null || errorCode === 'SYMBOL_NOT_FOUND').toBe(true);
  });

  it('should accept move_code_actions on a position', async () => {
    const filePath = join(testWorkspace, 'sources', 'counter.move');

    const { text } = await callTool('move_code_actions', {
      filePath, line: 8, character: 4,
    });
    const parsed = JSON.parse(text) as { workspaceRoot: string; actions: unknown[] };
    expect(parsed.workspaceRoot).toBeDefined();
    expect(Array.isArray(parsed.actions)).toBe(true);
  });

  it('should accept move_inlay_hints on a range', async () => {
    const filePath = join(testWorkspace, 'sources', 'counter.move');

    const { text } = await callTool('move_inlay_hints', {
      filePath,
      startLine: 7, startCharacter: 0,
      endLine: 9, endCharacter: 0,
    });
    const parsed = JSON.parse(text) as { workspaceRoot: string; hints: unknown[] };
    expect(parsed.workspaceRoot).toBeDefined();
    expect(Array.isArray(parsed.hints)).toBe(true);
  });

  it('should handle move_rename (edits, RENAME_NOT_AVAILABLE, or LSP_TIMEOUT)', { timeout: 15000 }, async () => {
    const filePath = join(testWorkspace, 'sources', 'counter.move');

    // Older move-analyzer builds may not implement rename and the request
    // can time out at the LSP layer (~10s) — tolerate that outcome.
    const { text, errorCode } = await callTool(
      'move_rename',
      { filePath, line: 2, character: 14, newName: 'Tally' },
      ['RENAME_NOT_AVAILABLE', 'SYMBOL_NOT_FOUND', 'LSP_TIMEOUT']
    );
    if (errorCode === null) {
      const parsed = JSON.parse(text) as { edits: unknown[] };
      expect(Array.isArray(parsed.edits)).toBe(true);
    }
  });

  it('should handle full workflow: open -> diagnostics -> hover -> completions -> goto', async () => {
    // This test exercises the complete workflow as a single flow
    const filePath = join(testWorkspace, 'sources', 'counter.move');

    // Step 1: Get diagnostics (implicitly opens document)
    const diagnosticsResult = await callTool('move_diagnostics', {
      filePath: filePath,
    });
    expect(diagnosticsResult.text).toContain('workspaceRoot');

    // Step 2: Get hover
    const hoverResult = await callTool('move_hover', {
      filePath: filePath,
      line: 3,
      character: 15,
    });
    expect(hoverResult.text.length).toBeGreaterThan(0);

    // Step 3: Get completions
    const completionsResult = await callTool('move_completions', {
      filePath: filePath,
      line: 8,
      character: 12,
    });
    expect(completionsResult.text.length).toBeGreaterThan(0);

    // Step 4: Get goto definition (tolerant of SYMBOL_NOT_FOUND — see test above)
    const gotoResult = await callTool(
      'move_goto_definition',
      { filePath, line: 8, character: 4 },
      ['SYMBOL_NOT_FOUND']
    );
    expect(gotoResult.text.length).toBeGreaterThan(0);
  });
});
