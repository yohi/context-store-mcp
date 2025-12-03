import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryViewer } from '../../viewer/memory-viewer.js';
import type { ViewerConfig } from '../../viewer/types.js';

// Mock express
const { mockExpress } = vi.hoisted(() => {
    const mockUse = vi.fn();
    const mockGet = vi.fn();
    const mockPost = vi.fn();
    const mockApp = {
        use: mockUse,
        get: mockGet,
        post: mockPost,
        listen: vi.fn(),
    };
    const mockExpress = vi.fn(() => mockApp);
    (mockExpress as any).json = vi.fn();
    (mockExpress as any).urlencoded = vi.fn();
    return { mockExpress };
});

vi.mock('express', () => ({
    default: mockExpress,
}));

describe('MemoryViewer Mapping', () => {
    let mockPool: any;
    let viewer: MemoryViewer;

    beforeEach(() => {
        vi.clearAllMocks();
        mockPool = {
            query: vi.fn(),
            end: vi.fn(),
        };
        const config: ViewerConfig = {
            port: 3000,
            authEnabled: false,
            pool: mockPool,
        };
        viewer = new MemoryViewer(config);
    });

    describe('fetchMemories', () => {
        it('should map string metadata correctly', async () => {
            mockPool.query
                .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // Count query
                .mockResolvedValueOnce({ // Data query
                    rows: [{
                        id: '1',
                        content: 'test',
                        metadata: '{"key": "value"}',
                        created_at: new Date(),
                        updated_at: new Date(),
                    }]
                });

            const result = await viewer.fetchMemories({});
            expect(result.memories[0].metadata).toEqual({ key: 'value' });
        });

        it('should map object metadata correctly', async () => {
            mockPool.query
                .mockResolvedValueOnce({ rows: [{ count: '1' }] })
                .mockResolvedValueOnce({
                    rows: [{
                        id: '1',
                        content: 'test',
                        metadata: { key: 'value' },
                        created_at: new Date(),
                        updated_at: new Date(),
                    }]
                });

            const result = await viewer.fetchMemories({});
            expect(result.memories[0].metadata).toEqual({ key: 'value' });
        });

        it('should map null metadata to empty object', async () => {
            mockPool.query
                .mockResolvedValueOnce({ rows: [{ count: '1' }] })
                .mockResolvedValueOnce({
                    rows: [{
                        id: '1',
                        content: 'test',
                        metadata: null,
                        created_at: new Date(),
                        updated_at: new Date(),
                    }]
                });

            const result = await viewer.fetchMemories({});
            expect(result.memories[0].metadata).toEqual({});
        });

        it('should map invalid json metadata to empty object', async () => {
            mockPool.query
                .mockResolvedValueOnce({ rows: [{ count: '1' }] })
                .mockResolvedValueOnce({
                    rows: [{
                        id: '1',
                        content: 'test',
                        metadata: '{invalid}',
                        created_at: new Date(),
                        updated_at: new Date(),
                    }]
                });

            const result = await viewer.fetchMemories({});
            expect(result.memories[0].metadata).toEqual({});
        });
    });

    describe('search (text)', () => {
        it('should map metadata and similarity correctly', async () => {
            mockPool.query
                .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // Count query
                .mockResolvedValueOnce({ // Data query
                    rows: [{
                        id: '1',
                        content: 'test',
                        metadata: '{"key": "value"}',
                        created_at: new Date(),
                        updated_at: new Date(),
                        rank: '0.5'
                    }]
                });

            const result = await viewer.search({ query: 'test', searchType: 'text' });
            expect(result.results[0].metadata).toEqual({ key: 'value' });
            expect(result.results[0].similarity).toBe(0.5);
        });
    });
});
