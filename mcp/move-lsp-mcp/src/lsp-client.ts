/**
 * LSP client for communicating with move-analyzer
 */

import { spawn, ChildProcess } from 'child_process';
import {
  InitializeParams,
  InitializeResult,
  TextDocumentItem,
  VersionedTextDocumentIdentifier,
  TextDocumentContentChangeEvent,
  Hover,
  CompletionItem,
  CompletionItemKind,
  Location,
  LocationLink,
  DocumentSymbol,
  SymbolInformation,
  SymbolKind,
  WorkspaceEdit,
  TextEdit,
  Range,
  Command,
  CodeAction,
  InlayHint,
  InlayHintLabelPart,
  InlayHintKind,
} from 'vscode-languageserver-protocol';
import { LspStartFailedError, LspTimeoutError, LspCrashedError, LspProtocolError } from './errors.js';
import { log } from './logger.js';
import { Config } from './config.js';

/**
 * Represents an LSP request/response pair
 */
interface PendingRequest<T = unknown> {
  resolve: (result: T) => void;
  reject: (error: Error) => void;
  method: string;
}

/**
 * Diagnostic from LSP publishDiagnostics notification
 */
export interface LspDiagnostic {
  uri: string;
  diagnostics: Array<{
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    severity?: number;
    code?: string | number;
    source?: string;
    message: string;
  }>;
}

/**
 * Hover result from LSP
 */
export interface HoverResult {
  contents: string;
}

/**
 * Completion result from LSP
 */
export interface CompletionResult {
  completions: Array<{
    label: string;
    kind: string;
    detail?: string;
  }>;
}

/**
 * Location result from LSP goto-definition
 */
export interface LocationResult {
  filePath: string;
  line: number;
  character: number;
}

/**
 * Normalized range used by symbol/edit/code-action results
 */
export interface RangeResult {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

/**
 * Document symbol result (hierarchical when move-analyzer returns DocumentSymbol[])
 */
export type DocumentSymbolKind =
  | 'module'
  | 'struct'
  | 'function'
  | 'constant'
  | 'enum'
  | 'variant'
  | 'field'
  | 'other';

export interface DocumentSymbolResult {
  name: string;
  kind: DocumentSymbolKind;
  range: RangeResult;
  selectionRange: RangeResult;
  children?: DocumentSymbolResult[];
}

/**
 * Single text edit produced by rename or code-action resolution
 */
export interface WorkspaceEditEntry {
  filePath: string;
  range: RangeResult;
  newText: string;
}

/**
 * Code action result (resolved when possible — see codeAction() below)
 */
export interface CodeActionResult {
  title: string;
  kind?: string;
  edits?: WorkspaceEditEntry[];
  command?: {
    title: string;
    command: string;
    arguments?: unknown[];
  };
}

/**
 * Inlay hint result with label normalized to a string
 */
export interface InlayHintResult {
  line: number;
  character: number;
  label: string;
  kind?: 'type' | 'parameter';
}

/**
 * Map LSP CompletionItemKind to normalized string
 * Cross-package goto-definition may not resolve due to move-analyzer limitations on multi-package workspaces
 */
function completionKindToString(kind?: CompletionItemKind): string {
  switch (kind) {
    case CompletionItemKind.Function:
    case CompletionItemKind.Method:
      return 'function';
    case CompletionItemKind.Struct:
    case CompletionItemKind.Class:
      return 'struct';
    case CompletionItemKind.Field:
    case CompletionItemKind.Property:
      return 'field';
    case CompletionItemKind.Module:
      return 'module';
    case CompletionItemKind.Keyword:
      return 'keyword';
    case CompletionItemKind.Variable:
      return 'variable';
    case CompletionItemKind.Constant:
      return 'constant';
    default:
      return 'unknown';
  }
}

/**
 * Map LSP SymbolKind to our normalized DocumentSymbolKind strings
 */
function symbolKindToString(kind: SymbolKind): DocumentSymbolKind {
  switch (kind) {
    case SymbolKind.Module:
    case SymbolKind.Namespace:
    case SymbolKind.Package:
      return 'module';
    case SymbolKind.Struct:
    case SymbolKind.Class:
    case SymbolKind.Object:
    case SymbolKind.Interface:
      return 'struct';
    case SymbolKind.Function:
    case SymbolKind.Method:
    case SymbolKind.Constructor:
      return 'function';
    case SymbolKind.Constant:
      return 'constant';
    case SymbolKind.Enum:
      return 'enum';
    case SymbolKind.EnumMember:
      return 'variant';
    case SymbolKind.Field:
    case SymbolKind.Property:
      return 'field';
    default:
      return 'other';
  }
}

/**
 * Map LSP InlayHintKind to our normalized strings
 */
function inlayHintKindToString(kind?: InlayHintKind): 'type' | 'parameter' | undefined {
  if (kind === InlayHintKind.Type) return 'type';
  if (kind === InlayHintKind.Parameter) return 'parameter';
  return undefined;
}

/**
 * Convert an LSP Range to our normalized RangeResult shape
 */
function rangeToResult(range: Range): RangeResult {
  return {
    startLine: range.start.line,
    startCharacter: range.start.character,
    endLine: range.end.line,
    endCharacter: range.end.character,
  };
}

/**
 * Convert a file:// URI to a plain filesystem path
 */
function uriToPath(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

/**
 * Convert an LSP Command literal to our CodeActionResult['command'] shape,
 * omitting `arguments` when absent to satisfy exactOptionalPropertyTypes.
 */
function commandToResult(cmd: Command): NonNullable<CodeActionResult['command']> {
  const out: NonNullable<CodeActionResult['command']> = { title: cmd.title, command: cmd.command };
  if (cmd.arguments) out.arguments = cmd.arguments;
  return out;
}

/**
 * Recursively normalize a hierarchical DocumentSymbol tree into our shape
 */
function normalizeDocumentSymbol(sym: DocumentSymbol): DocumentSymbolResult {
  const result: DocumentSymbolResult = {
    name: sym.name,
    kind: symbolKindToString(sym.kind),
    range: rangeToResult(sym.range),
    selectionRange: rangeToResult(sym.selectionRange),
  };
  if (sym.children && sym.children.length > 0) {
    result.children = sym.children.map(normalizeDocumentSymbol);
  }
  return result;
}

/**
 * Flatten a WorkspaceEdit (either `.changes` or `.documentChanges`) into a flat
 * list of typed edits the bridge returns to MCP. Skips entries that are not
 * `TextDocumentEdit` (e.g. CreateFile / RenameFile / DeleteFile resource-ops).
 */
function flattenWorkspaceEdit(edit: WorkspaceEdit): WorkspaceEditEntry[] {
  const out: WorkspaceEditEntry[] = [];

  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      for (const e of edits as TextEdit[]) {
        out.push({ filePath: uriToPath(uri), range: rangeToResult(e.range), newText: e.newText });
      }
    }
  }

  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      if ('textDocument' in change && Array.isArray((change as { edits: unknown[] }).edits)) {
        const docEdit = change as { textDocument: { uri: string }; edits: TextEdit[] };
        for (const e of docEdit.edits) {
          out.push({
            filePath: uriToPath(docEdit.textDocument.uri),
            range: rangeToResult(e.range),
            newText: e.newText,
          });
        }
      }
    }
  }

  return out;
}

/**
 * LSP Client for move-analyzer
 *
 * Handles crash recovery, timeout handling, and automatic restart with configurable limits.
 * After MOVE_LSP_MAX_RESTARTS consecutive crashes, the client enters a "hard failed" state.
 */
export class MoveLspClient {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pendingRequests = new Map<number, PendingRequest<any>>();
  private isInitialized = false;
  private consecutiveCrashes = 0;  // Resets on successful operation
  private hardFailed = false;      // True after max restarts exceeded
  private isUnhealthy = false;     // True after timeout or protocol error
  private currentWorkspaceRoot: string | null = null;
  private diagnosticsStore = new Map<string, LspDiagnostic['diagnostics']>();
  private timeoutTimers = new Map<number, NodeJS.Timeout>();  // Track timeout timers for cleanup
  private killTimer: NodeJS.Timeout | null = null;  // Timer for SIGKILL escalation

  constructor(
    private readonly binaryPath: string,
    private readonly config: Config
  ) {}

  /**
   * Get the current child process PID (for testing/monitoring)
   */
  getPid(): number | null {
    return this.process?.pid ?? null;
  }

  /**
   * Check if the client has exceeded max restarts
   */
  hasHardFailed(): boolean {
    return this.hardFailed;
  }

  /**
   * Get current restart count
   */
  getConsecutiveCrashes(): number {
    return this.consecutiveCrashes;
  }

  /**
   * Set consecutive crash count (for restoring state after client recreation)
   */
  setConsecutiveCrashes(count: number): void {
    this.consecutiveCrashes = count;
  }

  /**
   * Reset hard failed state (for testing)
   */
  resetHardFailed(): void {
    this.hardFailed = false;
    this.consecutiveCrashes = 0;
  }

  /**
   * Get cached diagnostics for a URI
   */
  getDiagnostics(uri: string): LspDiagnostic['diagnostics'] {
    return this.diagnosticsStore.get(uri) || [];
  }

  /**
   * Get all cached diagnostics
   */
  getAllDiagnostics(): Map<string, LspDiagnostic['diagnostics']> {
    return new Map(this.diagnosticsStore);
  }

  /**
   * Clear diagnostics for a URI
   */
  clearDiagnostics(uri?: string): void {
    if (uri) {
      this.diagnosticsStore.delete(uri);
    } else {
      this.diagnosticsStore.clear();
    }
  }

  /**
   * Start the LSP server process
   * @throws LspStartFailedError if max restarts exceeded or startup fails
   */
  async start(workspaceRoot: string): Promise<void> {
    // Check if we've exceeded max restarts
    if (this.hardFailed) {
      throw new LspStartFailedError(
        `Max restarts (${this.config.moveLspMaxRestarts}) exceeded`,
        { consecutiveCrashes: this.consecutiveCrashes }
      );
    }

    log('info', 'Starting Move LSP client', {
      binaryPath: this.binaryPath,
      workspaceRoot,
      consecutiveCrashes: this.consecutiveCrashes,
    });

    this.currentWorkspaceRoot = workspaceRoot;
    this.isUnhealthy = false;

    try {
      // Spawn move-analyzer in LSP mode (no args needed - it's an LSP server by default)
      this.process = spawn(this.binaryPath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: workspaceRoot,
      });

      if (!this.process.stdin || !this.process.stdout || !this.process.stderr) {
        throw new LspStartFailedError('Failed to create process streams');
      }

      // Set up error handling
      this.process.on('error', (error) => {
        log('error', 'LSP process error', { error });
        this.handleProcessExit(1, null);
      });

      this.process.on('exit', (code, signal) => {
        log('info', 'LSP process exited', { code, signal });
        this.handleProcessExit(code, signal);
      });

      // Set up message handling
      this.setupMessageHandling();

      // Initialize the LSP server
      await this.initialize(workspaceRoot);

      // Successful start - reset consecutive crash counter
      this.consecutiveCrashes = 0;

      log('info', 'Move LSP client started successfully');
    } catch (error) {
      log('error', 'Failed to start LSP client', { error });
      this.consecutiveCrashes++;
      if (this.consecutiveCrashes >= this.config.moveLspMaxRestarts) {
        this.hardFailed = true;
        log('error', 'Max restarts exceeded, entering hard failed state', {
          event: 'lsp_hard_failed',
          consecutiveCrashes: this.consecutiveCrashes,
        });
      }
      await this.forceKill();
      throw new LspStartFailedError(`Startup failed: ${error}`);
    }
  }

  /**
   * Initialize the LSP server
   */
  private async initialize(workspaceRoot: string): Promise<void> {
    const initParams: InitializeParams = {
      processId: process.pid,
      rootUri: `file://${workspaceRoot}`,
      capabilities: {
        textDocument: {
          synchronization: {
            dynamicRegistration: false,
            willSave: false,
            willSaveWaitUntil: false,
            didSave: false,
          },
          documentSymbol: {
            hierarchicalDocumentSymbolSupport: true,
          },
          references: {},
          typeDefinition: {},
          codeAction: {
            resolveSupport: { properties: ['edit'] },
            codeActionLiteralSupport: {
              codeActionKind: {
                valueSet: ['quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source'],
              },
            },
          },
          rename: {
            prepareSupport: true,
          },
          inlayHint: {
            resolveSupport: { properties: ['label'] },
          },
        },
      },
    };

    const result = await this.sendRequest<InitializeResult>(
      'initialize',
      initParams
    );

    log('debug', 'LSP initialize result', { result });

    // Send initialized notification
    await this.sendNotification('initialized', {});
    this.isInitialized = true;
  }

  /**
   * Set up message handling for LSP communication
   */
  private setupMessageHandling(): void {
    if (!this.process?.stdout) {
      throw new Error('No stdout stream available');
    }

    let buffer = '';
    this.process.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();

      // Process complete messages
      while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;

        const header = buffer.substring(0, headerEnd);
        const contentLengthMatch = header.match(/Content-Length: (\d+)/);

        if (!contentLengthMatch) {
          log('warn', 'Invalid LSP message header', { header });
          buffer = buffer.substring(headerEnd + 4);
          continue;
        }

        const contentLength = parseInt(contentLengthMatch[1]!, 10);
        const messageStart = headerEnd + 4;

        if (buffer.length < messageStart + contentLength) {
          // Wait for complete message
          break;
        }

        const messageContent = buffer.substring(messageStart, messageStart + contentLength);
        buffer = buffer.substring(messageStart + contentLength);

        try {
          const message = JSON.parse(messageContent);
          this.handleMessage(message);
        } catch (error) {
          const protocolError = new LspProtocolError('Failed to parse JSON message', {
            parseError: error,
            messageContent: messageContent.substring(0, 200) // Truncate for logging
          });
          log('error', 'Malformed JSON-RPC response, killing child and marking unhealthy', {
            error: protocolError,
            event: 'lsp_protocol_error',
          });

          // Mark as unhealthy and kill child process
          this.isUnhealthy = true;
          this.killWithEscalation();

          // Reject all pending requests with protocol error
          for (const [, pending] of this.pendingRequests) {
            pending.reject(protocolError);
          }
          this.pendingRequests.clear();
        }
      }
    });
  }

  /**
   * Handle incoming LSP messages
   */
  private handleMessage(message: any): void {
    if (message.id !== undefined && this.pendingRequests.has(message.id)) {
      // Response to our request - clear timeout timer first
      const timeoutTimer = this.timeoutTimers.get(message.id);
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        this.timeoutTimers.delete(message.id);
      }

      const pending = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);

      if (message.error) {
        pending.reject(new Error(`LSP error: ${JSON.stringify(message.error)}`));
      } else {
        // Successful response - reset consecutive crash counter
        this.consecutiveCrashes = 0;
        pending.resolve(message.result);
      }
    } else if (message.method === 'textDocument/publishDiagnostics') {
      // Cache diagnostics from LSP server
      const params = message.params as LspDiagnostic;
      this.diagnosticsStore.set(params.uri, params.diagnostics);
      log('debug', 'Received diagnostics', { uri: params.uri, count: params.diagnostics.length });
    } else {
      log('debug', 'Unhandled LSP message', { message });
    }
  }

  /**
   * Send an LSP request and wait for response
   * On timeout: sends SIGTERM, waits 2s, sends SIGKILL if still alive
   */
  private sendRequest<T>(method: string, params: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const message = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, { resolve: resolve as any, reject, method });
      this.sendMessage(message);

      // Set timeout with SIGTERM/SIGKILL escalation
      const timeoutTimer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          this.timeoutTimers.delete(id);

          log('warn', 'LSP request timed out', {
            event: 'lsp_timeout',
            method,
            timeoutMs: this.config.moveLspTimeoutMs,
          });

          // Mark as unhealthy - next request will trigger restart
          this.isUnhealthy = true;

          // Kill the child process with SIGTERM/SIGKILL escalation
          this.killWithEscalation();

          reject(new LspTimeoutError(method, this.config.moveLspTimeoutMs));
        }
      }, this.config.moveLspTimeoutMs);

      this.timeoutTimers.set(id, timeoutTimer);
    });
  }

  /**
   * Kill child process with SIGTERM, escalate to SIGKILL after 2000ms
   */
  private killWithEscalation(): void {
    if (!this.process) return;

    const pid = this.process.pid;
    log('info', 'Sending SIGTERM to LSP process', { pid });
    this.process.kill('SIGTERM');

    // Schedule SIGKILL if process doesn't exit
    this.killTimer = setTimeout(() => {
      if (this.process && this.process.pid === pid) {
        log('warn', 'LSP process did not exit after SIGTERM, sending SIGKILL', { pid });
        this.process.kill('SIGKILL');
      }
      this.killTimer = null;
    }, 2000);
  }

  /**
   * Force kill the child process immediately
   */
  private async forceKill(): Promise<void> {
    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = null;
    }
    if (this.process) {
      this.process.kill('SIGKILL');
      this.process = null;
    }
    this.isInitialized = false;
  }

  /**
   * Send an LSP notification (no response expected)
   */
  private async sendNotification(method: string, params: unknown): Promise<void> {
    const message = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.sendMessage(message);
  }

  /**
   * Send a message to the LSP server
   */
  private sendMessage(message: unknown): void {
    if (!this.process?.stdin) {
      throw new Error('LSP process not available');
    }

    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content, 'utf8')}\r\n\r\n`;

    log('debug', 'Sending LSP message', { method: (message as any).method });
    this.process.stdin!.write(header + content);
  }

  /**
   * Open a document in the LSP server
   */
  async didOpen(uri: string, content: string, languageId = 'move', version = 1): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('LSP client not initialized');
    }

    const params = {
      textDocument: {
        uri,
        languageId,
        version,
        text: content,
      } as TextDocumentItem,
    };

    await this.sendNotification('textDocument/didOpen', params);
  }

  /**
   * Notify document changes
   */
  async didChange(
    uri: string,
    version: number,
    changes: TextDocumentContentChangeEvent[]
  ): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('LSP client not initialized');
    }

    const params = {
      textDocument: {
        uri,
        version,
      } as VersionedTextDocumentIdentifier,
      contentChanges: changes,
    };

    await this.sendNotification('textDocument/didChange', params);
  }

  /**
   * Request hover information for a position
   * @param uri Document URI
   * @param line 0-based line number
   * @param character 0-based character offset
   */
  async hover(uri: string, line: number, character: number): Promise<HoverResult | null> {
    if (!this.isInitialized) {
      throw new Error('LSP client not initialized');
    }

    const params = {
      textDocument: { uri },
      position: { line, character },
    };

    const result = await this.sendRequest<Hover | null>('textDocument/hover', params);

    if (!result || !result.contents) {
      return null;
    }

    // Normalize contents to string
    let contents: string;
    if (typeof result.contents === 'string') {
      contents = result.contents;
    } else if (Array.isArray(result.contents)) {
      contents = result.contents
        .map(c => (typeof c === 'string' ? c : (c as { value: string }).value))
        .join('\n');
    } else if ('value' in result.contents) {
      contents = (result.contents as { value: string }).value;
    } else {
      contents = String(result.contents);
    }

    return { contents };
  }

  /**
   * Request completion candidates for a position
   * @param uri Document URI
   * @param line 0-based line number
   * @param character 0-based character offset
   */
  async completion(uri: string, line: number, character: number): Promise<CompletionResult> {
    if (!this.isInitialized) {
      throw new Error('LSP client not initialized');
    }

    const params = {
      textDocument: { uri },
      position: { line, character },
    };

    const result = await this.sendRequest<CompletionItem[] | { items: CompletionItem[] } | null>(
      'textDocument/completion',
      params
    );

    // Handle null or empty response
    if (!result) {
      return { completions: [] };
    }

    // Handle both array and CompletionList formats
    const items = Array.isArray(result) ? result : (result.items || []);

    const completions = items.map(item => {
      const completion: { label: string; kind: string; detail?: string } = {
        label: item.label,
        kind: completionKindToString(item.kind),
      };
      if (item.detail) {
        completion.detail = item.detail;
      }
      return completion;
    });

    return { completions };
  }

  /**
   * Request goto-definition for a position
   * Cross-package goto-definition may not resolve due to move-analyzer limitations on multi-package workspaces
   * @param uri Document URI
   * @param line 0-based line number
   * @param character 0-based character offset
   */
  async gotoDefinition(uri: string, line: number, character: number): Promise<LocationResult[]> {
    if (!this.isInitialized) {
      throw new Error('LSP client not initialized');
    }

    const params = {
      textDocument: { uri },
      position: { line, character },
    };

    const result = await this.sendRequest<Location | Location[] | LocationLink[] | null>(
      'textDocument/definition',
      params
    );

    if (!result) {
      return [];
    }

    // Normalize to array
    const locations = Array.isArray(result) ? result : [result];

    return locations.map(loc => {
      // Handle both Location and LocationLink formats
      if ('targetUri' in loc) {
        // LocationLink
        return {
          filePath: loc.targetUri.replace('file://', ''),
          line: loc.targetSelectionRange.start.line,
          character: loc.targetSelectionRange.start.character,
        };
      } else {
        // Location
        return {
          filePath: loc.uri.replace('file://', ''),
          line: loc.range.start.line,
          character: loc.range.start.character,
        };
      }
    });
  }

  /**
   * Request type-definition for a position
   * Returns the location(s) where the type of the symbol at the position is declared.
   */
  async typeDefinition(uri: string, line: number, character: number): Promise<LocationResult[]> {
    if (!this.isInitialized) {
      throw new Error('LSP client not initialized');
    }

    const params = {
      textDocument: { uri },
      position: { line, character },
    };

    const result = await this.sendRequest<Location | Location[] | LocationLink[] | null>(
      'textDocument/typeDefinition',
      params
    );

    if (!result) {
      return [];
    }

    const locations = Array.isArray(result) ? result : [result];
    return locations.map(loc => {
      if ('targetUri' in loc) {
        return {
          filePath: uriToPath(loc.targetUri),
          line: loc.targetSelectionRange.start.line,
          character: loc.targetSelectionRange.start.character,
        };
      }
      return {
        filePath: uriToPath(loc.uri),
        line: loc.range.start.line,
        character: loc.range.start.character,
      };
    });
  }

  /**
   * Find every reference (call site / usage) of the symbol at a position
   * Cross-file within the workspace; honours `includeDeclaration`.
   */
  async findReferences(
    uri: string,
    line: number,
    character: number,
    includeDeclaration = false
  ): Promise<LocationResult[]> {
    if (!this.isInitialized) {
      throw new Error('LSP client not initialized');
    }

    const params = {
      textDocument: { uri },
      position: { line, character },
      context: { includeDeclaration },
    };

    const result = await this.sendRequest<Location[] | null>('textDocument/references', params);
    if (!result) return [];

    return result.map(loc => ({
      filePath: uriToPath(loc.uri),
      line: loc.range.start.line,
      character: loc.range.start.character,
    }));
  }

  /**
   * Request the full outline (modules, structs, functions, constants) of a document
   * Returns hierarchical DocumentSymbol[] when the server honours
   * `hierarchicalDocumentSymbolSupport`; falls back to a flat list otherwise.
   */
  async documentSymbols(uri: string): Promise<DocumentSymbolResult[]> {
    if (!this.isInitialized) {
      throw new Error('LSP client not initialized');
    }

    const params = { textDocument: { uri } };
    const result = await this.sendRequest<DocumentSymbol[] | SymbolInformation[] | null>(
      'textDocument/documentSymbol',
      params
    );
    if (!result || result.length === 0) return [];

    // Detect hierarchical vs deprecated SymbolInformation by shape
    const first = result[0]!;
    const isHierarchical = 'selectionRange' in first;

    if (isHierarchical) {
      return (result as DocumentSymbol[]).map(normalizeDocumentSymbol);
    }
    return (result as SymbolInformation[]).map(info => ({
      name: info.name,
      kind: symbolKindToString(info.kind),
      range: rangeToResult(info.location.range),
      selectionRange: rangeToResult(info.location.range),
    }));
  }

  /**
   * Request code actions (quick fixes, refactorings) for a position or range
   * If the server returns unresolved actions (no `edit` and no `command`), the
   * bridge eagerly calls `codeAction/resolve` so callers see fully-populated edits.
   */
  async codeActions(
    uri: string,
    range: { startLine: number; startCharacter: number; endLine: number; endCharacter: number }
  ): Promise<CodeActionResult[]> {
    if (!this.isInitialized) {
      throw new Error('LSP client not initialized');
    }

    const params = {
      textDocument: { uri },
      range: {
        start: { line: range.startLine, character: range.startCharacter },
        end: { line: range.endLine, character: range.endCharacter },
      },
      context: { diagnostics: this.getDiagnostics(uri) },
    };

    const result = await this.sendRequest<(Command | CodeAction)[] | null>(
      'textDocument/codeAction',
      params
    );
    if (!result || result.length === 0) return [];

    const out: CodeActionResult[] = [];
    for (const raw of result) {
      // Command literal: { title, command, arguments? }
      if (!('kind' in raw) && !('edit' in raw) && 'command' in raw && typeof raw.command === 'string') {
        const cmd = raw as Command;
        out.push({ title: cmd.title, command: commandToResult(cmd) });
        continue;
      }

      let action = raw as CodeAction;
      // Eagerly resolve if the action has neither edit nor command attached
      if (!action.edit && !action.command) {
        try {
          const resolved = await this.sendRequest<CodeAction | null>('codeAction/resolve', action);
          if (resolved) action = resolved;
        } catch (err) {
          log('warn', 'codeAction/resolve failed; returning unresolved action', {
            title: action.title,
            error: err,
          });
        }
      }

      const entry: CodeActionResult = { title: action.title };
      if (action.kind) entry.kind = action.kind;
      if (action.edit) {
        const flat = flattenWorkspaceEdit(action.edit);
        if (flat.length > 0) entry.edits = flat;
      }
      if (action.command) entry.command = commandToResult(action.command);
      out.push(entry);
    }
    return out;
  }

  /**
   * Request inlay hints for a range
   * Labels are normalized to a single string when the server returns
   * `InlayHintLabelPart[]`. Kind is mapped to 'type' | 'parameter' | undefined.
   */
  async inlayHints(
    uri: string,
    range: { startLine: number; startCharacter: number; endLine: number; endCharacter: number }
  ): Promise<InlayHintResult[]> {
    if (!this.isInitialized) {
      throw new Error('LSP client not initialized');
    }

    const params = {
      textDocument: { uri },
      range: {
        start: { line: range.startLine, character: range.startCharacter },
        end: { line: range.endLine, character: range.endCharacter },
      },
    };

    const result = await this.sendRequest<InlayHint[] | null>('textDocument/inlayHint', params);
    if (!result) return [];

    return result.map(hint => {
      const label = typeof hint.label === 'string'
        ? hint.label
        : (hint.label as InlayHintLabelPart[]).map(p => p.value).join('');
      const entry: InlayHintResult = {
        line: hint.position.line,
        character: hint.position.character,
        label,
      };
      const kind = inlayHintKindToString(hint.kind);
      if (kind) entry.kind = kind;
      return entry;
    });
  }

  /**
   * Run prepareRename then rename in one go, returning the proposed edits.
   * Returns `null` if prepareRename indicates the position is not renameable.
   * The caller is responsible for applying or rejecting the edits — this method
   * never writes to disk.
   */
  async rename(
    uri: string,
    line: number,
    character: number,
    newName: string
  ): Promise<WorkspaceEditEntry[] | null> {
    if (!this.isInitialized) {
      throw new Error('LSP client not initialized');
    }

    const prepareParams = {
      textDocument: { uri },
      position: { line, character },
    };
    const prepared = await this.sendRequest<
      Range | { range: Range; placeholder: string } | { defaultBehavior: boolean } | null
    >('textDocument/prepareRename', prepareParams);

    if (prepared === null) return null;
    if (typeof prepared === 'object' && 'defaultBehavior' in prepared && !prepared.defaultBehavior) {
      return null;
    }

    const renameParams = {
      textDocument: { uri },
      position: { line, character },
      newName,
    };
    const edit = await this.sendRequest<WorkspaceEdit | null>('textDocument/rename', renameParams);
    if (!edit) return [];

    return flattenWorkspaceEdit(edit);
  }

  /**
   * Handle process exit
   * Rejects all pending requests immediately with LSP_CRASHED error
   */
  private handleProcessExit(code: number | null, signal: string | null): void {
    // Clear any pending kill timer
    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = null;
    }

    // Clear all timeout timers
    for (const timer of this.timeoutTimers.values()) {
      clearTimeout(timer);
    }
    this.timeoutTimers.clear();

    this.process = null;
    this.isInitialized = false;

    // Create LspCrashedError for pending request rejections
    const crashedError = new LspCrashedError(code, signal);

    // Reject any pending requests immediately with the proper error type
    const pendingCount = this.pendingRequests.size;
    for (const [, pending] of this.pendingRequests) {
      pending.reject(crashedError);
    }
    this.pendingRequests.clear();

    // Track consecutive crashes if this was an unexpected exit
    if (code !== 0 || signal) {
      this.consecutiveCrashes++;
      log('warn', 'LSP process crashed', {
        event: 'lsp_crashed',
        code,
        signal,
        consecutiveCrashes: this.consecutiveCrashes,
        pendingRequestsRejected: pendingCount,
      });

      // Check if we've exceeded max restarts
      if (this.consecutiveCrashes >= this.config.moveLspMaxRestarts) {
        this.hardFailed = true;
        log('error', 'Max restarts exceeded, entering hard failed state', {
          event: 'lsp_hard_failed',
          consecutiveCrashes: this.consecutiveCrashes,
        });
      }
    }
  }

  /**
   * Shutdown the LSP server gracefully
   */
  async shutdown(): Promise<void> {
    if (!this.process) {
      return;
    }

    try {
      if (this.isInitialized) {
        await this.sendRequest('shutdown', null);
        await this.sendNotification('exit', null);
      }
    } catch (error) {
      log('warn', 'Error during LSP shutdown', { error });
    } finally {
      this.process.kill();
      this.process = null;
      this.isInitialized = false;
    }
  }

  /**
   * Check if the client is ready for requests
   * Returns false if uninitialized, no process, unhealthy, or hard failed
   */
  isReady(): boolean {
    return this.isInitialized && this.process !== null && !this.isUnhealthy && !this.hardFailed;
  }

  /**
   * Check if the client needs restart (unhealthy but not hard failed)
   */
  needsRestart(): boolean {
    return (this.isUnhealthy || !this.isInitialized || this.process === null) && !this.hardFailed;
  }

  /**
   * Get current workspace root
   */
  getWorkspaceRoot(): string | null {
    return this.currentWorkspaceRoot;
  }

  /**
   * Reopen documents after restart
   * Called by server after restart to restore document state
   * @param documents Array of documents to reopen with incremented versions
   */
  async reopenDocuments(documents: Array<{ uri: string; content: string; version: number }>): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('LSP client not initialized');
    }

    for (const doc of documents) {
      // Use incremented version to ensure LSP sees fresh document
      await this.didOpen(doc.uri, doc.content, 'move', doc.version);
      log('debug', 'Reopened document after restart', { uri: doc.uri, version: doc.version });
    }
  }
}