/**
 * MCP Server for Move LSP integration
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { MoveLspClient } from './lsp-client.js';
import { discoverBinary, getBinaryVersion } from './binary-discovery.js';
import { parseConfig, validateConfig } from './config.js';
import { log, setLogLevel, info, error } from './logger.js';
import { WorkspaceResolver } from './workspace.js';
import { DocumentStore } from './document-store.js';
import { checkVersionCompatibility } from './version.js';
import {
  BinaryNotFoundError,
  NoWorkspaceError,
  MoveLspError,
  SymbolNotFoundError,
  LspStartFailedError,
  INVALID_FILE_PATH,
  FILE_NOT_FOUND,
  NO_WORKSPACE,
  SCOPE_NOT_IMPLEMENTED,
} from './errors.js';

/**
 * Diagnostic result from move-analyzer (matches spec output schema)
 */
interface DiagnosticResult {
  workspaceRoot: string;
  diagnostics: Array<{
    filePath: string;
    range: {
      startLine: number;
      startCharacter: number;
      endLine: number;
      endCharacter: number;
    };
    severity: 'error' | 'warning' | 'information' | 'hint';
    message: string;
    source: string;
    code: string | number | null;
  }>;
}

/**
 * Hover result (matches spec output schema)
 */
interface HoverResponse {
  workspaceRoot: string;
  contents: string | null;
}

/**
 * Completions result (matches spec output schema)
 */
interface CompletionsResponse {
  workspaceRoot: string;
  completions: Array<{
    label: string;
    kind: string;
    detail?: string;
  }>;
}

/**
 * Goto-definition result (matches spec output schema)
 * Cross-package goto-definition may not resolve due to move-analyzer limitations on multi-package workspaces
 */
interface GotoDefinitionResponse {
  workspaceRoot: string;
  locations: Array<{
    filePath: string;
    line: number;
    character: number;
  }>;
}

// LSP diagnostic severity to string mapping
function severityToString(severity: number): 'error' | 'warning' | 'information' | 'hint' {
  switch (severity) {
    case 1: return 'error';
    case 2: return 'warning';
    case 3: return 'information';
    case 4: return 'hint';
    default: return 'error';
  }
}

/**
 * Tool definitions for the MCP server (shared between production and test handlers)
 */
const TOOL_DEFINITIONS = [
  {
    name: 'move_diagnostics',
    description: 'Get Move language diagnostics for a file using move-analyzer',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the Move source file to analyze',
        },
        content: {
          type: 'string',
          description: 'Optional file content (if not provided, reads from filePath)',
        },
        scope: {
          type: 'string',
          enum: ['file', 'package', 'workspace'],
          description: 'Analysis scope (currently only file is supported)',
          default: 'file',
        },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'move_hover',
    description: 'Get hover information (type, documentation) for a symbol at a position in a Move file',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the Move source file',
        },
        line: {
          type: 'number',
          description: 'Line number (0-based)',
        },
        character: {
          type: 'number',
          description: 'Character offset (0-based)',
        },
        content: {
          type: 'string',
          description: 'Optional file content (if not provided, reads from filePath)',
        },
      },
      required: ['filePath', 'line', 'character'],
    },
  },
  {
    name: 'move_completions',
    description: 'Get completion candidates at a position in a Move file',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the Move source file',
        },
        line: {
          type: 'number',
          description: 'Line number (0-based)',
        },
        character: {
          type: 'number',
          description: 'Character offset (0-based)',
        },
        content: {
          type: 'string',
          description: 'Optional file content (if not provided, reads from filePath)',
        },
      },
      required: ['filePath', 'line', 'character'],
    },
  },
  {
    name: 'move_goto_definition',
    description: 'Get the definition location for a symbol at a position in a Move file. Cross-package goto-definition may not resolve due to move-analyzer limitations.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the Move source file',
        },
        line: {
          type: 'number',
          description: 'Line number (0-based)',
        },
        character: {
          type: 'number',
          description: 'Character offset (0-based)',
        },
        content: {
          type: 'string',
          description: 'Optional file content (if not provided, reads from filePath)',
        },
      },
      required: ['filePath', 'line', 'character'],
    },
  },
] as const;

// Module-level state for binary discovery (shared across server instances)
let globalBinaryPath: string | null = null;
let globalConfig: ReturnType<typeof parseConfig> | null = null;

/**
 * Initialize binary discovery on startup (called from index.ts)
 * Logs version info to stderr in JSON format
 */
export async function initializeBinaryOnStartup(): Promise<void> {
  if (!globalConfig) {
    globalConfig = parseConfig();
    validateConfig(globalConfig);
    setLogLevel(globalConfig.moveLspLogLevel as any);
  }

  // Check VERSION.json compatibility at startup
  const versionJsonPath = resolve(__dirname, '../../docs/VERSION.json');
  const compatibility = checkVersionCompatibility(versionJsonPath);
  if (!compatibility.compatible && compatibility.warning) {
    log('warn', compatibility.warning, { event: 'version_check' });
  }

  if (globalBinaryPath) return;

  globalBinaryPath = discoverBinary(globalConfig.moveAnalyzerPath || undefined);
  const version = getBinaryVersion(globalBinaryPath);
  info('Move analyzer binary check', {
    event: 'binary_version_check',
    path: globalBinaryPath,
    version
  });
}

/**
 * Create and configure the MCP server
 */
export function createServer(): Server {
  if (!globalConfig) {
    globalConfig = parseConfig();
    validateConfig(globalConfig);
    setLogLevel(globalConfig.moveLspLogLevel as any);
  }
  const config = globalConfig;

  const server = new Server(
    {
      name: 'move-lsp-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  let lspClient: MoveLspClient | null = null;
  const workspaceResolver = new WorkspaceResolver();
  const documentStore = new DocumentStore();

  // Initialize binary discovery (uses global state from startup)
  async function initializeBinary(): Promise<void> {
    if (globalBinaryPath) return;

    try {
      globalBinaryPath = discoverBinary(config.moveAnalyzerPath || undefined);
      const version = getBinaryVersion(globalBinaryPath);
      info('Move analyzer initialized', { path: globalBinaryPath, version });
    } catch (err) {
      if (err instanceof BinaryNotFoundError) {
        error('move-analyzer not found. Please install Sui and ensure move-analyzer is in PATH', {
          moveAnalyzerPath: config.moveAnalyzerPath,
        });
        throw err;
      }
      throw err;
    }
  }

  /**
   * Initialize or restart LSP client for a workspace
   * Handles restart recovery by reopening cached documents
   */
  async function initializeLspClient(workspaceRoot: string): Promise<void> {
    // If client is healthy and ready, check workspace matches
    if (lspClient?.isReady()) {
      const currentWorkspace = lspClient.getWorkspaceRoot();
      if (currentWorkspace === workspaceRoot) {
        return; // Same workspace, nothing to do
      }
      // Different workspace - need to restart for new workspace
      log('info', 'Restarting LSP client for different workspace', {
        event: 'lsp_workspace_switch',
        previousWorkspace: currentWorkspace,
        newWorkspace: workspaceRoot,
      });
      try {
        await lspClient.shutdown();
      } catch (err) {
        log('warn', 'Error shutting down client for workspace switch', { error: err });
      }
    }

    // Check if we need to restart an unhealthy client
    if (lspClient?.needsRestart()) {
      log('info', 'LSP client needs restart, attempting recovery', {
        event: 'lsp_restart_recovery',
        workspaceRoot,
      });

      // Shutdown old client gracefully
      try {
        await lspClient.shutdown();
      } catch (err) {
        log('warn', 'Error shutting down unhealthy client', { error: err });
      }
    }

    // Check if hard failed - don't attempt restart
    if (lspClient?.hasHardFailed()) {
      throw new LspStartFailedError(
        `Max restarts (${config.moveLspMaxRestarts}) exceeded`,
        { consecutiveCrashes: lspClient.getConsecutiveCrashes() }
      );
    }

    await initializeBinary();
    if (!globalBinaryPath) {
      throw new Error('Binary not initialized');
    }

    // Create new client (preserves restart count if existing client had crashes)
    const previousCrashes = lspClient?.getConsecutiveCrashes() ?? 0;
    lspClient = new MoveLspClient(globalBinaryPath, config);

    // Restore consecutive crash count for continuity
    if (previousCrashes > 0) {
      lspClient.setConsecutiveCrashes(previousCrashes);
      log('info', 'Attempting restart after crashes', {
        previousCrashes,
        maxRestarts: config.moveLspMaxRestarts,
      });
    }

    await lspClient.start(workspaceRoot);

    // After successful restart, reopen cached documents for this workspace
    const cachedDocs = documentStore.getAllForWorkspace(workspaceRoot);
    if (cachedDocs.length > 0) {
      log('info', 'Reopening cached documents after restart', {
        event: 'lsp_reopen_docs',
        documentCount: cachedDocs.length,
        workspaceRoot,
      });

      // Increment versions in document store before reopening
      documentStore.incrementVersionsForWorkspace(workspaceRoot);

      // Get updated documents with incremented versions
      const updatedDocs = documentStore.getAllForWorkspace(workspaceRoot);

      await lspClient.reopenDocuments(updatedDocs);
    }
  }

  // Handle move_diagnostics tool
  async function handleMoveDiagnostics(args: any): Promise<DiagnosticResult> {
    const { filePath, content, scope } = args;

    if (!filePath || typeof filePath !== 'string') {
      throw new MoveLspError('filePath is required and must be a string', INVALID_FILE_PATH);
    }

    // Validate scope parameter - currently only 'file' is supported
    if (scope && scope !== 'file') {
      throw new MoveLspError(
        `Scope '${scope}' is not yet implemented. Currently only 'file' scope is supported.`,
        SCOPE_NOT_IMPLEMENTED
      );
    }

    const resolvedPath = resolve(filePath);

    // Check if file exists (for file-on-disk mode)
    if (!content && !existsSync(resolvedPath)) {
      throw new MoveLspError(`File not found: ${resolvedPath}`, FILE_NOT_FOUND);
    }

    // Find workspace root using cached resolver
    let workspaceRoot: string;
    try {
      workspaceRoot = workspaceResolver.resolve(resolvedPath);
    } catch (err) {
      if (err instanceof NoWorkspaceError) {
        throw err;
      }
      throw new MoveLspError(`Failed to find workspace: ${err}`, NO_WORKSPACE);
    }

    // Initialize LSP client
    await initializeLspClient(workspaceRoot);
    if (!lspClient) {
      throw new Error('Failed to initialize LSP client');
    }

    // Read file content if not provided
    const fileContent = content || readFileSync(resolvedPath, 'utf8');
    const fileUri = `file://${resolvedPath}`;

    // Track document state and use appropriate LSP notification
    const existingDoc = documentStore.get(fileUri);
    if (existingDoc) {
      // Document already open - use didChange with incremented version
      const newVersion = existingDoc.version + 1;
      documentStore.didChange(fileUri, fileContent, newVersion);
      await lspClient.didChange(fileUri, newVersion, [{ text: fileContent }]);
    } else {
      // New document - use didOpen
      documentStore.didOpen(fileUri, fileContent, 1);
      await lspClient.didOpen(fileUri, fileContent);
    }

    // Wait briefly for LSP server to process and send diagnostics
    // publishDiagnostics is async and may arrive after didOpen returns
    await new Promise(resolve => setTimeout(resolve, 500));

    // Retrieve diagnostics from LSP client cache
    const lspDiagnostics = lspClient.getDiagnostics(fileUri);

    // Transform LSP diagnostics to our output format
    const diagnostics = lspDiagnostics.map(d => ({
      filePath: resolvedPath,
      range: {
        startLine: d.range.start.line,
        startCharacter: d.range.start.character,
        endLine: d.range.end.line,
        endCharacter: d.range.end.character,
      },
      severity: severityToString(d.severity ?? 1),
      message: d.message,
      source: d.source ?? 'move-analyzer',
      code: d.code ?? null,
    }));

    const result: DiagnosticResult = {
      workspaceRoot,
      diagnostics,
    };

    log('info', 'Diagnostics request completed', {
      filePath: resolvedPath,
      workspaceRoot,
      scope: scope || 'file',
      diagnosticsCount: diagnostics.length,
    });

    return result;
  }

  /**
   * Prepare document for LSP operations
   * Opens or updates document in LSP client based on provided content or disk file
   */
  async function prepareDocument(
    resolvedPath: string,
    content: string | undefined
  ): Promise<{ workspaceRoot: string; fileUri: string; fileContent: string }> {
    // Check if file exists (for file-on-disk mode)
    if (!content && !existsSync(resolvedPath)) {
      throw new MoveLspError(`File not found: ${resolvedPath}`, FILE_NOT_FOUND);
    }

    // Find workspace root using cached resolver
    let workspaceRoot: string;
    try {
      workspaceRoot = workspaceResolver.resolve(resolvedPath);
    } catch (err) {
      if (err instanceof NoWorkspaceError) {
        throw err;
      }
      throw new MoveLspError(`Failed to find workspace: ${err}`, NO_WORKSPACE);
    }

    // Initialize LSP client
    await initializeLspClient(workspaceRoot);
    if (!lspClient) {
      throw new Error('Failed to initialize LSP client');
    }

    // Read file content if not provided
    const fileContent = content || readFileSync(resolvedPath, 'utf8');
    const fileUri = `file://${resolvedPath}`;

    // Track document state and use appropriate LSP notification
    const existingDoc = documentStore.get(fileUri);
    if (existingDoc) {
      // Document already open - use didChange with incremented version
      const newVersion = existingDoc.version + 1;
      documentStore.didChange(fileUri, fileContent, newVersion);
      await lspClient.didChange(fileUri, newVersion, [{ text: fileContent }]);
    } else {
      // New document - use didOpen
      documentStore.didOpen(fileUri, fileContent, 1);
      await lspClient.didOpen(fileUri, fileContent);
    }

    // Wait briefly for LSP server to process
    await new Promise(resolve => setTimeout(resolve, 100));

    return { workspaceRoot, fileUri, fileContent };
  }

  // Handle move_hover tool
  async function handleMoveHover(args: any): Promise<HoverResponse> {
    const { filePath, line, character, content } = args;

    if (!filePath || typeof filePath !== 'string') {
      throw new MoveLspError('filePath is required and must be a string', INVALID_FILE_PATH);
    }
    if (typeof line !== 'number' || line < 0) {
      throw new MoveLspError('line is required and must be a non-negative number', INVALID_FILE_PATH);
    }
    if (typeof character !== 'number' || character < 0) {
      throw new MoveLspError('character is required and must be a non-negative number', INVALID_FILE_PATH);
    }

    const resolvedPath = resolve(filePath);
    const { workspaceRoot, fileUri } = await prepareDocument(resolvedPath, content);

    const result = await lspClient!.hover(fileUri, line, character);

    log('info', 'Hover request completed', {
      filePath: resolvedPath,
      line,
      character,
      hasContents: result !== null,
    });

    return {
      workspaceRoot,
      contents: result?.contents ?? null,
    };
  }

  // Handle move_completions tool
  async function handleMoveCompletions(args: any): Promise<CompletionsResponse> {
    const { filePath, line, character, content } = args;

    if (!filePath || typeof filePath !== 'string') {
      throw new MoveLspError('filePath is required and must be a string', INVALID_FILE_PATH);
    }
    if (typeof line !== 'number' || line < 0) {
      throw new MoveLspError('line is required and must be a non-negative number', INVALID_FILE_PATH);
    }
    if (typeof character !== 'number' || character < 0) {
      throw new MoveLspError('character is required and must be a non-negative number', INVALID_FILE_PATH);
    }

    const resolvedPath = resolve(filePath);
    const { workspaceRoot, fileUri } = await prepareDocument(resolvedPath, content);

    const result = await lspClient!.completion(fileUri, line, character);

    log('info', 'Completions request completed', {
      filePath: resolvedPath,
      line,
      character,
      completionCount: result.completions.length,
    });

    return {
      workspaceRoot,
      completions: result.completions,
    };
  }

  // Handle move_goto_definition tool
  // Cross-package goto-definition may not resolve due to move-analyzer limitations on multi-package workspaces
  async function handleMoveGotoDefinition(args: any): Promise<GotoDefinitionResponse> {
    const { filePath, line, character, content } = args;

    if (!filePath || typeof filePath !== 'string') {
      throw new MoveLspError('filePath is required and must be a string', INVALID_FILE_PATH);
    }
    if (typeof line !== 'number' || line < 0) {
      throw new MoveLspError('line is required and must be a non-negative number', INVALID_FILE_PATH);
    }
    if (typeof character !== 'number' || character < 0) {
      throw new MoveLspError('character is required and must be a non-negative number', INVALID_FILE_PATH);
    }

    const resolvedPath = resolve(filePath);
    const { workspaceRoot, fileUri } = await prepareDocument(resolvedPath, content);

    const locations = await lspClient!.gotoDefinition(fileUri, line, character);

    if (locations.length === 0) {
      throw new SymbolNotFoundError('symbol', `${filePath}:${line}:${character}`);
    }

    log('info', 'Goto-definition request completed', {
      filePath: resolvedPath,
      line,
      character,
      locationCount: locations.length,
    });

    return {
      workspaceRoot,
      locations,
    };
  }

  // Tool handler dispatch map
  const toolHandlers: Record<string, (args: any) => Promise<any>> = {
    move_diagnostics: handleMoveDiagnostics,
    move_hover: handleMoveHover,
    move_completions: handleMoveCompletions,
    move_goto_definition: handleMoveGotoDefinition,
  };

  /**
   * Dispatch a tool call and return the result
   * Shared between production handler and test helper
   */
  async function dispatchToolCall(name: string, args: any): Promise<any> {
    const handler = toolHandlers[name];
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return handler(args || {});
  }

  /**
   * Format a MoveLspError for MCP response
   * Shared between production handler and test helper
   */
  function formatErrorResponse(error: MoveLspError, args: any) {
    let errorWorkspaceRoot: string | null = null;
    try {
      const filePath = args?.filePath;
      if (filePath && typeof filePath === 'string') {
        errorWorkspaceRoot = workspaceResolver.resolve(resolve(filePath));
      }
    } catch {
      // Workspace resolution failed - leave as null
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            workspaceRoot: errorWorkspaceRoot,
            error: {
              code: error.code,
              message: error.message,
              details: error.details,
            },
          }, null, 2),
        },
      ],
      isError: true,
    };
  }

  // Register tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: [...TOOL_DEFINITIONS] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await dispatchToolCall(name, args);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      log('error', `Tool ${name} failed`, { error, args });

      if (error instanceof MoveLspError) {
        return formatErrorResponse(error, args);
      }

      throw error;
    }
  });

  // Cleanup on server shutdown
  server.close = async () => {
    if (lspClient) {
      await lspClient.shutdown();
    }
  };

  // Test helper: expose handlers for integration testing
  // The MCP SDK Server class doesn't have getRequestHandler, so we add it here
  const serverWithTestHelpers = server as Server & {
    getRequestHandler: (method: string) => ((request: any) => Promise<any>) | undefined;
  };

  serverWithTestHelpers.getRequestHandler = (method: string) => {
    if (method === 'tools/list') {
      return async () => ({ tools: [...TOOL_DEFINITIONS] });
    }

    if (method === 'tools/call') {
      return async (request: any) => {
        const { name, arguments: args } = request.params;

        try {
          const result = await dispatchToolCall(name, args);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          log('error', `Tool ${name} failed`, { error, args });

          if (error instanceof MoveLspError) {
            return formatErrorResponse(error, args);
          }

          throw error;
        }
      };
    }

    return undefined;
  };

  return serverWithTestHelpers;
}
