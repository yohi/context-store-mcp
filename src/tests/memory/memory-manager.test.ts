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
