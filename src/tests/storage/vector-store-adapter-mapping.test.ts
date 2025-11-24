
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VectorStoreAdapter } from '../../storage/vector-store-adapter';
import { Pool } from 'pg';

// Mock pg
vi.mock('pg', () => {
    const mPool = {
        connect: vi.fn(),
        query: vi.fn(),
        on: vi.fn(),
    };
    return { Pool: vi.fn(() => mPool) };
});

describe('VectorStoreAdapter - Result Mapping', () => {
    let adapter: VectorStoreAdapter;
    let mockPool: any;

    beforeEach(() => {
        mockPool = new Pool();
        adapter = new VectorStoreAdapter({
            pool: mockPool,
            openaiApiKey: 'test-key',
        });
        // Mock generateEmbedding to avoid API calls
        vi.spyOn(adapter as any, 'generateEmbedding').mockResolvedValue(new Array(1536).fill(0.1));
    });

    it('should correctly map database rows to VectorSearchResult with all fields', async () => {
        const now = new Date();
        const mockRow = {
            id: 'test-id',
            content: 'test content',
            metadata: JSON.stringify({
                source: 'test',
                lastAccessedAt: now.toISOString(),
                accessCount: 42,
                importanceScore: 0.8,
                version: 2,
            }),
            created_at: now,
            updated_at: now,
            similarity: '0.95',
            embedding: '[0.1, 0.2]',
        };

        mockPool.query.mockResolvedValue({
            rows: [mockRow],
            rowCount: 1,
        });

        const results = await adapter.searchSimilar('query');

        expect(results).toHaveLength(1);
        const result = results[0];

        expect(result.id).toBe('test-id');
        expect(result.content).toBe('test content');
        expect(result.similarity).toBe(0.95);
        expect(result.createdAt).toEqual(now);
        expect(result.updatedAt).toEqual(now);
        expect(result.lastAccessedAt).toEqual(now);
        expect(result.accessCount).toBe(42);
        expect(result.importanceScore).toBe(0.8);
        expect(result.version).toBe(2);
    });

    it('should handle missing optional fields gracefully', async () => {
        const now = new Date();
        const mockRow = {
            id: 'test-id',
            content: 'test content',
            metadata: JSON.stringify({
                source: 'test',
                // Missing optional fields
            }),
            created_at: now,
            updated_at: now,
            similarity: '0.95',
            embedding: '[0.1, 0.2]',
        };

        mockPool.query.mockResolvedValue({
            rows: [mockRow],
            rowCount: 1,
        });

        const results = await adapter.searchSimilar('query');

        expect(results).toHaveLength(1);
        const result = results[0];

        expect(result.lastAccessedAt).toBeUndefined();
        expect(result.accessCount).toBeUndefined();
        expect(result.importanceScore).toBeUndefined();
        expect(result.version).toBeUndefined();
    });
});
