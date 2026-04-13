/**
 * Unit tests for WorkspaceResolver
 */

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { resolve, join } from 'path';
import { WorkspaceResolver } from '../../src/workspace.js';
import { NoWorkspaceError } from '../../src/errors.js';

// Mock logger to avoid noise during tests
vi.mock('../../src/logger.js', () => ({
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

describe('WorkspaceResolver', () => {
  let resolver: WorkspaceResolver;
  const fixturesDir = resolve(__dirname, '../fixtures');
  const simplePackage = join(fixturesDir, 'simple-package');
  const exampleMove = join(simplePackage, 'sources/example.move');

  // Multiple workspace fixtures for LRU testing
  const workspaceA = join(fixturesDir, 'workspace-a');
  const workspaceB = join(fixturesDir, 'workspace-b');
  const workspaceC = join(fixturesDir, 'workspace-c');
  const workspaceD = join(fixturesDir, 'workspace-d');

  beforeEach(() => {
    resolver = new WorkspaceResolver();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('resolve', () => {
    test('should find workspace root containing Move.toml', () => {
      const workspaceRoot = resolver.resolve(exampleMove);
      expect(workspaceRoot).toBe(simplePackage);
    });

    test('should throw NoWorkspaceError for file outside workspace', () => {
      // /tmp is unlikely to have a Move.toml
      expect(() => resolver.resolve('/tmp/some-file.move')).toThrow(NoWorkspaceError);
    });

    test('should handle deeply nested files', () => {
      // Even though this path doesn't exist, resolution walks up to find Move.toml
      const deepPath = join(simplePackage, 'sources/deep/nested/file.move');
      const workspaceRoot = resolver.resolve(deepPath);
      expect(workspaceRoot).toBe(simplePackage);
    });
  });

  describe('cache behavior', () => {
    test('should increment misses on first access', () => {
      resolver.resolve(exampleMove);

      const stats = resolver.getCacheStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);
    });

    test('should increment hits on subsequent access', () => {
      resolver.resolve(exampleMove);
      resolver.resolve(exampleMove); // Second access should hit cache

      const stats = resolver.getCacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });

    test('should report correct cache size', () => {
      resolver.resolve(exampleMove);

      const stats = resolver.getCacheStats();
      expect(stats.size).toBe(1);
    });
  });

  describe('LRU eviction', () => {
    test('should evict LRU entry when cache exceeds max size', () => {
      // Create resolver with max size 3 (default)
      const lruResolver = new WorkspaceResolver(3);

      // Use files from DIFFERENT workspaces to test LRU eviction
      // Cache is keyed by workspace root, not file path
      const pathA = join(workspaceA, 'sources/module.move');
      const pathB = join(workspaceB, 'sources/module.move');
      const pathC = join(workspaceC, 'sources/module.move');
      const pathD = join(workspaceD, 'sources/module.move');

      // Access workspaces A, B, C (fills cache with 3 workspace roots)
      lruResolver.resolve(pathA);
      lruResolver.resolve(pathB);
      lruResolver.resolve(pathC);

      expect(lruResolver.getCacheStats().size).toBe(3);

      // Access workspace D - should evict workspace A (LRU)
      lruResolver.resolve(pathD);

      expect(lruResolver.getCacheStats().size).toBe(3);
      expect(lruResolver.getCacheStats().misses).toBe(4);

      // Access workspace A again - should be a cache miss (was evicted)
      lruResolver.resolve(pathA);
      expect(lruResolver.getCacheStats().misses).toBe(5);
    });

    test('should preserve recently accessed entries during eviction', () => {
      const lruResolver = new WorkspaceResolver(3);

      const pathA = join(workspaceA, 'sources/module.move');
      const pathB = join(workspaceB, 'sources/module.move');
      const pathC = join(workspaceC, 'sources/module.move');
      const pathD = join(workspaceD, 'sources/module.move');

      // Fill cache with 3 workspace roots
      lruResolver.resolve(pathA); // access order: 1
      lruResolver.resolve(pathB); // access order: 2
      lruResolver.resolve(pathC); // access order: 3

      // Access workspace A again to make it most recent
      lruResolver.resolve(pathA); // access order: 4 (hit)

      // Now add workspace D - should evict workspace B (now the LRU)
      lruResolver.resolve(pathD);

      // workspace A should still be in cache (hit)
      const beforeStats = lruResolver.getCacheStats();
      lruResolver.resolve(pathA);
      const afterStats = lruResolver.getCacheStats();

      expect(afterStats.hits).toBe(beforeStats.hits + 1);
    });

    test('should count multiple files from same workspace as one cache entry', () => {
      const lruResolver = new WorkspaceResolver(3);

      // Multiple files from the same workspace should result in ONE cache entry
      const file1 = join(simplePackage, 'sources/example.move');
      const file2 = join(simplePackage, 'sources/other.move');
      const file3 = join(simplePackage, 'sources/another.move');

      lruResolver.resolve(file1);
      lruResolver.resolve(file2);
      lruResolver.resolve(file3);

      // All files from same workspace = 1 cache entry, but first is miss, rest are hits
      expect(lruResolver.getCacheStats().size).toBe(1);
      expect(lruResolver.getCacheStats().misses).toBe(1);
      expect(lruResolver.getCacheStats().hits).toBe(2);
    });
  });

  describe('clear', () => {
    test('should reset cache and statistics', () => {
      resolver.resolve(exampleMove);
      resolver.resolve(exampleMove);

      resolver.clear();

      const stats = resolver.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });
});
