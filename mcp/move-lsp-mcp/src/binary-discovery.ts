/**
 * Binary discovery utilities for finding move-analyzer
 */

import { execFileSync } from 'child_process';
import { BinaryNotFoundError } from './errors.js';
import { log } from './logger.js';

/**
 * Discover the move-analyzer binary path
 */
export function discoverBinary(explicitPath?: string): string {
  // Check explicit path first if provided
  if (explicitPath) {
    try {
      execFileSync(explicitPath, ['--version'], { encoding: 'utf8', timeout: 5000 });
      log('info', 'Binary found at explicit path', { path: explicitPath });
      return explicitPath;
    } catch (error) {
      log('warn', 'Explicit binary path failed', { path: explicitPath, error });
      throw new BinaryNotFoundError(explicitPath);
    }
  }

  // Try to find in PATH
  try {
    const whichCommand = process.platform === 'win32' ? 'where' : 'which';
    const binaryPath = execFileSync(whichCommand, ['move-analyzer'], {
      encoding: 'utf8',
      timeout: 5000
    }).trim();

    if (binaryPath) {
      log('info', 'Binary found in PATH', { path: binaryPath });
      return binaryPath;
    }
  } catch (error) {
    log('debug', 'Binary not found in PATH', { error });
  }

  throw new BinaryNotFoundError();
}

/**
 * Get version information from move-analyzer
 */
export function getBinaryVersion(binaryPath: string): string {
  try {
    const version = execFileSync(binaryPath, ['--version'], {
      encoding: 'utf8',
      timeout: 5000
    }).trim();

    log('info', 'Retrieved binary version', { version, path: binaryPath });
    return version;
  } catch (error) {
    log('warn', 'Failed to get binary version', { path: binaryPath, error });
    throw new Error(`Failed to get version from ${binaryPath}: ${error}`);
  }
}