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
import { log, setLogLevel, info, error, LogLevel } from './logger.js';
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
  RENAME_NOT_AVAILABLE,
} from './errors.js';
import type {
  LocationResult,
  DocumentSymbolResult,
  WorkspaceEditEntry,
  CodeActionResult,
  InlayHintResult,
} from './lsp-client.js';

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

interface FindReferencesResponse {
  workspaceRoot: string;
  locations: LocationResult[];
}

interface DocumentSymbolsResponse {
  workspaceRoot: string;
  symbols: DocumentSymbolResult[];
}

interface TypeDefinitionResponse {
  workspaceRoot: string;
  locations: LocationResult[];
}

interface CodeActionsResponse {
  workspaceRoot: string;
  actions: CodeActionResult[];
}

interface InlayHintsResponse {
  workspaceRoot: string;
  hints: InlayHintResult[];
}

interface RenameResponse {
  workspaceRoot: string;
  edits: WorkspaceEditEntry[];
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
  {
    name: 'move_find_references',
    description: 'Find every call site / usage of the symbol at the given position. Returns one entry per usage across the workspace, including in other modules and files. Use this (not move_goto_definition) when you need to discover callers of a function, every reader of a constant, or every site that names a struct.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to the Move source file' },
        line: { type: 'number', description: 'Line number (0-based)' },
        character: { type: 'number', description: 'Character offset (0-based)' },
        includeDeclaration: {
          type: 'boolean',
          description: 'If true, include the declaration site itself in the returned locations. Defaults to false.',
          default: false,
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
    name: 'move_document_symbols',
    description: 'Return the outline of a Move source file: every module, struct, public/public(package)/private/entry function, and constant, with positions. Prefer this over regex-based extraction when enumerating the API surface of a file.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to the Move source file' },
        content: {
          type: 'string',
          description: 'Optional file content (if not provided, reads from filePath)',
        },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'move_type_definition',
    description: 'Jump to the type declaration of the value at a position. Distinct from move_goto_definition: for a binding like `let x: Foo`, goto-definition jumps to where `x` is bound, type-definition jumps to where `Foo` is declared.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to the Move source file' },
        line: { type: 'number', description: 'Line number (0-based)' },
        character: { type: 'number', description: 'Character offset (0-based)' },
        content: {
          type: 'string',
          description: 'Optional file content (if not provided, reads from filePath)',
        },
      },
      required: ['filePath', 'line', 'character'],
    },
  },
  {
    name: 'move_code_actions',
    description: 'Return the compiler-offered quick fixes and refactorings at a position or range (auto-import, derive ability, etc.) — the same list an IDE\'s lightbulb shows. Actions are eagerly resolved when possible, so the returned edits are ready to apply.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to the Move source file' },
        line: { type: 'number', description: 'Start line number (0-based)' },
        character: { type: 'number', description: 'Start character offset (0-based)' },
        endLine: {
          type: 'number',
          description: 'Optional end line for range-based actions. Defaults to `line` (zero-width range).',
        },
        endCharacter: {
          type: 'number',
          description: 'Optional end character. Defaults to `character` (zero-width range).',
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
    name: 'move_inlay_hints',
    description: 'Return inlay hints (inferred types on let-bindings, parameter-name hints, etc.) for a range of a Move file. Use this when reading code with elided types to see what the compiler infers.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to the Move source file' },
        startLine: { type: 'number', description: 'Range start line (0-based)' },
        startCharacter: { type: 'number', description: 'Range start character (0-based)' },
        endLine: { type: 'number', description: 'Range end line (0-based)' },
        endCharacter: { type: 'number', description: 'Range end character (0-based)' },
        content: {
          type: 'string',
          description: 'Optional file content (if not provided, reads from filePath)',
        },
      },
      required: ['filePath', 'startLine', 'startCharacter', 'endLine', 'endCharacter'],
    },
  },
  {
    name: 'move_rename',
    description: 'Run prepareRename then rename for the symbol at a position. Returns the proposed edits — the bridge never writes them. The agent (or user) decides whether to apply them. Older move-analyzer builds may not implement rename and the request can time out; cross-package rename behaviour depends on move-analyzer.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to the Move source file' },
        line: { type: 'number', description: 'Line number (0-based)' },
        character: { type: 'number', description: 'Character offset (0-based)' },
        newName: { type: 'string', description: 'The new identifier to rename the symbol to' },
        content: {
          type: 'string',
          description: 'Optional file content (if not provided, reads from filePath)',
        },
      },
      required: ['filePath', 'line', 'character', 'newName'],
    },
  },
] as const;

/** Tool names derived from TOOL_DEFINITIONS for compile-time safety */
type ToolName = typeof TOOL_DEFINITIONS[number]['name'];

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
    setLogLevel(globalConfig.moveLspLogLevel as LogLevel);
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
    setLogLevel(globalConfig.moveLspLogLevel as LogLevel);
  }
  const config = globalConfig;

  const server = new Server(
    {
      name: 'move-lsp-mcp',
      version: '0.2.0',
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

    // Use shared document preparation with longer delay for diagnostics
    // Diagnostics needs 500ms for publishDiagnostics to arrive
    const { workspaceRoot, fileUri } = await prepareDocument(resolvedPath, content, 500);

    // Retrieve diagnostics from LSP client cache
    const lspDiagnostics = lspClient!.getDiagnostics(fileUri);

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
   * @param delay - milliseconds to wait for LSP processing (default 100, use 500 for diagnostics)
   */
  async function prepareDocument(
    resolvedPath: string,
    content: string | undefined,
    delay = 100
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
    await new Promise(r => setTimeout(r, delay));

    return { workspaceRoot, fileUri, fileContent };
  }

  /**
   * Validate position arguments (filePath, line, character)
   * Throws MoveLspError if validation fails
   */
  function validatePositionArgs(args: any): { filePath: string; line: number; character: number; content?: string } {
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

    return { filePath, line, character, content };
  }

  /**
   * Validate full-range arguments (filePath, startLine, startCharacter, endLine, endCharacter)
   * Used by range-scoped tools like move_inlay_hints.
   */
  function validateRangeArgs(args: any): {
    filePath: string;
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
    content?: string;
  } {
    const { filePath, startLine, startCharacter, endLine, endCharacter, content } = args;

    if (!filePath || typeof filePath !== 'string') {
      throw new MoveLspError('filePath is required and must be a string', INVALID_FILE_PATH);
    }
    for (const [name, val] of [
      ['startLine', startLine], ['startCharacter', startCharacter],
      ['endLine', endLine], ['endCharacter', endCharacter],
    ] as const) {
      if (typeof val !== 'number' || val < 0) {
        throw new MoveLspError(`${name} is required and must be a non-negative number`, INVALID_FILE_PATH);
      }
    }
    if (endLine < startLine || (endLine === startLine && endCharacter < startCharacter)) {
      throw new MoveLspError('range end must not precede range start', INVALID_FILE_PATH);
    }

    return { filePath, startLine, startCharacter, endLine, endCharacter, content };
  }

  // Handle move_hover tool
  async function handleMoveHover(args: any): Promise<HoverResponse> {
    const { filePath, line, character, content } = validatePositionArgs(args);

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
    const { filePath, line, character, content } = validatePositionArgs(args);

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
    const { filePath, line, character, content } = validatePositionArgs(args);

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

  // Handle move_find_references tool
  async function handleMoveFindReferences(args: any): Promise<FindReferencesResponse> {
    const { filePath, line, character, content } = validatePositionArgs(args);
    const includeDeclaration = args?.includeDeclaration === true;

    const resolvedPath = resolve(filePath);
    const { workspaceRoot, fileUri } = await prepareDocument(resolvedPath, content);

    const locations = await lspClient!.findReferences(fileUri, line, character, includeDeclaration);

    log('info', 'Find-references request completed', {
      filePath: resolvedPath, line, character,
      includeDeclaration, locationCount: locations.length,
    });

    return { workspaceRoot, locations };
  }

  // Handle move_document_symbols tool
  async function handleMoveDocumentSymbols(args: any): Promise<DocumentSymbolsResponse> {
    const { filePath, content } = args;
    if (!filePath || typeof filePath !== 'string') {
      throw new MoveLspError('filePath is required and must be a string', INVALID_FILE_PATH);
    }

    const resolvedPath = resolve(filePath);
    const { workspaceRoot, fileUri } = await prepareDocument(resolvedPath, content);

    const symbols = await lspClient!.documentSymbols(fileUri);

    log('info', 'Document-symbols request completed', {
      filePath: resolvedPath, workspaceRoot, symbolCount: symbols.length,
    });

    return { workspaceRoot, symbols };
  }

  // Handle move_type_definition tool
  async function handleMoveTypeDefinition(args: any): Promise<TypeDefinitionResponse> {
    const { filePath, line, character, content } = validatePositionArgs(args);

    const resolvedPath = resolve(filePath);
    const { workspaceRoot, fileUri } = await prepareDocument(resolvedPath, content);

    const locations = await lspClient!.typeDefinition(fileUri, line, character);

    if (locations.length === 0) {
      throw new SymbolNotFoundError('type', `${filePath}:${line}:${character}`);
    }

    log('info', 'Type-definition request completed', {
      filePath: resolvedPath, line, character, locationCount: locations.length,
    });

    return { workspaceRoot, locations };
  }

  // Handle move_code_actions tool
  async function handleMoveCodeActions(args: any): Promise<CodeActionsResponse> {
    const { filePath, line, character, content } = validatePositionArgs(args);
    const endLine = typeof args?.endLine === 'number' ? args.endLine : line;
    const endCharacter = typeof args?.endCharacter === 'number' ? args.endCharacter : character;

    if (endLine < line || (endLine === line && endCharacter < character)) {
      throw new MoveLspError('range end must not precede range start', INVALID_FILE_PATH);
    }

    const resolvedPath = resolve(filePath);
    // Diagnostics needs 500ms for publishDiagnostics to arrive; codeAction's
    // server-side context depends on those cached diagnostics, so use the same delay.
    const { workspaceRoot, fileUri } = await prepareDocument(resolvedPath, content, 500);

    const actions = await lspClient!.codeActions(fileUri, {
      startLine: line, startCharacter: character,
      endLine, endCharacter,
    });

    log('info', 'Code-actions request completed', {
      filePath: resolvedPath, line, character, actionCount: actions.length,
    });

    return { workspaceRoot, actions };
  }

  // Handle move_inlay_hints tool
  async function handleMoveInlayHints(args: any): Promise<InlayHintsResponse> {
    const { filePath, startLine, startCharacter, endLine, endCharacter, content } = validateRangeArgs(args);

    const resolvedPath = resolve(filePath);
    const { workspaceRoot, fileUri } = await prepareDocument(resolvedPath, content);

    const hints = await lspClient!.inlayHints(fileUri, {
      startLine, startCharacter, endLine, endCharacter,
    });

    log('info', 'Inlay-hints request completed', {
      filePath: resolvedPath, startLine, endLine, hintCount: hints.length,
    });

    return { workspaceRoot, hints };
  }

  // Handle move_rename tool
  // Runs prepareRename then rename; the bridge MUST NOT write the edits — the
  // caller (agent or user) decides whether to apply them.
  async function handleMoveRename(args: any): Promise<RenameResponse> {
    const { filePath, line, character, content } = validatePositionArgs(args);
    const newName = args?.newName;
    if (typeof newName !== 'string' || newName.trim().length === 0) {
      throw new MoveLspError('newName is required and must be a non-empty string', INVALID_FILE_PATH);
    }

    const resolvedPath = resolve(filePath);
    const { workspaceRoot, fileUri } = await prepareDocument(resolvedPath, content);

    const edits = await lspClient!.rename(fileUri, line, character, newName);
    if (edits === null) {
      throw new MoveLspError(
        `Rename not available at ${filePath}:${line}:${character}`,
        RENAME_NOT_AVAILABLE,
        { filePath, line, character }
      );
    }

    log('info', 'Rename request completed', {
      filePath: resolvedPath, line, character, newName, editCount: edits.length,
    });

    return { workspaceRoot, edits };
  }

  // Tool handler dispatch map
  const toolHandlers: Record<ToolName, (args: any) => Promise<any>> = {
    move_diagnostics: handleMoveDiagnostics,
    move_hover: handleMoveHover,
    move_completions: handleMoveCompletions,
    move_goto_definition: handleMoveGotoDefinition,
    move_find_references: handleMoveFindReferences,
    move_document_symbols: handleMoveDocumentSymbols,
    move_type_definition: handleMoveTypeDefinition,
    move_code_actions: handleMoveCodeActions,
    move_inlay_hints: handleMoveInlayHints,
    move_rename: handleMoveRename,
  };

  /** Type guard for valid tool names */
  function isValidToolName(name: string): name is ToolName {
    return name in toolHandlers;
  }

  /**
   * Dispatch a tool call and return the result
   * Shared between production handler and test helper
   */
  async function dispatchToolCall(name: string, args: any): Promise<any> {
    if (!isValidToolName(name)) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return toolHandlers[name](args || {});
  }

  /**
   * Format a MoveLspError for MCP response
   * Shared between production handler and test helper
   */
  function formatErrorResponse(err: MoveLspError, args: any): { content: { type: string; text: string }[]; isError: true } {
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
              code: err.code,
              message: err.message,
              details: err.details,
            },
          }, null, 2),
        },
      ],
      isError: true,
    };
  }

  /**
   * Handle a tool call request with dispatch, serialization, and error handling
   * Shared between production handler and test helper
   */
  async function handleToolRequest(name: string, args: any): Promise<{ content: { type: string; text: string }[]; isError?: true }> {
    try {
      const result = await dispatchToolCall(name, args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      log('error', `Tool ${name} failed`, { error: err, args });

      if (err instanceof MoveLspError) {
        return formatErrorResponse(err, args);
      }

      throw err;
    }
  }

  // Register tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: [...TOOL_DEFINITIONS] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleToolRequest(name, args);
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
        return handleToolRequest(name, args);
      };
    }

    return undefined;
  };

  return serverWithTestHelpers;
}
