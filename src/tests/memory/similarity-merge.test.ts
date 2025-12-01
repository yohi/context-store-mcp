import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryManager } from '../../memory/memory-manager.js';
import { VectorStoreAdapter } from '../../storage/vector-store-adapter.js';
import { TransactionCoordinator } from '../../storage/transaction-coordinator.js';
import { MemoryClassifierService } from '../../memory/types.js';
import { MockStorageAdapter, MockVectorStoreAdapter, MockTransactionCoordinator, MockMemoryClassifierService } from '../mocks/index.js';

describe('Similarity and Merge', () => {
    let memoryManager: MemoryManager;
    let mockStorage: MockStorageAdapter;
    let mockVectorStore: MockVectorStoreAdapter;
    let mockTransactionCoordinator: MockTransactionCoordinator;
    let mockClassifier: MockMemoryClassifierService;

    beforeEach(() => {
        mockStorage = new MockStorageAdapter();
        mockVectorStore = new MockVectorStoreAdapter();
        mockTransactionCoordinator = new MockTransactionCoordinator(mockStorage);
        mockClassifier = new MockMemoryClassifierService();

        memoryManager = new MemoryManager({
            storage: mockStorage,
            vectorStore: mockVectorStore as unknown as VectorStoreAdapter,
            transactionCoordinator: mockTransactionCoordinator as unknown as TransactionCoordinator,
            classifier: mockClassifier as unknown as MemoryClassifierService,
        });
    });

    it('should find similar memories using vector store', async () => {
        const mockResults = [
            { id: '1', content: 'test', metadata: {}, similarity: 0.9 },
        ];
        mockVectorStore.searchSimilar.mockResolvedValue(mockResults);

        const results = await memoryManager.findSimilarMemories('query');

        // VectorStoreAdapter handles embedding generation internally
        expect(mockVectorStore.searchSimilar).toHaveBeenCalledWith('query', 5);
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('1');
    });

    it('should suggest merges based on similarity', async () => {
        // Setup target memory
        const id = 'mem-1';
        const now = new Date();

        // Mock embedding generation for similarity search
        mockClassifier.generateEmbedding.mockResolvedValue([0.1, 0.2, 0.3, 0.4]);

        mockStorage.memories.set(id, {
            id,
            content: 'original content',
            metadata: { tags: ['tag1'] },
            createdAt: now,
            updatedAt: now,
            lastAccessedAt: now,
            accessCount: 0,
            importanceScore: 0,
            isProtected: false,
            version: 1,
            isDeleted: false,
            memoryType: 'semantic',
        });

        // Setup similar memories
        const mockResults = [
            { id: 'mem-1', content: 'original content', metadata: {}, similarity: 1.0 }, // Self
            { id: 'mem-2', content: 'similar content', metadata: {}, similarity: 0.9 }, // Candidate
        ];
        (mockVectorStore.searchSimilar as any).mockResolvedValue(mockResults);

        // Mock mem-2 as existing and not deleted
        mockStorage.memories.set('mem-2', {
            id: 'mem-2',
            content: 'similar content',
            metadata: { tags: ['tag1'] },
            createdAt: now,
            updatedAt: now,
            lastAccessedAt: now,
            accessCount: 0,
            importanceScore: 0,
            isProtected: false,
            version: 1,
            isDeleted: false,
            memoryType: 'semantic',
        });
        // Mock mem-3 as deleted
        mockStorage.memories.set('mem-3', {
            id: 'mem-3',
            content: 'deleted content',
            metadata: {},
            createdAt: now,
            updatedAt: now,
            lastAccessedAt: now,
            accessCount: 0,
            importanceScore: 0,
            isProtected: false,
            version: 1,
            isDeleted: true,
            memoryType: 'semantic',
        });

        const suggestions = await memoryManager.suggestMerges(id);

        expect(mockVectorStore.searchSimilar).toHaveBeenCalled();
        expect(suggestions).toHaveLength(1);
        expect(suggestions[0].id).toBe('mem-2');
    });
});
