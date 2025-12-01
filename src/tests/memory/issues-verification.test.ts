import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../../memory/memory-manager.js';
import { TransactionCoordinator } from '../../storage/transaction-coordinator.js';
import { VectorStoreAdapter } from '../../storage/vector-store-adapter.js';
import { MemoryClassifierService } from '../../memory/types.js'; // Import MemoryClassifierService
import { MockStorageAdapter, MockVectorStoreAdapter, MockTransactionCoordinator, MockMemoryClassifierService } from '../mocks/index.js';

describe('Issues Verification', () => {
  let memoryManager: MemoryManager;
  let mockStorage: MockStorageAdapter;
  let mockTxCoordinator: MockTransactionCoordinator;
  let mockVectorStore: MockVectorStoreAdapter;
  let mockClassifier: MockMemoryClassifierService; // Declare mockClassifier

  beforeEach(() => {
    mockStorage = new MockStorageAdapter();
    mockTxCoordinator = new MockTransactionCoordinator(mockStorage);
    mockVectorStore = new MockVectorStoreAdapter();
    mockClassifier = new MockMemoryClassifierService(); // Initialize mockClassifier

    // Default mock for generateEmbedding for findSimilarMemoriesById
    mockClassifier.generateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);

    memoryManager = new MemoryManager({
      storage: mockStorage,
      transactionCoordinator: mockTxCoordinator as unknown as TransactionCoordinator,
      vectorStore: mockVectorStore as unknown as VectorStoreAdapter,
      classifier: mockClassifier as unknown as MemoryClassifierService, // Pass mockClassifier
    });
  });

  describe('Issue #2: Similarity & Merge Suggestions', () => {
    it('should boost score for memories with overlapping tags', async () => {
      const targetId = 'target-id';
      const candidateId = 'candidate-id';
      const now = new Date();

      // Setup Target Memory
      mockStorage.memories.set(targetId, {
        id: targetId,
        content: 'Target Content',
        metadata: { tags: ['AI', 'Coding'] },
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        importanceScore: 0,
        isProtected: false,
        version: 1,
        memoryType: 'semantic',
        isDeleted: false
      });

      // Setup Candidate Memory (Tag Match)
      mockStorage.memories.set(candidateId, {
        id: candidateId,
        content: 'Candidate Content',
        metadata: { tags: ['Coding', 'Testing'] }, // Overlap: Coding
        createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000), // Different time
        updatedAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        importanceScore: 0,
        isProtected: false,
        version: 1,
        memoryType: 'semantic',
        isDeleted: false
      });

      // Mock vector search to return candidate with low score, but with metadata
      mockVectorStore.searchSimilar.mockResolvedValue([
        { 
          id: candidateId, 
          similarity: 0.7, 
          content: 'Candidate Content', 
          metadata: { tags: ['Coding', 'Testing'] },
          createdAt: new Date(),
          updatedAt: new Date(),
        } // Below default 0.8 threshold
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
        mockStorage.memories.set(targetId, {
          id: targetId,
          content: 'Target',
          metadata: { tags: ['A'] },
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
          accessCount: 0,
          importanceScore: 0,
          isProtected: false,
          version: 1,
          memoryType: 'semantic',
          isDeleted: false
        });
  
        // Setup Candidate (Time Match < 1h)
        mockStorage.memories.set(candidateId, {
          id: candidateId,
          content: 'Candidate',
          metadata: { tags: ['B'] },
          createdAt: new Date(now.getTime() - 30 * 60 * 1000), // 30 mins ago
          updatedAt: now,
          lastAccessedAt: now,
          accessCount: 0,
          importanceScore: 0,
          isProtected: false,
          version: 1,
          memoryType: 'semantic',
          isDeleted: false
        });
  
              // Mock vector search (low score)
              mockVectorStore.searchSimilar.mockResolvedValue([
                { 
                  id: candidateId, 
                  similarity: 0.71,
                  content: 'Candidate',
                  metadata: { tags: ['B'] },
                  createdAt: new Date(now.getTime() - 30 * 60 * 1000), // 30 mins ago
                  updatedAt: new Date(now.getTime() - 30 * 60 * 1000),
                  lastAccessedAt: new Date(now.getTime() - 30 * 60 * 1000), // Add lastAccessedAt
                }
              ]);  
        // Base 0.7 + Time Boost 0.10 = 0.80 >= 0.8
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
