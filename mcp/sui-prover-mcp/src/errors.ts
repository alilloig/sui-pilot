/**
 * Error codes and types for the sui-prover MCP server. Codes are surfaced
 * inside MoveProverError instances so the dispatcher can translate to
 * structured MCP error responses.
 */

export const BINARY_NOT_FOUND = 'BINARY_NOT_FOUND';
export const MOVE_TOML_NOT_FOUND = 'MOVE_TOML_NOT_FOUND';
export const INVALID_PATH = 'INVALID_PATH';
export const INVALID_ARGUMENT = 'INVALID_ARGUMENT';
export const PROVE_FAILED = 'PROVE_FAILED';
export const PROVE_TIMEOUT = 'PROVE_TIMEOUT';
export const PROVE_SPAWN_FAILED = 'PROVE_SPAWN_FAILED';

export class SuiProverError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'SuiProverError';
  }
}

export class BinaryNotFoundError extends SuiProverError {
  constructor(path?: string) {
    super(
      path
        ? `sui-prover not found at path: ${path}`
        : 'sui-prover not found in PATH. Install via `brew install asymptotic-code/sui-prover/sui-prover` and retry.',
      BINARY_NOT_FOUND
    );
  }
}

export class MoveTomlNotFoundError extends SuiProverError {
  constructor(searchedFrom: string) {
    super(
      `No Move.toml found walking up from: ${searchedFrom}`,
      MOVE_TOML_NOT_FOUND,
      { searchedFrom }
    );
  }
}

export class ProveTimeoutError extends SuiProverError {
  constructor(timeoutSeconds: number) {
    super(
      `sui-prover invocation timed out after ${timeoutSeconds}s`,
      PROVE_TIMEOUT,
      { timeoutSeconds }
    );
  }
}
