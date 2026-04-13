/**
 * Workspace resolution with LRU caching
 * Finds the workspace root (directory containing Move.toml) for a given file
 */

import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { NoWorkspaceError } from './errors.js';
import { log } from './logger.js';

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
}

/**
 * LRU cache entry with access order tracking
 */
interface CacheEntry {
  workspaceRoot: string;
  lastAccess: number;
}

/**
 * Workspace resolver with LRU caching
 * Resolves file paths to their Move workspace root (directory containing Move.toml)
 * Caches by workspace root (not file path) per the contract: "max 3 workspace roots"
 */
export class WorkspaceResolver {
  // Cache maps workspace root -> access metadata (LRU cache of workspace roots)
  private cache = new Map<string, CacheEntry>();
  private accessCounter = 0;
  private hits = 0;
  private misses = 0;

  constructor(private readonly maxCacheSize = 3) {}

  /**
   * Resolve a file path to its workspace root
   * Returns the directory containing Move.toml
   * @throws NoWorkspaceError if no Move.toml is found in any parent directory
   */
  resolve(filePath: string): string {
    const resolvedPath = resolve(filePath);

    // First, find the workspace root for this file
    const workspaceRoot = this.findWorkspaceRoot(resolvedPath);

    // Check if this workspace root is already cached
    const cached = this.cache.get(workspaceRoot);
    if (cached) {
      this.hits++;
      cached.lastAccess = ++this.accessCounter;
      log('debug', 'Workspace cache hit', {
        event: 'workspace_cache_hit',
        filePath: resolvedPath,
        workspaceRoot,
      });
      return workspaceRoot;
    }

    // Cache miss - this is a new workspace root
    this.misses++;

    log('debug', 'Workspace cache miss', {
      event: 'workspace_cache_miss',
      filePath: resolvedPath,
      workspaceRoot,
    });

    // Evict LRU entry if cache is full
    if (this.cache.size >= this.maxCacheSize) {
      this.evictLRU();
    }

    // Store workspace root in cache (keyed by workspace root, not file path)
    this.cache.set(workspaceRoot, {
      workspaceRoot,
      lastAccess: ++this.accessCounter,
    });

    return workspaceRoot;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
    };
  }

  /**
   * Clear the cache and reset statistics
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.accessCounter = 0;
  }

  /**
   * Find workspace root by traversing parent directories
   */
  private findWorkspaceRoot(filePath: string): string {
    let currentDir = dirname(filePath);

    while (currentDir !== '/' && currentDir !== '.') {
      const moveTomlPath = resolve(currentDir, 'Move.toml');
      if (existsSync(moveTomlPath)) {
        return currentDir;
      }
      const parentDir = dirname(currentDir);
      if (parentDir === currentDir) break; // Reached filesystem root
      currentDir = parentDir;
    }

    throw new NoWorkspaceError(filePath);
  }

  /**
   * Evict the least recently used cache entry
   */
  private evictLRU(): void {
    let lruKey: string | null = null;
    let lruAccess = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccess < lruAccess) {
        lruAccess = entry.lastAccess;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey);
    }
  }
}
