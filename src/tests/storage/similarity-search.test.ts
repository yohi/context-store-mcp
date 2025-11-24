/**
 * 類似性検索とランキング機能のテスト
 *
 * タスク5.2: 類似性検索とランキング機能
 * - 類似度計算による検索実装
 * - 閾値フィルタリング
 * - スコアリングアルゴリズム
 * - 検索結果のランキング
 * - メタデータフィルタの適用
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VectorStoreAdapter } from '../../storage/vector-store-adapter';
import type { Pool } from 'pg';

// OpenAI Mock
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      embeddings: {
        create: vi.fn().mockResolvedValue({
          data: [{ embedding: Array(1536).fill(0.1) }]
        })
      }
    })),
    APIError: class extends Error {},
    APIConnectionError: class extends Error {},
    RateLimitError: class extends Error {},
  };
});

describe('類似性検索とランキング機能', () => {
  let adapter: VectorStoreAdapter;
  let mockPool: any;
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };
    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      query: vi.fn(),
    };
    adapter = new VectorStoreAdapter({
      pool: mockPool as Pool,
      openaiApiKey: 'test-key',
    });
  });

  describe('メタデータフィルタ', () => {
    it('タグによるフィルタリングができる', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      await adapter.searchSimilarAdvanced('query', {
        filter: { tags: ['tag1', 'tag2'] }
      });

      const queryCall = mockPool.query.mock.calls[0];
      const sql = queryCall[0];
      const params = queryCall[1];

      expect(sql).toContain("m.metadata->'tags' ?| $");
      expect(params).toContainEqual(['tag1', 'tag2']);
    });

    it('記憶タイプによるフィルタリングができる', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      await adapter.searchSimilarAdvanced('query', {
        filter: { memoryType: 'episodic' }
      });

      const queryCall = mockPool.query.mock.calls[0];
      const sql = queryCall[0];
      const params = queryCall[1];

      expect(sql).toContain("m.metadata->>'memoryType' = $");
      expect(params).toContain('episodic');
    });

    it('時間範囲によるフィルタリングができる', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      const createdAfter = new Date('2023-01-01');
      const createdBefore = new Date('2023-12-31');
      
      await adapter.searchSimilarAdvanced('query', {
        filter: { createdAfter, createdBefore }
      });

      const queryCall = mockPool.query.mock.calls[0];
      const sql = queryCall[0];
      const params = queryCall[1];

      expect(sql).toContain("m.created_at >= $");
      expect(sql).toContain("m.created_at <= $");
      expect(params).toContain(createdAfter);
      expect(params).toContain(createdBefore);
    });

    it('複数のメタデータフィルタを組み合わせられる', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      await adapter.searchSimilarAdvanced('query', {
        filter: { 
          tags: ['important'], 
          memoryType: 'semantic' 
        }
      });

      const queryCall = mockPool.query.mock.calls[0];
      const sql = queryCall[0];
      
      expect(sql).toContain("m.metadata->'tags' ?| $");
      expect(sql).toContain("m.metadata->>'memoryType' = $");
      expect(sql).toContain('AND');
    });

    it('ソースによるフィルタリングができる', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      await adapter.searchSimilarAdvanced('query', {
        filter: { source: 'user' }
      });

      const queryCall = mockPool.query.mock.calls[0];
      const sql = queryCall[0];
      const params = queryCall[1];

      expect(sql).toContain("m.metadata->>'source' = $");
      expect(params).toContain('user');
    });
  });

  describe('スコアリングアルゴリズム', () => {
    // Helper to create a mock result row
    const createMockRow = (id: string, similarity: number, metadata: any = {}, created_at = new Date(), embedding = '[0.1]') => ({
      id,
      content: 'content',
      similarity: similarity.toString(),
      metadata: JSON.stringify(metadata),
      created_at,
      updated_at: created_at,
      embedding
    });

    it('コサイン類似度スコアを計算できる', async () => {
      mockPool.query.mockResolvedValue({
        rows: [createMockRow('1', 0.9)]
      });

      const results = await adapter.searchSimilarAdvanced('query', {
        scoringStrategy: 'similarity_only'
      });

      expect(results[0].finalScore).toBeCloseTo(0.9);
    });

    it('時間的な新しさをスコアに反映できる', async () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
      
      mockPool.query.mockResolvedValue({
        rows: [createMockRow('1', 0.9, { timestamp: oldDate.toISOString() }, oldDate)]
      });

      const results = await adapter.searchSimilarAdvanced('query', {
        scoringStrategy: 'recency_weighted'
      });

      // recency weighted logic: sim * 0.7 + recency * 0.3
      // recency score for 30 days is approx exp(-1) = 0.368
      // total = 0.9 * 0.7 + 0.368 * 0.3 = 0.63 + 0.11 = 0.74
      expect(results[0].finalScore).toBeLessThan(0.9); 
      expect(results[0].scoreBreakdown?.recencyScore).toBeDefined();
    });

    it('記憶の重要度をスコアに反映できる', async () => {
      mockPool.query.mockResolvedValue({
        rows: [createMockRow('1', 0.9, { importance: 0.8 })]
      });

      const results = await adapter.searchSimilarAdvanced('query', {
        scoringStrategy: 'importance_weighted'
      });

      // importance weighted: sim * 0.7 + imp * 0.3
      // 0.9 * 0.7 + 0.8 * 0.3 = 0.63 + 0.24 = 0.87
      expect(results[0].finalScore).toBeCloseTo(0.87);
    });

    it('複合スコアを計算できる', async () => {
      const now = new Date();
      mockPool.query.mockResolvedValue({
        rows: [createMockRow('1', 0.9, { importance: 0.8, timestamp: now.toISOString() }, now)]
      });

      const results = await adapter.searchSimilarAdvanced('query', {
        scoringStrategy: 'hybrid'
      });

      // hybrid: sim * 0.6 + recency * 0.2 + imp * 0.2
      // recency for now is 1.0
      // 0.9 * 0.6 + 1.0 * 0.2 + 0.8 * 0.2 = 0.54 + 0.2 + 0.16 = 0.9
      expect(results[0].finalScore).toBeCloseTo(0.9);
    });
  });

  describe('検索結果のランキング', () => {
    const createMockRow = (id: string, similarity: number) => ({
      id,
      content: 'content',
      similarity: similarity.toString(),
      metadata: '{}',
      created_at: new Date(),
      updated_at: new Date(),
      embedding: '[0.1]'
    });

    it('類似度スコアで降順にソートされる', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          createMockRow('1', 0.8),
          createMockRow('2', 0.9)
        ]
      });

      const results = await adapter.searchSimilarAdvanced('query');

      expect(results[0].id).toBe('2');
      expect(results[1].id).toBe('1');
    });

    it('limit パラメータで結果件数を制限できる', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      await adapter.searchSimilarAdvanced('query', { limit: 5 });

      const queryCall = mockPool.query.mock.calls[0];
      const params = queryCall[1];
      // We assume the implementation might request more for re-ranking, 
      // but let's verify it uses the calculated limit
      const limitParam = params[params.length - 1];
      expect(limitParam).toBeGreaterThanOrEqual(5); 
    });

    it('最小類似度閾値を下回る結果は除外される', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      await adapter.searchSimilarAdvanced('query', { minSimilarity: 0.8 });

      const queryCall = mockPool.query.mock.calls[0];
      const params = queryCall[1];
      // Verify threshold param
      expect(params).toContain(0.8);
    });
  });

  describe('高度な検索機能', () => {
    it('除外フィルタ: 特定の記憶を結果から除外できる', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      await adapter.searchSimilarAdvanced('query', {
        excludeIds: ['id1', 'id2']
      });

      const queryCall = mockPool.query.mock.calls[0];
      const sql = queryCall[0];
      const params = queryCall[1];

      expect(sql).toContain("NOT (m.id = ANY($");
      expect(params).toContainEqual(['id1', 'id2']);
    });

    it('多様性を考慮した検索結果を返せる', async () => {
      // Mock 2 similar vectors and 1 different one
      mockPool.query.mockResolvedValue({
        rows: [
          { 
            id: '1', 
            similarity: '0.95', 
            embedding: [1, 0, 0], 
            metadata: '{}', created_at: new Date(), updated_at: new Date() 
          },
          { 
            id: '2', 
            similarity: '0.94', 
            embedding: [0.99, 0.01, 0], // Very similar to 1
            metadata: '{}', created_at: new Date(), updated_at: new Date() 
          },
          { 
            id: '3', 
            similarity: '0.8', 
            embedding: [0, 1, 0], // Orthogonal to 1
            metadata: '{}', created_at: new Date(), updated_at: new Date() 
          }
        ]
      });

      const results = await adapter.searchSimilarAdvanced('query', {
        diversityEnabled: true,
        limit: 2
      });

      // Expect 1 and 3 to be selected because 2 is too similar to 1
      expect(results.length).toBe(2);
      expect(results[0].id).toBe('1');
      expect(results[1].id).toBe('3');
    });

    it('検索結果に説明を付与できる', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ 
          id: '1', 
          similarity: '0.9', 
          metadata: JSON.stringify({ tags: ['test'] }),
          created_at: new Date(), updated_at: new Date(),
          embedding: '[0.1]'
        }]
      });

      const results = await adapter.searchSimilarAdvanced('query');
      expect(results[0].explanation).toBeDefined();
      expect(results[0].explanation).toContain('類似度:');
      expect(results[0].explanation).toContain('タグ: test');
    });
  });

  describe('エラーハンドリング', () => {
    it('空のクエリ文字列の場合はエラーをスローする', async () => {
      await expect(adapter.searchSimilarAdvanced('')).rejects.toThrow();
    });

    it('limitが範囲外の場合はエラーをスローする', async () => {
      await expect(adapter.searchSimilarAdvanced('q', { limit: 0 })).rejects.toThrow();
      await expect(adapter.searchSimilarAdvanced('q', { limit: 101 })).rejects.toThrow();
    });
  });
});
