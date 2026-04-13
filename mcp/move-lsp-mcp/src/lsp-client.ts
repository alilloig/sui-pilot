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
      // Spawn move-analyzer in LSP mode
      this.process = spawn(this.binaryPath, ['language-server'], {
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