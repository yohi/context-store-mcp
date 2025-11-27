import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../../memory/memory-manager.js';
import { TransactionCoordinator } from '../../storage/transaction-coordinator.js';
import { VectorStoreAdapter } from '../../storage/vector-store-adapter.js';

// Mock dependencies
vi.mock('../../storage/transaction-coordinator.js');
vi.mock('../../storage/vector-store-adapter.js');

describe('Issues Verification', () => {
  let memoryManager: MemoryManager;
  let mockTxCoordinator: any;
  let mockVectorStore: any;

  beforeEach(() => {
    mockTxCoordinator = {
      getDatabaseSize: vi.fn(),
      deleteLowImportanceMemories: vi.fn(),
      findSoftDeletedMemories: vi.fn().mockResolvedValue([]),
      hardDeleteMemory: vi.fn().mockResolvedValue({ status: 'ok' }),
      storeMemoryWithSaga: vi.fn().mockResolvedValue({ status: 'ok' }),
      updateMemoryWithSaga: vi.fn().mockResolvedValue({ status: 'ok' }),
      deleteMemoryWithSaga: vi.fn().mockResolvedValue({ status: 'ok' }),
      saveMemoryVersion: vi.fn(),
      getMemoryVersions: vi.fn(),
    };

    mockVectorStore = {
      searchSimilar: vi.fn().mockResolvedValue([]),
    };

    memoryManager = new MemoryManager({
      transactionCoordinator: mockTxCoordinator as unknown as TransactionCoordinator,
      vectorStore: mockVectorStore as unknown as VectorStoreAdapter,
    });
  });

  describe('Issue #2: Similarity & Merge Suggestions', () => {
    it('should boost score for memories with overlapping tags', async () => {
      const targetId = 'target-id';
      const candidateId = 'candidate-id';
      const now = new Date();

      // Setup Target Memory
      // @ts-ignore - accessing private map for setup
      memoryManager.memories.set(targetId, {
        id: targetId,
        content: 'Target Content',
        metadata: { tags: ['AI', 'Coding'] },
        createdAt: now,
        updatedAt: now,
        memoryType: 'semantic',
        isDeleted: false
      } as any);

      // Setup Candidate Memory (Tag Match)
      // @ts-ignore
      memoryManager.memories.set(candidateId, {
        id: candidateId,
        content: 'Candidate Content',
        metadata: { tags: ['Coding', 'Testing'] }, // Overlap: Coding
        createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000), // Different time
        updatedAt: now,
        memoryType: 'semantic',
        isDeleted: false
      } as any);

      // Mock vector search to return candidate with low score
      mockVectorStore.searchSimilar.mockResolvedValue([
        { id: candidateId, similarity: 0.7 } // Below default 0.8 threshold
      ]);

      // Execute findSimilarMemoriesById with default threshold 0.8
      // Base score 0.7 + Tag Boost 0.15 = 0.85 > 0.8
      const results = await memoryManager.findSimilarMemoriesById(targetId, 0.8);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(candidateId);
    });

    it('should boost score for memories with temporal proximity', async () => {
        const targetId = 'target-id';
        const candidateId = 'candidate-id';
        const now = new Date();
  
        // Setup Target
        // @ts-ignore
        memoryManager.memories.set(targetId, {
          id: targetId,
          content: 'Target',
          metadata: { tags: ['A'] },
          createdAt: now,
          updatedAt: now,
          isDeleted: false
        } as any);
  
        // Setup Candidate (Time Match < 1h)
        // @ts-ignore
        memoryManager.memories.set(candidateId, {
          id: candidateId,
          content: 'Candidate',
          metadata: { tags: ['B'] },
          createdAt: new Date(now.getTime() - 30 * 60 * 1000), // 30 mins ago
          updatedAt: now,
          isDeleted: false
        } as any);
  
        // Mock vector search (low score)
        mockVectorStore.searchSimilar.mockResolvedValue([
          { id: candidateId, similarity: 0.7 }
        ]);
  
        // Base 0.7 + Time Boost 0.15 = 0.85 > 0.8
        const results = await memoryManager.findSimilarMemoriesById(targetId, 0.8);
  
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe(candidateId);
      });
  });

  describe('Issue #4: Garbage Collection', () => {
    let originalEnv: string | undefined;

    beforeEach(() => {
      originalEnv = process.env.DB_SIZE_LIMIT_BYTES;
    });

    afterEach(() => {
      process.env.DB_SIZE_LIMIT_BYTES = originalEnv;
    });

    it('should trigger auto-deletion when storage usage is high', async () => {
      // Mock storage usage > 80%
      process.env.DB_SIZE_LIMIT_BYTES = '1000';
      mockTxCoordinator.getDatabaseSize.mockResolvedValue(850); // 85%
      mockTxCoordinator.deleteLowImportanceMemories.mockResolvedValue(5);

      await memoryManager.performGarbageCollection();

      expect(mockTxCoordinator.getDatabaseSize).toHaveBeenCalled();
      expect(mockTxCoordinator.deleteLowImportanceMemories).toHaveBeenCalledWith(
        0.3, 
        expect.any(Date)
      );
    });

    it('should NOT trigger auto-deletion when storage usage is low', async () => {
      // Mock storage usage < 80%
      process.env.DB_SIZE_LIMIT_BYTES = '1000';
      mockTxCoordinator.getDatabaseSize.mockResolvedValue(500); // 50%

      await memoryManager.performGarbageCollection();

      expect(mockTxCoordinator.getDatabaseSize).toHaveBeenCalled();
      expect(mockTxCoordinator.deleteLowImportanceMemories).not.toHaveBeenCalled();
    });
  });
});
