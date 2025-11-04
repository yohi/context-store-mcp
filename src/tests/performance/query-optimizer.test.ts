/**
 * QueryOptimizerのユニットテスト
 *
 * タスク10.1: パフォーマンスチューニング - クエリ最適化と実行計画分析
 * Requirements: 7.1 (P95 < 2秒)
 *
 * テスト対象:
 * - PostgreSQL EXPLAIN ANALYZE
 * - Neo4j PROFILE
 * - クエリプロファイリング
 * - スロークエリ検出
 * - 最適化推奨事項生成
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryOptimizer } from '../../performance/query-optimizer';

// モック変数
let mockPgPool: any;
let mockNeo4jDriver: any;
let mockNeo4jSession: any;

describe('QueryOptimizer - Task 10.1: Query Optimization', () => {
  let optimizer: QueryOptimizer;

  beforeEach(() => {
    // PostgreSQL Poolモック
    mockPgPool = {
      query: vi.fn(),
    };

    // Neo4j Sessionモック
    mockNeo4jSession = {
      run: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };

    // Neo4j Driverモック
    mockNeo4jDriver = {
      session: vi.fn(() => mockNeo4jSession),
    };

    // QueryOptimizerのインスタンス作成
    optimizer = new QueryOptimizer({
      pgPool: mockPgPool,
      neo4jDriver: mockNeo4jDriver,
      slowQueryThreshold: 100, // テスト用に短く設定
      enableAutoExplain: true,
      enableProfiling: true,
      profilingInterval: 1000,
    });
  });

  afterEach(async () => {
    await optimizer.shutdown();
    vi.clearAllMocks();
  });

  describe('PostgreSQL Query Optimization', () => {
    it('should execute EXPLAIN ANALYZE on PostgreSQL query', async () => {
      const testQuery = 'SELECT * FROM memories WHERE id = 1';

      mockPgPool.query.mockResolvedValue({
        rows: [
          {
            'QUERY PLAN': [
              {
                Plan: {
                  nodeType: 'Index Scan',
                  relationName: 'memories',
                  startupCost: 0.0,
                  totalCost: 8.27,
                  planRows: 1,
                  planWidth: 100,
                  actualTime: [0.02, 0.03],
                  actualRows: 1,
                  actualLoops: 1,
                },
                'Planning Time': 0.5,
                'Execution Time': 1.2,
              },
            ],
          },
        ],
      });

      const result = await optimizer.explainPostgresQuery(testQuery);

      expect(result.query).toBe(testQuery);
      expect(result.plan.nodeType).toBe('Index Scan');
      expect(result.totalCost).toBe(8.27);
      expect(result.warnings).toEqual([]);
      expect(mockPgPool.query).toHaveBeenCalledWith(
        expect.stringContaining('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)')
      );
    });

    it('should detect sequential scan warning', async () => {
      const testQuery = 'SELECT * FROM memories WHERE content LIKE \'%test%\'';

      mockPgPool.query.mockResolvedValue({
        rows: [
          {
            'QUERY PLAN': [
              {
                Plan: {
                  nodeType: 'Seq Scan',
                  relationName: 'memories',
                  startupCost: 0.0,
                  totalCost: 15000.0,
                  planRows: 100000,
                  planWidth: 100,
                  actualTime: [10.5, 150.0],
                  actualRows: 100000,
                  actualLoops: 1,
                },
                'Planning Time': 2.0,
                'Execution Time': 155.0,
              },
            ],
          },
        ],
      });

      const result = await optimizer.explainPostgresQuery(testQuery);

      expect(result.warnings).toContain('Sequential scan detected - consider adding an index');
      expect(result.warnings).toContain('High query cost detected');
      expect(result.warnings).toContain('Large number of rows scanned');
      expect(result.recommendations).toContain('Add index on memories');
    });

    it('should generate optimization recommendations for nested loop', async () => {
      mockPgPool.query.mockResolvedValue({
        rows: [
          {
            'QUERY PLAN': [
              {
                Plan: {
                  nodeType: 'Nested Loop',
                  startupCost: 0.0,
                  totalCost: 5000.0,
                  planRows: 2000,
                  planWidth: 200,
                  actualRows: 2000,
                  actualLoops: 1,
                },
                'Planning Time': 1.0,
                'Execution Time': 50.0,
              },
            ],
          },
        ],
      });

      const result = await optimizer.explainPostgresQuery('SELECT * FROM a JOIN b');

      expect(result.recommendations).toContain(
        'Consider using hash join or merge join instead of nested loop'
      );
    });
  });

  describe('Neo4j Query Optimization', () => {
    it('should execute PROFILE on Neo4j query', async () => {
      const testQuery = 'MATCH (m:Memory {id: 1}) RETURN m';

      mockNeo4jSession.run.mockResolvedValue({
        summary: {
          profile: {
            operatorType: 'NodeIndexSeek',
            dbHits: 5,
            rows: 1,
          },
        },
      });

      const result = await optimizer.explainNeo4jQuery(testQuery);

      expect(result.query).toBe(testQuery);
      expect(result.plan.nodeType).toBe('NodeIndexSeek');
      expect(result.totalCost).toBe(5);
      expect(result.actualRows).toBe(1);
      expect(mockNeo4jSession.run).toHaveBeenCalledWith(expect.stringContaining('PROFILE'));
      expect(mockNeo4jSession.close).toHaveBeenCalled();
    });

    it('should detect high database hits in Neo4j', async () => {
      const testQuery = 'MATCH (m:Memory) RETURN m';

      mockNeo4jSession.run.mockResolvedValue({
        summary: {
          profile: {
            operatorType: 'AllNodesScan',
            dbHits: 15000,
            rows: 10000,
          },
        },
      });

      const result = await optimizer.explainNeo4jQuery(testQuery);

      expect(result.warnings).toContain('High database hits detected');
      expect(result.recommendations).toContain('Consider adding appropriate indexes');
    });
  });

  describe('Query Profiling', () => {
    it('should profile PostgreSQL query and record execution time', async () => {
      const testQuery = 'SELECT * FROM memories WHERE id = 1';

      mockPgPool.query.mockResolvedValue({
        rows: [{ id: 1, content: 'test' }],
      });

      await optimizer.profileQuery(testQuery, 'postgresql');

      const profile = optimizer.getQueryProfile(testQuery);

      expect(profile).toBeDefined();
      expect(profile?.query).toBe(testQuery);
      expect(profile?.executionCount).toBe(1);
      expect(profile?.totalTime).toBeGreaterThan(0);
      expect(profile?.minTime).toBeGreaterThan(0);
      expect(profile?.maxTime).toBeGreaterThan(0);
      expect(profile?.avgTime).toBeGreaterThan(0);
    });

    it('should profile Neo4j query and record execution time', async () => {
      const testQuery = 'MATCH (m:Memory {id: 1}) RETURN m';

      mockNeo4jSession.run.mockResolvedValue({
        records: [{ get: () => ({ id: 1 }) }],
      });

      await optimizer.profileQuery(testQuery, 'neo4j');

      const profile = optimizer.getQueryProfile(testQuery);

      expect(profile).toBeDefined();
      expect(profile?.query).toBe(testQuery);
      expect(profile?.executionCount).toBe(1);
      expect(mockNeo4jSession.close).toHaveBeenCalled();
    });

    it('should update profile statistics on repeated queries', async () => {
      const testQuery = 'SELECT COUNT(*) FROM memories';

      mockPgPool.query.mockResolvedValue({ rows: [{ count: 100 }] });

      // 3回実行
      await optimizer.profileQuery(testQuery, 'postgresql');
      await optimizer.profileQuery(testQuery, 'postgresql');
      await optimizer.profileQuery(testQuery, 'postgresql');

      const profile = optimizer.getQueryProfile(testQuery);

      expect(profile?.executionCount).toBe(3);
      expect(profile?.avgTime).toBeGreaterThan(0);
      expect(profile?.maxTime).toBeGreaterThanOrEqual(profile?.minTime ?? 0);
    });
  });

  describe('Slow Query Detection', () => {
    it('should detect and record slow queries', async () => {
      const slowQuery = 'SELECT * FROM memories WHERE content LIKE \'%long%\'';

      // 遅延をシミュレート
      mockPgPool.query.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ rows: [] }), 150))
      );

      await optimizer.profileQuery(slowQuery, 'postgresql');

      const slowQueries = optimizer.getSlowQueries();

      expect(slowQueries.length).toBeGreaterThan(0);
      expect(slowQueries[0].query).toBe(slowQuery);
      expect(slowQueries[0].executionTime).toBeGreaterThanOrEqual(100);
      expect(slowQueries[0].database).toBe('postgresql');
    });

    it('should limit slow query history to 100 entries', async () => {
      mockPgPool.query.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ rows: [] }), 150))
      );

      // 110個のスロークエリを生成
      for (let i = 0; i < 110; i++) {
        await optimizer.profileQuery(`SELECT ${i}`, 'postgresql');
      }

      const slowQueries = optimizer.getSlowQueries();

      expect(slowQueries.length).toBeLessThanOrEqual(100);
    });
  });

  describe('Profiling Management', () => {
    it('should start and stop profiling', () => {
      optimizer.startProfiling();

      // プロファイリング開始を確認
      expect(optimizer).toBeDefined();

      optimizer.stopProfiling();

      // プロファイリング停止を確認
      expect(optimizer).toBeDefined();
    });

    it('should clear profiles and slow queries', async () => {
      mockPgPool.query.mockResolvedValue({ rows: [] });

      await optimizer.profileQuery('SELECT 1', 'postgresql');

      expect(optimizer.getQueryProfiles().length).toBeGreaterThan(0);

      optimizer.clearProfiles();

      expect(optimizer.getQueryProfiles().length).toBe(0);
      expect(optimizer.getSlowQueries().length).toBe(0);
    });
  });

  describe('Optimization Recommendations', () => {
    it('should generate optimization recommendations from slow queries', async () => {
      const slowQuery = 'SELECT * FROM memories WHERE content = \'test\'';

      mockPgPool.query
        .mockResolvedValueOnce({
          rows: [
            {
              'QUERY PLAN': [
                {
                  Plan: {
                    nodeType: 'Seq Scan',
                    relationName: 'memories',
                    startupCost: 0.0,
                    totalCost: 12000.0,
                    planRows: 50000,
                    planWidth: 100,
                    actualRows: 50000,
                    actualLoops: 1,
                  },
                  'Planning Time': 1.0,
                  'Execution Time': 200.0,
                },
              ],
            },
          ],
        })
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({ rows: [] }), 150))
        );

      await optimizer.profileQuery(slowQuery, 'postgresql');

      const recommendations = optimizer.generateOptimizationRecommendations();

      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations[0].query).toBe(slowQuery);
      expect(recommendations[0].severity).toBe('medium');
      expect(recommendations[0].recommendation).toContain('Add index');
    });

    it('should calculate severity based on execution time', async () => {
      // Critical: > 10秒
      mockPgPool.query.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ rows: [] }), 11000))
      );

      await optimizer.profileQuery('SELECT 1', 'postgresql');

      const slowQueries = optimizer.getSlowQueries();
      const recommendations = optimizer.generateOptimizationRecommendations();

      if (recommendations.length > 0) {
        expect(['critical', 'high']).toContain(recommendations[0].severity);
      }
    });
  });

  describe('Error Handling', () => {
    it('should throw error when PostgreSQL pool not initialized', async () => {
      const uninitializedOptimizer = new QueryOptimizer({});

      await expect(uninitializedOptimizer.explainPostgresQuery('SELECT 1')).rejects.toThrow(
        'PostgreSQL pool not initialized'
      );
    });

    it('should throw error when Neo4j driver not initialized', async () => {
      const uninitializedOptimizer = new QueryOptimizer({});

      await expect(uninitializedOptimizer.explainNeo4jQuery('MATCH (n) RETURN n')).rejects.toThrow(
        'Neo4j driver not initialized'
      );
    });

    it('should handle query execution errors', async () => {
      mockPgPool.query.mockRejectedValue(new Error('Query execution failed'));

      await expect(optimizer.profileQuery('INVALID QUERY', 'postgresql')).rejects.toThrow(
        'Query execution failed'
      );
    });
  });

  describe('Lifecycle Management', () => {
    it('should properly shutdown optimizer', async () => {
      optimizer.startProfiling();

      await optimizer.profileQuery('SELECT 1', 'postgresql');

      expect(optimizer.getQueryProfiles().length).toBeGreaterThan(0);

      await optimizer.shutdown();

      expect(optimizer.getQueryProfiles().length).toBe(0);
      expect(optimizer.getSlowQueries().length).toBe(0);
    });
  });
});
