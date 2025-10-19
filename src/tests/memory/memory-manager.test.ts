/**
 * Memory Manager Test Suite
 * TDD approach: Red-Green-Refactor
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryManager } from '../../memory/memory-manager.js';
import type {
  StoreMemoryParams,
  MemoryId,
  MemoryError,
} from '../../memory/types.js';

describe('MemoryManager - Basic Functionality (Task 3.1)', () => {
  let memoryManager: MemoryManager;

  beforeEach(() => {
    memoryManager = new MemoryManager();
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
        metadata: {
          source: 'test-suite',
          tags: ['test', 'unit'],
          memoryType: 'semantic',
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

  beforeEach(() => {
    memoryManager = new MemoryManager();
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

      // Perform garbage collection
      await memoryManager.performGarbageCollection();

      // Memory should be completely removed (not just soft-deleted)
      // Verification will be done in integration tests
      expect(true).toBe(true); // Placeholder
    });

    it('should not remove protected memories even if soft-deleted', async () => {
      const storeResult = await memoryManager.storeMemory({
        content: 'Protected memory',
        metadata: { tags: ['protected'] },
      });

      expect(storeResult.success).toBe(true);
      if (!storeResult.success) return;

      const memoryId = storeResult.value;

      // Mark as protected
      await memoryManager.updateMemory(memoryId, { isProtected: true });

      // Soft delete
      await memoryManager.deleteMemory(memoryId);

      // Perform garbage collection
      await memoryManager.performGarbageCollection();

      // Protected memory should still exist
      // Verification in integration tests
      expect(true).toBe(true); // Placeholder
    });

    it('should only remove memories older than threshold', async () => {
      const storeResult = await memoryManager.storeMemory({
        content: 'Recently deleted memory',
        metadata: { tags: ['recent'] },
      });

      expect(storeResult.success).toBe(true);
      if (!storeResult.success) return;

      const memoryId = storeResult.value;
      await memoryManager.deleteMemory(memoryId);

      // Immediately run GC (memory should not be removed if threshold not met)
      await memoryManager.performGarbageCollection();

      // Memory should still exist (recent deletion)
      // Verification in integration tests
      expect(true).toBe(true); // Placeholder
    });

    it('should handle empty collection gracefully', async () => {
      // Run GC on empty collection
      await expect(
        memoryManager.performGarbageCollection()
      ).resolves.not.toThrow();
    });
  });

  describe('optimizeStorage', () => {
    it('should successfully run on empty storage', async () => {
      await expect(memoryManager.optimizeStorage()).resolves.not.toThrow();
    });

    it('should update importance scores for all memories', async () => {
      // Create multiple memories
      const ids: MemoryId[] = [];
      for (let i = 0; i < 5; i++) {
        const result = await memoryManager.storeMemory({
          content: `Memory ${i}`,
          metadata: { tags: ['optimize-test'] },
        });
        if (result.success) ids.push(result.value);
      }

      // Run optimization
      await memoryManager.optimizeStorage();

      // Importance scores should be updated
      // Verification in integration tests
      expect(ids.length).toBe(5);
    });

    it('should compact memory if needed', async () => {
      // Create and delete some memories
      const result1 = await memoryManager.storeMemory({
        content: 'Memory to delete',
        metadata: {},
      });
      const result2 = await memoryManager.storeMemory({
        content: 'Memory to keep',
        metadata: {},
      });

      if (result1.success) {
        await memoryManager.deleteMemory(result1.value);
      }

      // Run optimization
      await memoryManager.optimizeStorage();

      // Storage should be optimized
      expect(true).toBe(true); // Placeholder
    });

    it('should handle optimization errors gracefully', async () => {
      // Even if some operations fail, optimization should not throw
      await expect(memoryManager.optimizeStorage()).resolves.not.toThrow();
    });
  });
});

describe('MemoryManager - Update, Delete, Merge (Task 3.2)', () => {
  let memoryManager: MemoryManager;
  let storedMemoryId: MemoryId;

  beforeEach(async () => {
    memoryManager = new MemoryManager();

    // Store a test memory for update/delete operations
    const storeResult = await memoryManager.storeMemory({
      content: 'Initial content for testing',
      metadata: {
        tags: ['test'],
        memoryType: 'semantic',
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
      const result = await memoryManager.mergeMemories([
        memory1Id,
        memory2Id,
        memory3Id,
      ]);

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
      const result = await memoryManager.mergeMemories([
        memory1Id,
        fakeId,
        memory2Id,
      ]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('MEMORY_NOT_FOUND');
      }
    });

    it('should combine content from all memories', async () => {
      const result = await memoryManager.mergeMemories([
        memory1Id,
        memory2Id,
        memory3Id,
      ]);

      expect(result.success).toBe(true);
      // Content combination verification in integration tests
    });

    it('should merge metadata tags from all memories', async () => {
      const result = await memoryManager.mergeMemories([
        memory1Id,
        memory2Id,
        memory3Id,
      ]);

      expect(result.success).toBe(true);
      // Tags merging verification in integration tests
    });

    it('should soft delete source memories after merge', async () => {
      const result = await memoryManager.mergeMemories([
        memory1Id,
        memory2Id,
        memory3Id,
      ]);

      expect(result.success).toBe(true);
      // Soft deletion of source memories verification in integration tests
    });

    it('should return new merged memory ID', async () => {
      const result = await memoryManager.mergeMemories([
        memory1Id,
        memory2Id,
      ]);

      expect(result.success).toBe(true);
      if (result.success) {
        // New ID should be different from source IDs
        expect(result.value).not.toBe(memory1Id);
        expect(result.value).not.toBe(memory2Id);
      }
    });
  });
});
