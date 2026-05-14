/**
 * MCP server for sui-prover. Three tools:
 *
 *   - prove_package: run sui-prover and return structured findings
 *   - list_specs:    scan .move files for #[spec(...)] decorations
 *   - prover_capabilities: probe binary, toolchain, optional Move.toml
 *
 * Mirrors mcp/move-lsp-mcp/src/server.ts (TOOL_DEFINITIONS + handlers +
 * dispatch + setRequestHandler) but is much simpler -- no long-running
 * client, no document store, no workspace resolver.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { log, info, error } from './logger.js';
import { prove } from './prove.js';
import { listSpecs } from './list-specs.js';
import { capabilities } from './capabilities.js';
import { SuiProverError } from './errors.js';

const TOOL_DEFINITIONS = [
  {
    name: 'prove_package',
    description:
      'Run sui-prover against a Move package and return structured findings. Auto-walks from a file path up to its enclosing Move.toml. Use `target_function` (pkg::mod::fn) for per-function iteration during interactive spec authoring, or `target_module` for module-scoped runs. The result includes a `summary` (verified/failed/skipped/timeouts), a list of `findings` (each tagged with a `kind` like ensures_failed / asserts_failed / timeout / abort_unspecified / setup_warning), and `raw_stdout`/`raw_stderr` as an escape hatch when the parser lags binary releases. The wrapper never edits the user\'s Move.toml -- explicit Sui/MoveStdlib deps are surfaced as setup_warning findings.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Absolute path to a Move package directory containing Move.toml, OR to a .move file inside such a package. If a file is given, the wrapper walks up to find Move.toml.',
        },
        target_function: {
          type: 'string',
          description:
            'Optional. Restrict verification to one function, forwarded as `--functions`. Accepts `<function>`, `<module>::<function>`, or `<package>::<module>::<function>`. Mutually exclusive with target_module.',
        },
        target_module: {
          type: 'string',
          description:
            'Optional. Restrict verification to one module, forwarded as `--modules`. Accepts `<module>` or `<package>::<module>`. Mutually exclusive with target_function.',
        },
        timeout_seconds: {
          type: 'number',
          description: 'Per-spec verification timeout. Forwarded as `--timeout`. Defaults to 60s.',
          default: 60,
        },
        verbose: {
          type: 'boolean',
          description: 'Add `--verbose` to capture detailed Boogie progress in raw_stdout/raw_stderr.',
          default: false,
        },
        extra_args: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional escape-hatch args (e.g. `--split-paths=4`). Filtered against the supported-flag set captured at startup, so unknown flags are dropped with a warning rather than forwarded.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_specs',
    description:
      'Scan .move source files under a package (or a single file) and return every `#[spec(...)]`-annotated function. Used by the /specify flow for idempotency (skip already-specced functions) and resume (load progress across sessions). Each entry includes the file, 1-based line of the `fun` declaration, function name, optional `target` (set when the spec is cross-module via `#[spec(prove, target = pkg::mod::fn)]`), and the raw attribute tokens (e.g. ["prove", "no_opaque", "boogie_opt=b\\"...\\"\\"\\"]).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Absolute path to a Move package directory, a .move file, or a sources/ directory. Build directories and dotfiles are skipped.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'prover_capabilities',
    description:
      'Probe the local environment: sui-prover binary presence/version/supported-flag set, cloud-config availability (~/.asymptotic/sui_prover.toml), Sui toolchain version (for the 1.45+ implicit-deps gate), and -- when `move_toml_path` is given -- per-package setup warnings (explicit Sui/MoveStdlib deps that would disable implicit-dep injection, or non-2024 editions). Call once at the start of an interactive flow before invoking prove_package.',
    inputSchema: {
      type: 'object',
      properties: {
        move_toml_path: {
          type: 'string',
          description:
            'Optional. Absolute path to a Move.toml (or its enclosing package directory). When provided, the response includes setup_warnings for that package.',
        },
      },
    },
  },
] as const;

type ToolName = typeof TOOL_DEFINITIONS[number]['name'];

export function createServer(): Server {
  const server = new Server(
    { name: 'sui-prover-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  const toolHandlers: Record<ToolName, (args: any) => Promise<unknown>> = {
    prove_package: async (args) => prove(args),
    list_specs: async (args) => {
      if (!args || typeof args.path !== 'string') {
        throw new SuiProverError('path is required and must be a string', 'INVALID_ARGUMENT');
      }
      return listSpecs(args.path);
    },
    prover_capabilities: async (args) => capabilities(args || {}),
  };

  function isValidToolName(name: string): name is ToolName {
    return name in toolHandlers;
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOL_DEFINITIONS] }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (!isValidToolName(name)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: { code: 'UNKNOWN_TOOL', message: `Unknown tool: ${name}` } }, null, 2) }],
        isError: true,
      };
    }

    try {
      const result = await toolHandlers[name](args || {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      log('error', `Tool ${name} failed`, { error: err, args });
      if (err instanceof SuiProverError) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { error: { code: err.code, message: err.message, details: err.details } },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
      throw err;
    }
  });

  info('sui-prover MCP server constructed', { toolCount: TOOL_DEFINITIONS.length });
  return server;
}

export function initializeBinaryOnStartup(): void {
  // Lazy by design: every tool call probes independently so we tolerate
  // the binary being installed after the server has already started.
  // This function exists for parity with move-lsp-mcp's startup hook.
  info('sui-prover binary will be probed lazily at first tool call');
}

// Avoid unused-import lint
void error;
