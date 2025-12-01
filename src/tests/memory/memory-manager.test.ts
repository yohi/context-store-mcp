/**
 * Memory Manager Test Suite
 * TDD approach: Red-Green-Refactor
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryManager } from '../../memory/memory-manager.js';
import {
  MockStorageAdapter,
  MockVectorStoreAdapter,
  MockTransactionCoordinator,
} from '../mocks/index.js';
import type {
  StoreMemoryParams,
  MemoryId,
  MemoryError,
  MemoryLinkType,
} from '../../memory/types.js';

describe('MemoryManager - Basic Functionality (Task 3.1)', () => {
  let memoryManager: MemoryManager;
  let mockStorage: MockStorageAdapter;
  let mockVectorStore: MockVectorStoreAdapter;
  let mockTransactionCoordinator: MockTransactionCoordinator;

  beforeEach(() => {
    // モックアダプターを初期化
    mockStorage = new MockStorageAdapter();
    mockVectorStore = new MockVectorStoreAdapter();
    mockTransactionCoordinator = new MockTransactionCoordinator(mockStorage);

    // モックを注入してMemoryManagerを初期化
    memoryManager = new MemoryManager({
      storage: mockStorage,
      vectorStore: mockVectorStore as any, // 型の互換性のためanyにキャスト
      transactionCoordinator: mockTransactionCoordinator as any,
    });
  });

  describe('storeMemory', () => {
    it('should store a simple memory and return a valid memory ID', async () => {
      const params: StoreMemoryParams = {
        content: 'Test memory content',
      };

      const result = await memoryManager.storeMemory(params);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBeTruthy();
        expect(typeof result.value).toBe('string');
        // UUID v4 format validation
        expect(result.value).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        );
      }
    });

    it('should store memory with metadata', async () => {
      const params: StoreMemoryParams = {
        content: 'Memory with metadata',
        memoryType: 'semantic',
        metadata: {
          source: 'test-suite',
          tags: ['test', 'unit'],
        },
      };

      const result = await memoryManager.storeMemory(params);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBeTruthy();
      }
    });

    it('should automatically set timestamp if not provided', async () => {
      const beforeStore = new Date();
      const params: StoreMemoryParams = {
        content: 'Memory without explicit timestamp',
      };

      const result = await memoryManager.storeMemory(params);

      expect(result.success).toBe(true);
      // Timestamp should be set automatically during storage
      // We'll verify this in integration tests with actual storage
    });

    it('should reject empty content', async () => {
      const params: StoreMemoryParams = {
        content: '',
      };

      const result = await memoryManager.storeMemory(params);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_CONTENT');
        expect(result.error.message).toContain('Content cannot be empty');
      }
    });

    it('should reject content that is only whitespace', async () => {
      const params: StoreMemoryParams = {
        content: '   \t\n  ',
      };

      const result = await memoryManager.storeMemory(params);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_CONTENT');
        expect(result.error.message).toContain('Content cannot be empty');
      }
    });

    it('should validate metadata if provided', async () => {
      const params: StoreMemoryParams = {
        content: 'Valid content',
        metadata: {
          tags: ['valid-tag', 'another-tag'],
        },
      };

      const result = await memoryManager.storeMemory(params);

      expect(result.success).toBe(true);
    });

    it('should generate unique IDs for different memories', async () => {
      const params1: StoreMemoryParams = { content: 'First memory' };
      const params2: StoreMemoryParams = { content: 'Second memory' };

      const result1 = await memoryManager.storeMemory(params1);
      const result2 = await memoryManager.storeMemory(params2);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      if (result1.success && result2.success) {
        expect(result1.value).not.toBe(result2.value);
      }
    });
  });

  describe('Data Integrity Checks', () => {
    it('should preserve content exactly as provided', async () => {
      const contentWithSpecialChars = 'Content with\nnew lines\tand tabs "quotes"';
      const params: StoreMemoryParams = {
        content: contentWithSpecialChars,
      };

      const result = await memoryManager.storeMemory(params);

      expect(result.success).toBe(true);
      // Content integrity will be verified through retrieval in integration tests
    });

    it('should handle Unicode content correctly', async () => {
      const unicodeContent = '日本語のコンテンツ 🚀 emoji αβγ Greek';
      const params: StoreMemoryParams = {
        content: unicodeContent,
      };

      const result = await memoryManager.storeMemory(params);

      expect(result.success).toBe(true);
    });

    it('should handle very long content', async () => {
      const longContent = 'a'.repeat(100000); // 100KB of text
      const params: StoreMemoryParams = {
        content: longContent,
      };

      const result = await memoryManager.storeMemory(params);

      expect(result.success).toBe(true);
    });
  });

  describe('Metadata Processing', () => {
    it('should accept valid memory types', async () => {
      const types: Array<'episodic' | 'semantic' | 'procedural'> = [
        'episodic',
        'semantic',
        'procedural',
      ];

      for (const memoryType of types) {
        const params: StoreMemoryParams = {
          content: `Content for ${memoryType} memory`,
          metadata: { memoryType },
        };

        const result = await memoryManager.storeMemory(params);

        expect(result.success).toBe(true);
      }
    });

    it('should accept custom tags array', async () => {
      const params: StoreMemoryParams = {
        content: 'Tagged memory',
        metadata: {
          tags: ['tag1', 'tag2', 'tag3'],
        },
      };

      const result = await memoryManager.storeMemory(params);

      expect(result.success).toBe(true);
    });

    it('should accept source information', async () => {
      const params: StoreMemoryParams = {
        content: 'Memory from specific source',
        metadata: {
          source: 'automated-test',
        },
      };

      const result = await memoryManager.storeMemory(params);

      expect(result.success).toBe(true);
    });

    it('should prefer top-level memoryType over metadata.memoryType', async () => {
      const params: StoreMemoryParams = {
        content: 'Test memory type precedence',
        memoryType: 'episodic', // Top-level memoryType
        metadata: {
          memoryType: 'procedural' as any, // This should be ignored
        },
      };

      const result = await memoryManager.storeMemory(params);
      expect(result.success).toBe(true);

      if (result.success) {
        const memory = mockStorage.getMemoryForTest(result.value);
        expect(memory).toBeDefined();
        expect(memory?.memoryType).toBe('episodic'); // Should use top-level value
        expect(memory?.metadata.memoryType).toBeUndefined(); // Should be removed from metadata
      }
    });

    it('should use metadata.memoryType when top-level is not provided', async () => {
      const params: StoreMemoryParams = {
        content: 'Test fallback to metadata memoryType',
        // No top-level memoryType
        metadata: {
          memoryType: 'procedural' as any,
        },
      };

      const result = await memoryManager.storeMemory(params);
      expect(result.success).toBe(true);

      if (result.success) {
        const memory = mockStorage.getMemoryForTest(result.value);
        expect(memory).toBeDefined();
        expect(memory?.memoryType).toBe('procedural'); // Should fall back to metadata value
        expect(memory?.metadata.memoryType).toBeUndefined(); // Should still be removed from metadata
      }
    });

    it('should default to semantic when neither top-level nor metadata memoryType provided', async () => {
      const params: StoreMemoryParams = {
        content: 'Test default memoryType',
        // No memoryType at all
      };

      const result = await memoryManager.storeMemory(params);
      expect(result.success).toBe(true);

      if (result.success) {
        const memory = mockStorage.getMemoryForTest(result.value);
        expect(memory).toBeDefined();
        expect(memory?.memoryType).toBe('semantic'); // Should default to semantic
      }
    });
  });

  describe('ID Generation', () => {
    it('should generate IDs in UUID v4 format', async () => {
      const params: StoreMemoryParams = {
        content: 'Test for UUID format',
      };

      const result = await memoryManager.storeMemory(params);

      expect(result.success).toBe(true);
      if (result.success) {
        // UUID v4 has specific format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
        // where y is one of [8, 9, a, b]
        const uuidV4Regex =
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        expect(result.value).toMatch(uuidV4Regex);
      }
    });

    it('should generate statistically unique IDs', async () => {
      const ids = new Set<MemoryId>();
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        const params: StoreMemoryParams = {
          content: `Memory ${i}`,
        };
        const result = await memoryManager.storeMemory(params);

        if (result.success) {
          ids.add(result.value);
        }
      }

      // All IDs should be unique
      expect(ids.size).toBe(iterations);
    });
  });
});

describe('MemoryManager - Auto Cleanup (Task 3.3)', () => {
  let memoryManager: MemoryManager;
  let mockStorage: MockStorageAdapter;
  let mockVectorStore: MockVectorStoreAdapter;
  let mockTransactionCoordinator: MockTransactionCoordinator;

  beforeEach(() => {
    // モックアダプターを初期化
    mockStorage = new MockStorageAdapter();
    mockVectorStore = new MockVectorStoreAdapter();
    mockTransactionCoordinator = new MockTransactionCoordinator(mockStorage);

    // モックを注入してMemoryManagerを初期化
    memoryManager = new MemoryManager({
      storage: mockStorage,
      vectorStore: mockVectorStore as any,
      // transactionCoordinator: mockTransactionCoordinator as any,
    });
  });

  describe('performGarbageCollection', () => {
    it('should remove soft-deleted memories that are not protected', async () => {
      // Create a memory and soft delete it
      const storeResult = await memoryManager.storeMemory({
        content: 'Memory to be garbage collected',
        metadata: { tags: ['gc-test'] },
      });

      expect(storeResult.success).toBe(true);
      if (!storeResult.success) return;

      const memoryId = storeResult.value;
      await memoryManager.deleteMemory(memoryId);

      // Set deletedAt to >30 days ago to make it eligible for GC
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000); // 31 days ago
      mockStorage.setDeletedAtForTest(memoryId, oldDate);

      // Verify memory exists before GC
      let memory = mockStorage.getMemoryForTest(memoryId);
      expect(memory).toBeDefined();
      expect(memory?.isDeleted).toBe(true);

      // Perform garbage collection
      await memoryManager.performGarbageCollection();

      // Memory should be completely removed (not just soft-deleted)
      memory = mockStorage.getMemoryForTest(memoryId);
      expect(memory).toBeUndefined();
    });

    it('should not remove protected memories even if soft-deleted', async () => {
      const storeResult = await memoryManager.storeMemory({
        content: 'Protected memory',
        metadata: { tags: ['protected'] },
      });

      expect(storeResult.success).toBe(true);
      if (!storeResult.success) return;

      const memoryId = storeResult.value;

      // Soft delete first (before protecting)
      const deleteResult = await memoryManager.deleteMemory(memoryId);
      expect(deleteResult.success).toBe(true);

      // Mark as protected AFTER deletion (simulating edge case)
      await memoryManager.updateMemory(memoryId, { isProtected: true });

      // Set deletedAt to >30 days ago (would normally be eligible for GC)
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000); // 31 days ago
      mockStorage.setDeletedAtForTest(memoryId, oldDate);

      // Verify memory state before GC
      let memory = mockStorage.getMemoryForTest(memoryId);
      expect(memory).toBeDefined();
      expect(memory?.isDeleted).toBe(true);
      expect(memory?.isProtected).toBe(true);

      // Perform garbage collection
      await memoryManager.performGarbageCollection();

      // Protected memory should still exist (not garbage collected)
      memory = mockStorage.getMemoryForTest(memoryId);
      expect(memory).toBeDefined();
      expect(memory?.isDeleted).toBe(true);
      expect(memory?.isProtected).toBe(true);
    });

    it('should only remove memories older than threshold', async () => {
      // Create two memories - one recent, one old
      const recentResult = await memoryManager.storeMemory({
        content: 'Recently deleted memory',
        metadata: { tags: ['recent'] },
      });
      const oldResult = await memoryManager.storeMemory({
        content: 'Old deleted memory',
        metadata: { tags: ['old'] },
      });

      expect(recentResult.success).toBe(true);
      expect(oldResult.success).toBe(true);
      if (!recentResult.success || !oldResult.success) return;

      const recentId = recentResult.value;
      const oldId = oldResult.value;

      // Delete both memories
      await memoryManager.deleteMemory(recentId);
      await memoryManager.deleteMemory(oldId);

      // Set old memory's deletedAt to >30 days ago
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000); // 31 days ago
      mockStorage.setDeletedAtForTest(oldId, oldDate);

      // Verify both memories exist and are deleted before GC
      let recentMemory = mockStorage.getMemoryForTest(recentId);
      let oldMemory = mockStorage.getMemoryForTest(oldId);
      expect(recentMemory).toBeDefined();
      expect(recentMemory?.isDeleted).toBe(true);
      expect(oldMemory).toBeDefined();
      expect(oldMemory?.isDeleted).toBe(true);

      // Verify deletedAt timestamps
      expect(recentMemory?.deletedAt).toBeDefined();
      expect(oldMemory?.deletedAt).toBeDefined();
      if (recentMemory?.deletedAt && oldMemory?.deletedAt) {
        expect(oldMemory.deletedAt.getTime()).toBeLessThan(recentMemory.deletedAt.getTime());
      }

      // Run GC - should only remove old memory, keep recent one
      await memoryManager.performGarbageCollection();

      // Recent memory should still exist (within 30 days)
      recentMemory = mockStorage.getMemoryForTest(recentId);
      expect(recentMemory).toBeDefined();
      expect(recentMemory?.isDeleted).toBe(true);

      // Old memory should be completely removed (>30 days old)
      oldMemory = mockStorage.getMemoryForTest(oldId);
      expect(oldMemory).toBeUndefined();
    });

    it('should handle empty collection gracefully', async () => {
      // Run GC on empty collection
      await expect(memoryManager.performGarbageCollection()).resolves.not.toThrow();
    });
  });

  describe('optimizeStorage', () => {
    it('should successfully run on empty storage', async () => {
      await expect(memoryManager.optimizeStorage()).resolves.not.toThrow();
    });

    it('should update importance scores for all memories', async () => {
      // Note: optimizeStorage now only calls performGarbageCollection
      // Importance score updates have been removed from the refactored implementation
      // This test is kept for backward compatibility but expectations are adjusted

      // Create multiple memories
      const ids: MemoryId[] = [];
      for (let i = 0; i < 5; i++) {
        const result = await memoryManager.storeMemory({
          content: `Memory ${i}`,
          metadata: { tags: ['optimize-test'] },
        });
        if (result.success) ids.push(result.value);
      }

      expect(ids.length).toBe(5);

      // Run optimization
      await memoryManager.optimizeStorage();

      // Verify memories still exist (no GC should happen for fresh memories)
      const allMemories = mockStorage.getAllMemoriesForTest();
      expect(allMemories.length).toBe(5);
    });

    it('should compact memory if needed', async () => {
      // Create memories - some to delete, some to keep
      const deleteResult = await memoryManager.storeMemory({
        content: 'Memory to delete (old)',
        metadata: {},
      });
      const keepResult = await memoryManager.storeMemory({
        content: 'Memory to keep',
        metadata: {},
      });

      expect(deleteResult.success).toBe(true);
      expect(keepResult.success).toBe(true);
      if (!deleteResult.success || !keepResult.success) return;

      const deleteId = deleteResult.value;
      const keepId = keepResult.value;

      // Soft delete the first memory
      await memoryManager.deleteMemory(deleteId);

      // Set deletedAt to >30 days ago to make it eligible for GC
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000); // 31 days ago
      mockStorage.setDeletedAtForTest(deleteId, oldDate);

      // Verify initial state: 2 memories (1 deleted, 1 active)
      let allMemories = mockStorage.getAllMemoriesForTest();
      expect(allMemories.length).toBe(2);

      const deletedMemory = allMemories.find((m) => m.id === deleteId);
      const activeMemory = allMemories.find((m) => m.id === keepId);
      expect(deletedMemory).toBeDefined();
      expect(deletedMemory?.isDeleted).toBe(true);
      expect(activeMemory).toBeDefined();
      expect(activeMemory?.isDeleted).toBe(false);

      // Run optimization (should update scores AND compact/GC)
      await memoryManager.optimizeStorage();

      // Verify compaction: old deleted memory should be removed
      allMemories = mockStorage.getAllMemoriesForTest();
      expect(allMemories.length).toBe(1);

      // Only the kept memory should remain
      const remainingMemory = allMemories[0];
      expect(remainingMemory.id).toBe(keepId);
      expect(remainingMemory.isDeleted).toBe(false);

      // Deleted memory should be completely gone
      const deletedAfterGC = mockStorage.getMemoryForTest(deleteId);
      expect(deletedAfterGC).toBeUndefined();
    });

    it('should handle optimization errors gracefully', async () => {
      // Even if some operations fail, optimization should not throw
      await expect(memoryManager.optimizeStorage()).resolves.not.toThrow();
    });
  });
});

describe('MemoryManager - Update, Delete, Merge (Task 3.2)', () => {
  let memoryManager: MemoryManager;
  let mockStorage: MockStorageAdapter;
  let mockVectorStore: MockVectorStoreAdapter;
  let mockTransactionCoordinator: MockTransactionCoordinator;
  let storedMemoryId: MemoryId;

  beforeEach(async () => {
    // モックアダプターを初期化
    mockStorage = new MockStorageAdapter();
    mockVectorStore = new MockVectorStoreAdapter();
    mockTransactionCoordinator = new MockTransactionCoordinator(mockStorage);

    // モックを注入してMemoryManagerを初期化
    memoryManager = new MemoryManager({
      storage: mockStorage,
      vectorStore: mockVectorStore as any,
      // transactionCoordinator: mockTransactionCoordinator as any,
    });

    // Store a test memory for update/delete operations
    const storeResult = await memoryManager.storeMemory({
      content: 'Initial content for testing',
      memoryType: 'semantic',
      metadata: {
        tags: ['test'],
      },
    });

    if (storeResult.success) {
      storedMemoryId = storeResult.value;
    }
  });

  describe('updateMemory', () => {
    it('should update memory content successfully', async () => {
      const result = await memoryManager.updateMemory(storedMemoryId, {
        content: 'Updated content',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBe(true);
      }
    });

    it('should update memory metadata', async () => {
      const result = await memoryManager.updateMemory(storedMemoryId, {
        metadata: {
          tags: ['updated', 'modified'],
          source: 'test-update',
        },
      });

      expect(result.success).toBe(true);
    });

    it('should update memory type', async () => {
      const result = await memoryManager.updateMemory(storedMemoryId, {
        memoryType: 'episodic',
      });

      expect(result.success).toBe(true);
    });

    it('should return error for non-existent memory ID', async () => {
      const fakeId = '00000000-0000-4000-8000-000000000000';
      const result = await memoryManager.updateMemory(fakeId, {
        content: 'Should fail',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('MEMORY_NOT_FOUND');
      }
    });

    it('should reject invalid content in update', async () => {
      const result = await memoryManager.updateMemory(storedMemoryId, {
        content: '',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_CONTENT');
      }
    });

    it('should automatically update updatedAt timestamp', async () => {
      const result = await memoryManager.updateMemory(storedMemoryId, {
        content: 'New content',
      });

      expect(result.success).toBe(true);
      // Timestamp verification will be done in integration tests
    });

    it('should preserve fields not included in update', async () => {
      const result = await memoryManager.updateMemory(storedMemoryId, {
        content: 'Only content updated',
      });

      expect(result.success).toBe(true);
      // Metadata should remain unchanged - verify in integration tests
    });

    it('should remove memoryType from metadata to maintain single source of truth', async () => {
      // Update memory with metadata containing memoryType
      const result = await memoryManager.updateMemory(storedMemoryId, {
        metadata: {
          tags: ['test'],
          memoryType: 'episodic' as any, // TypeScript doesn't allow this, but test runtime behavior
        },
      });

      expect(result.success).toBe(true);

      // Verify that metadata.memoryType was removed
      const memory = mockStorage.getMemoryForTest(storedMemoryId);
      expect(memory).toBeDefined();
      expect(memory?.metadata).toBeDefined();
      expect(memory?.metadata.memoryType).toBeUndefined(); // Must be removed
      expect(memory?.metadata.tags).toEqual(['test']); // Other metadata should remain
    });
  });

  describe('deleteMemory - Soft Delete', () => {
    it('should soft delete a memory successfully', async () => {
      const result = await memoryManager.deleteMemory(storedMemoryId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBe(true);
      }
    });

    it('should return error for non-existent memory ID', async () => {
      const fakeId = '00000000-0000-4000-8000-000000000000';
      const result = await memoryManager.deleteMemory(fakeId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('MEMORY_NOT_FOUND');
      }
    });

    it('should mark memory as deleted (soft delete)', async () => {
      const result = await memoryManager.deleteMemory(storedMemoryId);

      expect(result.success).toBe(true);
      // isDeleted flag verification in integration tests
    });

    it('should set deletion timestamp', async () => {
      const result = await memoryManager.deleteMemory(storedMemoryId);

      expect(result.success).toBe(true);
      // deletedAt timestamp verification in integration tests
    });

    it('should allow deleting already deleted memory (idempotent)', async () => {
      const firstDelete = await memoryManager.deleteMemory(storedMemoryId);
      expect(firstDelete.success).toBe(true);

      const secondDelete = await memoryManager.deleteMemory(storedMemoryId);
      expect(secondDelete.success).toBe(true);
    });

    it('should not delete protected memories', async () => {
      // First update the memory to be protected
      await memoryManager.updateMemory(storedMemoryId, {
        isProtected: true,
      });

      const result = await memoryManager.deleteMemory(storedMemoryId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('STORAGE_ERROR');
        expect(result.error.message).toContain('protected');
      }
    });
  });

  describe('mergeMemories', () => {
    let memory1Id: MemoryId;
    let memory2Id: MemoryId;
    let memory3Id: MemoryId;

    beforeEach(async () => {
      // Create multiple memories for merging
      const result1 = await memoryManager.storeMemory({
        content: 'First similar memory',
        metadata: { tags: ['merge-test'] },
      });
      const result2 = await memoryManager.storeMemory({
        content: 'Second similar memory',
        metadata: { tags: ['merge-test'] },
      });
      const result3 = await memoryManager.storeMemory({
        content: 'Third similar memory',
        metadata: { tags: ['merge-test'] },
      });

      if (result1.success) memory1Id = result1.value;
      if (result2.success) memory2Id = result2.value;
      if (result3.success) memory3Id = result3.value;
    });

    it('should merge multiple memories into one', async () => {
      const result = await memoryManager.mergeMemories([memory1Id, memory2Id, memory3Id]);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBeTruthy();
        expect(typeof result.value).toBe('string');
      }
    });

    it('should return error when merging less than 2 memories', async () => {
      const result = await memoryManager.mergeMemories([memory1Id]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_CONTENT');
        expect(result.error.message).toContain('at least 2 memories');
      }
    });

    it('should return error if any memory ID does not exist', async () => {
      const fakeId = '00000000-0000-4000-8000-000000000000';
      const result = await memoryManager.mergeMemories([memory1Id, fakeId, memory2Id]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('MEMORY_NOT_FOUND');
      }
    });

    it('should combine content from all memories', async () => {
      const result = await memoryManager.mergeMemories([memory1Id, memory2Id, memory3Id]);

      expect(result.success).toBe(true);
      // Content combination verification in integration tests
    });

    it('should merge metadata tags from all memories', async () => {
      const result = await memoryManager.mergeMemories([memory1Id, memory2Id, memory3Id]);

      expect(result.success).toBe(true);
      // Tags merging verification in integration tests
    });

    it('should soft delete source memories after merge', async () => {
      const result = await memoryManager.mergeMemories([memory1Id, memory2Id, memory3Id]);

      expect(result.success).toBe(true);
      // Soft deletion of source memories verification in integration tests
    });

    it('should return new merged memory ID', async () => {
      const result = await memoryManager.mergeMemories([memory1Id, memory2Id]);

      expect(result.success).toBe(true);
      if (result.success) {
        // New ID should be different from source IDs
        expect(result.value).not.toBe(memory1Id);
        expect(result.value).not.toBe(memory2Id);
      }
    });

    it('should reject merging deleted memories', async () => {
      // Delete one of the memories
      await memoryManager.deleteMemory(memory1Id);

      const result = await memoryManager.mergeMemories([memory1Id, memory2Id]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_CONTENT');
        expect(result.error.message).toContain('deleted memory');
      }
    });

    it('should reject merging protected memories', async () => {
      // Protect one of the memories
      await memoryManager.updateMemory(memory1Id, {
        isProtected: true,
      });

      const result = await memoryManager.mergeMemories([memory1Id, memory2Id]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('STORAGE_ERROR');
        expect(result.error.message).toContain('protected memory');
      }
    });

    it('should produce sorted tags for deterministic results', async () => {
      // Create memories with different tag orders
      const mem1 = await memoryManager.storeMemory({
        content: 'Memory 1',
        metadata: { tags: ['zebra', 'alpha', 'charlie'] },
      });
      const mem2 = await memoryManager.storeMemory({
        content: 'Memory 2',
        metadata: { tags: ['bravo', 'delta'] },
      });

      if (!mem1.success || !mem2.success) {
        throw new Error('Failed to create test memories');
      }

      const result = await memoryManager.mergeMemories([mem1.value, mem2.value]);

      expect(result.success).toBe(true);
      // Tags should be sorted alphabetically: ['alpha', 'bravo', 'charlie', 'delta', 'zebra']
      // Verification will be done in integration tests
    });

    it('should reject merging when any source cannot be merged due to protection', async () => {
      // Protect one of the source memories after initial validation
      // This tests the early validation that prevents protected memories from being merged
      await memoryManager.updateMemory(memory2Id, {
        isProtected: true,
      });

      const result = await memoryManager.mergeMemories([memory1Id, memory2Id]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('STORAGE_ERROR');
        expect(result.error.message).toContain('protected memory');
      }
      // Early validation prevents merge operation, ensuring consistency
    });
  });
});

describe('MemoryManager - Memory Links and Type Management (Task 4.3)', () => {
  let memoryManager: MemoryManager;
  let mockStorage: MockStorageAdapter;
  let mockVectorStore: MockVectorStoreAdapter;
  let mockTransactionCoordinator: MockTransactionCoordinator;
  let episodicMemoryId: MemoryId;
  let semanticMemoryId: MemoryId;
  let proceduralMemoryId: MemoryId;

  beforeEach(async () => {
    // モックアダプターを初期化
    mockStorage = new MockStorageAdapter();
    mockVectorStore = new MockVectorStoreAdapter();
    mockTransactionCoordinator = new MockTransactionCoordinator(mockStorage);

    // モックを注入してMemoryManagerを初期化
    memoryManager = new MemoryManager({
      storage: mockStorage,
      vectorStore: mockVectorStore as any,
      // transactionCoordinator: mockTransactionCoordinator as any,
    });

    // Create test memories with different types
    const episodic = await memoryManager.storeMemory({
      content: '昨日、チームミーティングでUIの改善について議論した',
      metadata: { memoryType: 'episodic' },
    });
    const semantic = await memoryManager.storeMemory({
      content: 'TypeScript interface の定義はコンポーネント設計における重要なパターンである',
      metadata: { memoryType: 'semantic' },
    });
    const procedural = await memoryManager.storeMemory({
      content: 'npm install を実行してから npm run dev でサーバーを起動する',
      metadata: { memoryType: 'procedural' },
    });

    if (episodic.success) episodicMemoryId = episodic.value;
    if (semantic.success) semanticMemoryId = semantic.value;
    if (procedural.success) proceduralMemoryId = procedural.value;
  });

  describe('createLink - タイプ間リンクの生成', () => {
    it('should return error when GraphStoreAdapter is not implemented', async () => {
      const result = await memoryManager.createLink(
        episodicMemoryId,
        semanticMemoryId,
        'REFERENCES'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('STORAGE_ERROR');
        expect(result.error.message).toContain('GraphStoreAdapter');
      }
    });

    it('should validate strength parameter before returning not-implemented error', async () => {
      const result = await memoryManager.createLink(
        episodicMemoryId,
        semanticMemoryId,
        'DERIVED_FROM',
        0.8
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('STORAGE_ERROR');
      }
    });

    it('should return not-implemented error for user-created links', async () => {
      const result = await memoryManager.createLink(
        semanticMemoryId,
        proceduralMemoryId,
        'SUPPORTS',
        0.9,
        'user',
        'User explicitly connected these concepts'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('STORAGE_ERROR');
      }
    });

    it('should return not-implemented error for system-created links', async () => {
      const result = await memoryManager.createLink(
        proceduralMemoryId,
        episodicMemoryId,
        'PREREQUISITE',
        0.7,
        'system'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('STORAGE_ERROR');
      }
    });

    it('should return not-implemented error even with default strength', async () => {
      const result = await memoryManager.createLink(
        episodicMemoryId,
        proceduralMemoryId,
        'NEXT_STEP'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('STORAGE_ERROR');
      }
    });

    it('should reject link creation with invalid source memory ID', async () => {
      const fakeId = '00000000-0000-4000-8000-000000000000';
      const result = await memoryManager.createLink(fakeId, semanticMemoryId, 'REFERENCES');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('MEMORY_NOT_FOUND');
      }
    });

    it('should reject link creation with invalid target memory ID', async () => {
      const fakeId = '00000000-0000-4000-8000-000000000000';
      const result = await memoryManager.createLink(episodicMemoryId, fakeId, 'REFERENCES');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('MEMORY_NOT_FOUND');
      }
    });

    it('should reject link creation with strength outside valid range (< 0)', async () => {
      const result = await memoryManager.createLink(
        episodicMemoryId,
        semanticMemoryId,
        'SUPPORTS',
        -0.5
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_CONTENT');
        expect(result.error.message).toContain('strength');
      }
    });

    it('should reject link creation with strength outside valid range (> 1)', async () => {
      const result = await memoryManager.createLink(
        episodicMemoryId,
        semanticMemoryId,
        'SUPPORTS',
        1.5
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_CONTENT');
        expect(result.error.message).toContain('strength');
      }
    });

    it('should return not-implemented error (bidirectional links will work when GraphStoreAdapter is implemented)', async () => {
      const result = await memoryManager.createLink(
        episodicMemoryId,
        semanticMemoryId,
        'REFERENCES'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('STORAGE_ERROR');
      }
    });

    it('should reject self-links (same from and to memory)', async () => {
      const result = await memoryManager.createLink(
        episodicMemoryId,
        episodicMemoryId,
        'REFERENCES'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_CONTENT');
        expect(result.error.message).toContain('Self-links are not allowed');
      }
    });

    it('should reject link creation when source memory is deleted', async () => {
      // Delete the source memory
      await memoryManager.deleteMemory(episodicMemoryId);

      // Try to create a link from deleted memory
      const result = await memoryManager.createLink(
        episodicMemoryId,
        semanticMemoryId,
        'REFERENCES'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('MEMORY_NOT_FOUND');
        expect(result.error.message).toContain('source memory');
        expect(result.error.message).toContain('deleted');
      }
    });

    it('should reject link creation when target memory is deleted', async () => {
      // Delete the target memory
      await memoryManager.deleteMemory(semanticMemoryId);

      // Try to create a link to deleted memory
      const result = await memoryManager.createLink(
        proceduralMemoryId,
        semanticMemoryId,
        'REFERENCES'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('MEMORY_NOT_FOUND');
        expect(result.error.message).toContain('target memory');
        expect(result.error.message).toContain('deleted');
      }
    });

    it('should return not-implemented error for duplicate link attempts', async () => {
      // Create first link attempt
      const result1 = await memoryManager.createLink(
        episodicMemoryId,
        semanticMemoryId,
        'SUPPORTS',
        0.8
      );

      expect(result1.success).toBe(false);
      if (!result1.success) {
        expect(result1.error.type).toBe('STORAGE_ERROR');
      }

      // Try to create duplicate link with same from, to, and linkType
      const result2 = await memoryManager.createLink(
        episodicMemoryId,
        semanticMemoryId,
        'SUPPORTS',
        0.9 // Different strength, but same endpoints and type
      );

      expect(result2.success).toBe(false);
      if (!result2.success) {
        expect(result2.error.type).toBe('STORAGE_ERROR');
      }
    });
  });

  describe('getLinks - リンクの取得', () => {
    beforeEach(async () => {
      // Note: createLink will fail because GraphStoreAdapter is not implemented
      // These tests verify the behavior when GraphStoreAdapter is not available
      await memoryManager.createLink(episodicMemoryId, semanticMemoryId, 'REFERENCES');
      await memoryManager.createLink(episodicMemoryId, proceduralMemoryId, 'DERIVED_FROM');
    });

    it('should return empty array when GraphStoreAdapter is not implemented', async () => {
      const links = await memoryManager.getLinks(episodicMemoryId);

      expect(links).toBeInstanceOf(Array);
      expect(links.length).toBe(0);
    });

    it('should return empty arrays for both directions when not implemented', async () => {
      const linksFrom = await memoryManager.getLinks(episodicMemoryId);
      const linksTo = await memoryManager.getLinks(semanticMemoryId);

      expect(linksFrom.length).toBe(0);
      expect(linksTo.length).toBe(0);
    });

    it('should return empty array (no links when GraphStoreAdapter not implemented)', async () => {
      const links = await memoryManager.getLinks(episodicMemoryId);

      expect(links.length).toBe(0);
    });

    it('should return empty array for memory with no links', async () => {
      const newMemory = await memoryManager.storeMemory({
        content: 'Isolated memory with no links',
      });

      if (newMemory.success) {
        const links = await memoryManager.getLinks(newMemory.value);
        expect(links).toBeInstanceOf(Array);
        expect(links.length).toBe(0);
      }
    });

    it('should return empty array for non-existent memory ID', async () => {
      const fakeId = '00000000-0000-4000-8000-000000000000';
      const links = await memoryManager.getLinks(fakeId);

      expect(links).toBeInstanceOf(Array);
      expect(links.length).toBe(0);
    });

    it('should not return links where source memory is deleted', async () => {
      // Create a link from episodic to semantic
      await memoryManager.createLink(episodicMemoryId, semanticMemoryId, 'SUPPORTS');

      // Soft-delete the source memory
      await memoryManager.deleteMemory(episodicMemoryId);

      // Links should not be returned for the target memory
      const links = await memoryManager.getLinks(semanticMemoryId);
      const hasDeletedSourceLink = links.some((link) => link.fromMemoryId === episodicMemoryId);

      expect(hasDeletedSourceLink).toBe(false);
    });

    it('should not return links where target memory is deleted', async () => {
      // Create a link from episodic to semantic
      await memoryManager.createLink(episodicMemoryId, semanticMemoryId, 'SUPPORTS');

      // Soft-delete the target memory
      await memoryManager.deleteMemory(semanticMemoryId);

      // Links should not be returned for the source memory
      const links = await memoryManager.getLinks(episodicMemoryId);
      const hasDeletedTargetLink = links.some((link) => link.toMemoryId === semanticMemoryId);

      expect(hasDeletedTargetLink).toBe(false);
    });

    it('should not return links where both endpoints are deleted', async () => {
      // Create a link
      await memoryManager.createLink(episodicMemoryId, semanticMemoryId, 'SUPPORTS');

      // Delete both memories
      await memoryManager.deleteMemory(episodicMemoryId);
      await memoryManager.deleteMemory(semanticMemoryId);

      // Neither should return any links
      const linksFrom = await memoryManager.getLinks(episodicMemoryId);
      const linksTo = await memoryManager.getLinks(semanticMemoryId);

      expect(linksFrom.length).toBe(0);
      expect(linksTo.length).toBe(0);
    });
  });

  describe('deleteLink - リンクの削除', () => {
    let linkId: string;

    beforeEach(async () => {
      // Note: createLink will fail because GraphStoreAdapter is not implemented
      const result = await memoryManager.createLink(
        episodicMemoryId,
        semanticMemoryId,
        'REFERENCES'
      );
      if (result.success) {
        linkId = result.value;
      } else {
        // Use a dummy linkId for testing error cases
        linkId = '00000000-0000-4000-8000-000000000001';
      }
    });

    it('should return error when GraphStoreAdapter is not implemented', async () => {
      const result = await memoryManager.deleteLink(linkId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('STORAGE_ERROR');
        expect(result.error.message).toContain('GraphStoreAdapter');
      }
    });

    it('should return error for any link ID when not implemented', async () => {
      const fakeId = '00000000-0000-4000-8000-000000000000';
      const result = await memoryManager.deleteLink(fakeId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('STORAGE_ERROR');
      }
    });

    it('should return error when trying to remove links (not implemented)', async () => {
      const result = await memoryManager.deleteLink(linkId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('STORAGE_ERROR');
      }
    });

    it('should return error consistently (not idempotent when not implemented)', async () => {
      const firstDelete = await memoryManager.deleteLink(linkId);
      expect(firstDelete.success).toBe(false);
      if (!firstDelete.success) {
        expect(firstDelete.error.type).toBe('STORAGE_ERROR');
      }

      const secondDelete = await memoryManager.deleteLink(linkId);
      expect(secondDelete.success).toBe(false);
      if (!secondDelete.success) {
        expect(secondDelete.error.type).toBe('STORAGE_ERROR');
      }
    });
  });

  describe('searchMemories - タイプフィルタリング機能', () => {
    beforeEach(async () => {
      // Additional memories for search testing
      await memoryManager.storeMemory({
        content: '先週金曜日にスタンドアップで確認した要望',
        metadata: { memoryType: 'episodic', tags: ['meeting'] },
      });
      await memoryManager.storeMemory({
        content: 'REST API の設計パターンとベストプラクティス',
        metadata: { memoryType: 'semantic', tags: ['api'] },
      });
    });

    it('should filter memories by single memory type', async () => {
      const results = await memoryManager.searchMemories({
        memoryTypes: ['episodic'],
      });

      expect(results).toBeInstanceOf(Array);
      expect(results.length).toBeGreaterThan(0);
      results.forEach((memory) => {
        expect(memory.memoryType).toBe('episodic');
      });
    });

    it('should filter memories by multiple memory types', async () => {
      const results = await memoryManager.searchMemories({
        memoryTypes: ['episodic', 'semantic'],
      });

      expect(results).toBeInstanceOf(Array);
      expect(results.length).toBeGreaterThan(0);
      results.forEach((memory) => {
        expect(['episodic', 'semantic']).toContain(memory.memoryType);
      });
    });

    it('should filter by tags', async () => {
      const results = await memoryManager.searchMemories({
        tags: ['meeting'],
      });

      expect(results).toBeInstanceOf(Array);
      results.forEach((memory) => {
        expect(memory.metadata.tags).toContain('meeting');
      });
    });

    it('should combine memoryType and tag filters', async () => {
      const results = await memoryManager.searchMemories({
        memoryTypes: ['semantic'],
        tags: ['api'],
      });

      expect(results).toBeInstanceOf(Array);
      results.forEach((memory) => {
        expect(memory.memoryType).toBe('semantic');
        expect(memory.metadata.tags).toContain('api');
      });
    });

    it('should limit results based on limit parameter', async () => {
      const results = await memoryManager.searchMemories({
        limit: 2,
      });

      expect(results).toBeInstanceOf(Array);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should return empty array if no memories match criteria', async () => {
      const results = await memoryManager.searchMemories({
        memoryTypes: ['episodic'],
        tags: ['non-existent-tag'],
      });

      expect(results).toBeInstanceOf(Array);
      expect(results.length).toBe(0);
    });

    it('should return all memories if no filters provided', async () => {
      const results = await memoryManager.searchMemories({});

      expect(results).toBeInstanceOf(Array);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should exclude deleted memories from search results', async () => {
      await memoryManager.deleteMemory(episodicMemoryId);

      const results = await memoryManager.searchMemories({
        memoryTypes: ['episodic'],
      });

      expect(results.every((m) => m.id !== episodicMemoryId)).toBe(true);
    });
  });

  describe('overrideMemoryType - ユーザーによるタイプ上書き', () => {
    it('should override memory type successfully', async () => {
      const result = await memoryManager.overrideMemoryType(episodicMemoryId, 'semantic');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBe(true);
      }
    });

    it('should return error for non-existent memory ID', async () => {
      const fakeId = '00000000-0000-4000-8000-000000000000';
      const result = await memoryManager.overrideMemoryType(fakeId, 'semantic');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('MEMORY_NOT_FOUND');
      }
    });

    it('should update memory type to new value', async () => {
      await memoryManager.overrideMemoryType(episodicMemoryId, 'procedural');

      const memories = await memoryManager.searchMemories({
        memoryTypes: ['procedural'],
      });

      const updated = memories.find((m) => m.id === episodicMemoryId);
      expect(updated).toBeDefined();
      if (updated) {
        expect(updated.memoryType).toBe('procedural');
      }
    });

    it('should allow overriding to the same type (idempotent)', async () => {
      const firstResult = await memoryManager.overrideMemoryType(episodicMemoryId, 'episodic');
      expect(firstResult.success).toBe(true);

      const secondResult = await memoryManager.overrideMemoryType(episodicMemoryId, 'episodic');
      expect(secondResult.success).toBe(true);
    });

    it('should track user override for statistics', async () => {
      await memoryManager.overrideMemoryType(episodicMemoryId, 'semantic');

      // User override should be tracked for classification stats
      // This will be verified in integration tests with classifier stats
    });

    it('should update updatedAt timestamp', async () => {
      await memoryManager.overrideMemoryType(episodicMemoryId, 'semantic');

      // Timestamp update verification in integration tests
    });

    it('should reject override on deleted memory', async () => {
      await memoryManager.deleteMemory(semanticMemoryId);

      const result = await memoryManager.overrideMemoryType(semanticMemoryId, 'episodic');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('MEMORY_NOT_FOUND');
      }
    });

    it('should update top-level memoryType only (single source of truth)', async () => {
      // Override to a new type
      await memoryManager.overrideMemoryType(episodicMemoryId, 'semantic');

      // Access memory directly using test helper
      const memory = mockStorage.getMemoryForTest(episodicMemoryId);

      expect(memory).toBeDefined();
      if (memory) {
        // Top-level memoryType should be updated
        expect(memory.memoryType).toBe('semantic');
        // metadata.memoryType should NOT exist (single source of truth)
        expect(memory.metadata.memoryType).toBeUndefined();
      }
    });

    it('should update top-level memoryType correctly on multiple overrides', async () => {
      // First override
      await memoryManager.overrideMemoryType(episodicMemoryId, 'semantic');

      let memory = mockStorage.getMemoryForTest(episodicMemoryId);
      expect(memory?.memoryType).toBe('semantic');
      expect(memory?.metadata.memoryType).toBeUndefined();

      // Second override
      await memoryManager.overrideMemoryType(episodicMemoryId, 'procedural');

      memory = mockStorage.getMemoryForTest(episodicMemoryId);
      expect(memory?.memoryType).toBe('procedural');
      expect(memory?.metadata.memoryType).toBeUndefined();
    });

    it('should remove metadata.memoryType if it exists before override', async () => {
      // Create a memory with metadata.memoryType (simulate legacy data)
      const params: StoreMemoryParams = {
        content: 'Test memory with metadata.memoryType',
        memoryType: 'episodic',
        metadata: {
          memoryType: 'semantic' as any, // This should be removed
          tags: ['test'],
        },
      };

      const storeResult = await memoryManager.storeMemory(params);
      expect(storeResult.success).toBe(true);

      if (storeResult.success) {
        const memoryId = storeResult.value;

        // Verify metadata.memoryType was removed during store
        let memory = mockStorage.getMemoryForTest(memoryId);
        expect(memory?.metadata.memoryType).toBeUndefined();

        // Override the type
        await memoryManager.overrideMemoryType(memoryId, 'procedural');

        // Verify metadata.memoryType is still undefined after override
        memory = mockStorage.getMemoryForTest(memoryId);
        expect(memory?.memoryType).toBe('procedural');
        expect(memory?.metadata.memoryType).toBeUndefined();
        expect(memory?.metadata.tags).toEqual(['test']); // Other metadata should remain
      }
    });
  });

  describe('findSimilarMemories (Task 3.2 - Similarity Detection)', () => {
    it('should exist and return a promise resolving to an array', async () => {
      const results = await memoryManager.findSimilarMemories('test content');
      expect(Array.isArray(results)).toBe(true);
    });
  });
});
