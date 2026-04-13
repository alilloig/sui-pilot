/**
 * Unit tests for DocumentStore
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { DocumentStore } from '../../src/document-store.js';

describe('DocumentStore', () => {
  let store: DocumentStore;

  beforeEach(() => {
    store = new DocumentStore();
  });

  describe('didOpen', () => {
    test('should store document on open', () => {
      const uri = 'file:///path/to/file.move';
      const content = 'module test {}';
      const version = 1;

      store.didOpen(uri, content, version);

      const doc = store.get(uri);
      expect(doc).toBeDefined();
      expect(doc!.uri).toBe(uri);
      expect(doc!.content).toBe(content);
      expect(doc!.version).toBe(version);
    });

    test('should store multiple documents', () => {
      store.didOpen('file:///a.move', 'module a {}', 1);
      store.didOpen('file:///b.move', 'module b {}', 1);

      expect(store.size).toBe(2);
      expect(store.get('file:///a.move')).toBeDefined();
      expect(store.get('file:///b.move')).toBeDefined();
    });
  });

  describe('didChange', () => {
    test('should update content and version on change', () => {
      const uri = 'file:///path/to/file.move';
      store.didOpen(uri, 'module test {}', 1);

      store.didChange(uri, 'module test { fun x() {} }', 2);

      const doc = store.get(uri);
      expect(doc!.content).toBe('module test { fun x() {} }');
      expect(doc!.version).toBe(2);
    });

    test('should handle change without prior open', () => {
      const uri = 'file:///new/file.move';
      store.didChange(uri, 'content', 1);

      const doc = store.get(uri);
      expect(doc).toBeDefined();
      expect(doc!.content).toBe('content');
    });
  });

  describe('didClose', () => {
    test('should remove document on close', () => {
      const uri = 'file:///path/to/file.move';
      store.didOpen(uri, 'module test {}', 1);
      expect(store.get(uri)).toBeDefined();

      store.didClose(uri);
      expect(store.get(uri)).toBeUndefined();
    });

    test('should handle close for non-existent document', () => {
      // Should not throw
      expect(() => store.didClose('file:///nonexistent.move')).not.toThrow();
    });
  });

  describe('get', () => {
    test('should return undefined for unknown URI', () => {
      expect(store.get('file:///unknown.move')).toBeUndefined();
    });

    test('should return stored document', () => {
      const uri = 'file:///test.move';
      store.didOpen(uri, 'content', 1);

      const doc = store.get(uri);
      expect(doc).toBeDefined();
      expect(doc!.content).toBe('content');
    });
  });

  describe('clear', () => {
    test('should remove all documents', () => {
      store.didOpen('file:///a.move', 'a', 1);
      store.didOpen('file:///b.move', 'b', 1);
      expect(store.size).toBe(2);

      store.clear();
      expect(store.size).toBe(0);
    });
  });

  describe('getAll', () => {
    test('should return empty array when no documents', () => {
      const docs = store.getAll();
      expect(docs).toEqual([]);
    });

    test('should return all tracked documents', () => {
      store.didOpen('file:///a.move', 'module a {}', 1);
      store.didOpen('file:///b.move', 'module b {}', 2);

      const docs = store.getAll();
      expect(docs).toHaveLength(2);
      expect(docs.map(d => d.uri).sort()).toEqual([
        'file:///a.move',
        'file:///b.move',
      ]);
    });

    test('should return copies, not references', () => {
      store.didOpen('file:///test.move', 'content', 1);

      const docs = store.getAll();
      expect(docs).toHaveLength(1);

      // Modifying returned array should not affect store
      docs.pop();
      expect(store.size).toBe(1);
    });
  });

  describe('getAllForWorkspace', () => {
    test('should return empty array when no matching documents', () => {
      store.didOpen('file:///other/path/a.move', 'module a {}', 1);

      const docs = store.getAllForWorkspace('/workspace');
      expect(docs).toEqual([]);
    });

    test('should return only documents in workspace', () => {
      store.didOpen('file:///workspace/a.move', 'module a {}', 1);
      store.didOpen('file:///workspace/src/b.move', 'module b {}', 2);
      store.didOpen('file:///other/c.move', 'module c {}', 3);

      const docs = store.getAllForWorkspace('/workspace');
      expect(docs).toHaveLength(2);
      expect(docs.map(d => d.uri).sort()).toEqual([
        'file:///workspace/a.move',
        'file:///workspace/src/b.move',
      ]);
    });

    test('should not match partial path prefixes', () => {
      store.didOpen('file:///workspace-other/a.move', 'module a {}', 1);

      const docs = store.getAllForWorkspace('/workspace');
      expect(docs).toEqual([]);
    });
  });

  describe('incrementVersionsForWorkspace', () => {
    test('should increment versions for workspace documents only', () => {
      store.didOpen('file:///workspace/a.move', 'module a {}', 1);
      store.didOpen('file:///workspace/src/b.move', 'module b {}', 2);
      store.didOpen('file:///other/c.move', 'module c {}', 3);

      store.incrementVersionsForWorkspace('/workspace');

      expect(store.get('file:///workspace/a.move')!.version).toBe(2);
      expect(store.get('file:///workspace/src/b.move')!.version).toBe(3);
      expect(store.get('file:///other/c.move')!.version).toBe(3); // Unchanged
    });

    test('should handle empty workspace', () => {
      store.didOpen('file:///other/a.move', 'module a {}', 1);

      // Should not throw
      expect(() => store.incrementVersionsForWorkspace('/workspace')).not.toThrow();

      // Version unchanged
      expect(store.get('file:///other/a.move')!.version).toBe(1);
    });
  });
});
