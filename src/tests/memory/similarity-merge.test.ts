import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryManager } from '../../memory/memory-manager.js';
import { VectorStoreAdapter } from '../../storage/vector-store-adapter.js';

describe('Similarity and Merge', () => {
    let memoryManager: MemoryManager;
    let vectorStore: VectorStoreAdapter;

    beforeEach(() => {
        vectorStore = {
            searchSimilar: vi.fn(),
        } as unknown as VectorStoreAdapter;

        memoryManager = new MemoryManager({
            vectorStore,
        });
    });

    it('should find similar memories using vector store', async () => {
        const mockResults = [
            { id: '1', content: 'test', metadata: {}, similarity: 0.9 },
        ];
        (vectorStore.searchSimilar as any).mockResolvedValue(mockResults);

        const results = await memoryManager.findSimilarMemories('query');

        expect(vectorStore.searchSimilar).toHaveBeenCalledWith('query', 5);
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('1');
    });

    it('should suggest merges based on similarity', async () => {
        // Setup target memory
        const id = 'mem-1';
        const now = new Date();
        (memoryManager as any).memories.set(id, {
            id,
            content: 'original content',
            metadata: { tags: ['tag1'] },
            createdAt: now,
            updatedAt: now,
            isDeleted: false,
            memoryType: 'semantic',
        });

        // Setup similar memories
        const mockResults = [
            { id: 'mem-1', content: 'original content', metadata: {}, similarity: 1.0 }, // Self
            { id: 'mem-2', content: 'similar content', metadata: {}, similarity: 0.9 }, // Candidate
            { id: 'mem-3', content: 'deleted content', metadata: {}, similarity: 0.85 }, // Deleted candidate
        ];
        (vectorStore.searchSimilar as any).mockResolvedValue(mockResults);

        // Mock mem-2 as existing and not deleted
        (memoryManager as any).memories.set('mem-2', { 
            id: 'mem-2', 
            content: 'similar content',
            metadata: { tags: ['tag1'] },
            createdAt: now,
            updatedAt: now,
            isDeleted: false,
            memoryType: 'semantic',
        });
        // Mock mem-3 as deleted
        (memoryManager as any).memories.set('mem-3', { 
            id: 'mem-3', 
            content: 'deleted content',
            metadata: {},
            createdAt: now,
            updatedAt: now,
            isDeleted: true,
            memoryType: 'semantic',
        });

        const suggestions = await memoryManager.suggestMerges(id);

        expect(vectorStore.searchSimilar).toHaveBeenCalled();
        expect(suggestions).toHaveLength(1);
        expect(suggestions[0].id).toBe('mem-2');
    });
});
