/**
 * Unit tests for binary discovery
 */

import { describe, test, expect, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { discoverBinary, getBinaryVersion } from '../../src/binary-discovery.js';
import { BinaryNotFoundError } from '../../src/errors.js';

// Mock child_process
vi.mock('child_process');
vi.mock('../../src/logger.js');

const mockExecFileSync = vi.mocked(execFileSync);

describe('binary-discovery', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('discoverBinary', () => {
    test('should return explicit path when provided and working', () => {
      const explicitPath = '/custom/path/move-analyzer';
      mockExecFileSync.mockReturnValueOnce('move-analyzer 1.0.0\n');

      const result = discoverBinary(explicitPath);

      expect(result).toBe(explicitPath);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        explicitPath,
        ['--version'],
        { encoding: 'utf8', timeout: 5000 }
      );
    });

    test('should throw BinaryNotFoundError when explicit path fails', () => {
      const explicitPath = '/invalid/path/move-analyzer';
      mockExecFileSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      expect(() => discoverBinary(explicitPath)).toThrow(BinaryNotFoundError);
      expect(() => discoverBinary(explicitPath)).toThrow('move-analyzer not found at path: /invalid/path/move-analyzer');
    });

    test('should find binary in PATH when no explicit path provided', () => {
      const pathResult = '/usr/local/bin/move-analyzer\n';
      mockExecFileSync.mockReturnValueOnce(pathResult);

      // Mock process.platform for non-Windows
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });

      const result = discoverBinary();

      expect(result).toBe('/usr/local/bin/move-analyzer');
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'which',
        ['move-analyzer'],
        { encoding: 'utf8', timeout: 5000 }
      );

      // Restore platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        writable: true,
      });
    });

    test('should use "where" command on Windows', () => {
      const pathResult = 'C:\\tools\\move-analyzer.exe\n';
      mockExecFileSync.mockReturnValueOnce(pathResult);

      // Mock process.platform for Windows
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
      });

      const result = discoverBinary();

      expect(result).toBe('C:\\tools\\move-analyzer.exe');
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'where',
        ['move-analyzer'],
        { encoding: 'utf8', timeout: 5000 }
      );

      // Restore platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        writable: true,
      });
    });

    test('should throw BinaryNotFoundError when not found in PATH', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('Command not found');
      });

      expect(() => discoverBinary()).toThrow(BinaryNotFoundError);
      expect(() => discoverBinary()).toThrow('move-analyzer not found in PATH');
    });

    test('should throw BinaryNotFoundError when PATH returns empty', () => {
      mockExecFileSync.mockReturnValueOnce('');

      expect(() => discoverBinary()).toThrow(BinaryNotFoundError);
    });
  });

  describe('getBinaryVersion', () => {
    test('should return version from binary', () => {
      const binaryPath = '/usr/local/bin/move-analyzer';
      const versionOutput = 'move-analyzer 1.2.3\n';
      mockExecFileSync.mockReturnValueOnce(versionOutput);

      const result = getBinaryVersion(binaryPath);

      expect(result).toBe('move-analyzer 1.2.3');
      expect(mockExecFileSync).toHaveBeenCalledWith(
        binaryPath,
        ['--version'],
        { encoding: 'utf8', timeout: 5000 }
      );
    });

    test('should throw error when version command fails', () => {
      const binaryPath = '/invalid/path';
      mockExecFileSync.mockImplementation(() => {
        throw new Error('Command failed');
      });

      expect(() => getBinaryVersion(binaryPath)).toThrow('Failed to get version from /invalid/path');
    });

    test('should handle multiline version output', () => {
      const binaryPath = '/usr/local/bin/move-analyzer';
      const versionOutput = 'move-analyzer 1.2.3\nBuilt from commit abc123\nRust version 1.70.0\n';
      mockExecFileSync.mockReturnValueOnce(versionOutput);

      const result = getBinaryVersion(binaryPath);

      expect(result).toBe('move-analyzer 1.2.3\nBuilt from commit abc123\nRust version 1.70.0');
    });
  });
});