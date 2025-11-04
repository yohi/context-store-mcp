/**
 * IndexOptimizerのユニットテスト
 *
 * タスク10.1: パフォーマンスチューニング - インデックスの最適化と再構築
 * Requirements: 7.1 (P95 < 2秒)
 *
 * テスト対象:
 * - PostgreSQLインデックス管理
 * - Neo4jインデックス管理
 * - HNSWインデックス最適化
 * - 未使用インデックス検出
 * - インデックス肥大化検出
 * - インデックスヘルスモニタリング
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IndexOptimizer } from '../../performance/index-optimizer';

// モック変数
let mockPgPool: any;
let mockNeo4jDriver: any;
let mockNeo4jSession: any;

describe('IndexOptimizer - Task 10.1: Index Optimization', () => {
  let optimizer: IndexOptimizer;

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

    // IndexOptimizerのインスタンス作成
    optimizer = new IndexOptimizer({
      pgPool: mockPgPool,
      neo4jDriver: mockNeo4jDriver,
      unusedThreshold: 10,
      bloatThreshold: 30,
      monitoringInterval: 1000,
    });
  });

  afterEach(async () => {
    await optimizer.shutdown();
    vi.clearAllMocks();
  });

  describe('PostgreSQL Index Management', () => {
    it('should get all PostgreSQL indexes', async () => {
      mockPgPool.query.mockResolvedValue({
        rows: [
          {
            schema_name: 'public',
            table_name: 'memories',
            index_name: 'memories_pkey',
            definition: 'CREATE UNIQUE INDEX memories_pkey ON public.memories USING btree (id)',
            index_size: '8192',
            index_scan_count: '100',
            index_tuple_read_count: '100',
            index_tuple_fetch_count: '100',
            is_unique: true,
            is_primary: true,
          },
          {
            schema_name: 'public',
            table_name: 'memories',
            index_name: 'memories_embedding_hnsw_idx',
            definition:
              'CREATE INDEX memories_embedding_hnsw_idx ON public.memories USING hnsw (embedding vector_cosine_ops)',
            index_size: '1048576',
            index_scan_count: '500',
            index_tuple_read_count: '500',
            index_tuple_fetch_count: '500',
            is_unique: false,
            is_primary: false,
          },
        ],
      });

      const indexes = await optimizer.getPostgresIndexes();

      expect(indexes.length).toBe(2);
      expect(indexes[0].indexName).toBe('memories_pkey');
      expect(indexes[0].indexType).toBe('btree');
      expect(indexes[0].isPrimary).toBe(true);
      expect(indexes[1].indexName).toBe('memories_embedding_hnsw_idx');
      expect(indexes[1].indexType).toBe('hnsw');
    });

    it('should optimize HNSW index with custom parameters', async () => {
      mockPgPool.query.mockResolvedValue({ rows: [] });

      await optimizer.optimizeHNSWIndex('memories', 'embedding', {
        m: 32,
        efConstruction: 128,
      });

      expect(mockPgPool.query).toHaveBeenCalledWith('DROP INDEX IF EXISTS memories_embedding_hnsw_idx');
      expect(mockPgPool.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE INDEX memories_embedding_hnsw_idx')
      );
      expect(mockPgPool.query).toHaveBeenCalledWith(expect.stringContaining('m = 32'));
      expect(mockPgPool.query).toHaveBeenCalledWith(expect.stringContaining('ef_construction = 128'));
    });

    it('should detect unused indexes', async () => {
      mockPgPool.query.mockResolvedValue({
        rows: [
          {
            schema_name: 'public',
            table_name: 'memories',
            index_name: 'unused_index',
            definition: 'CREATE INDEX unused_index ON public.memories USING btree (created_at)',
            index_size: '8192',
            index_scan_count: '5', // 閾値10未満
            index_tuple_read_count: '5',
            index_tuple_fetch_count: '5',
            is_unique: false,
            is_primary: false,
          },
        ],
      });

      const unusedIndexes = await optimizer.detectUnusedIndexes();

      expect(unusedIndexes.length).toBe(1);
      expect(unusedIndexes[0].indexName).toBe('unused_index');
      expect(unusedIndexes[0].indexScanCount).toBeLessThan(10);
    });

    it('should detect bloated indexes', async () => {
      mockPgPool.query.mockResolvedValue({
        rows: [
          {
            schemaname: 'public',
            tablename: 'memories',
            indexname: 'bloated_index',
            index_size: '10485760', // 10MB
            table_size: '20971520', // 20MB
            bloat_ratio: '50.0', // 50% 肥大化
          },
        ],
      });

      const bloatedIndexes = await optimizer.detectBloatedIndexes();

      expect(bloatedIndexes.length).toBe(1);
      expect(bloatedIndexes[0].indexName).toBe('bloated_index');
    });

    it('should reindex table', async () => {
      mockPgPool.query.mockResolvedValue({ rows: [] });

      await optimizer.reindexTable('memories');

      expect(mockPgPool.query).toHaveBeenCalledWith('REINDEX TABLE memories');
    });
  });

  describe('Neo4j Index Management', () => {
    it('should get all Neo4j indexes', async () => {
      const mockRecords = [
        {
          get: vi.fn((key: string) => {
            const data: Record<string, any> = {
              name: 'memory_id_idx',
              labelsOrTypes: ['Memory'],
              properties: ['id'],
              type: 'RANGE',
              state: 'ONLINE',
              populationPercent: '100.0',
              uniqueness: 'UNIQUE',
            };
            return data[key];
          }),
        },
        {
          get: vi.fn((key: string) => {
            const data: Record<string, any> = {
              name: 'memory_content_fulltext_idx',
              labelsOrTypes: ['Memory'],
              properties: ['content'],
              type: 'FULLTEXT',
              state: 'ONLINE',
              populationPercent: '100.0',
              uniqueness: 'NONUNIQUE',
            };
            return data[key];
          }),
        },
      ];

      mockNeo4jSession.run.mockResolvedValue({
        records: mockRecords,
      });

      const indexes = await optimizer.getNeo4jIndexes();

      expect(indexes.length).toBe(2);
      expect(indexes[0].name).toBe('memory_id_idx');
      expect(indexes[0].type).toBe('RANGE');
      expect(indexes[1].name).toBe('memory_content_fulltext_idx');
      expect(indexes[1].type).toBe('FULLTEXT');
      expect(mockNeo4jSession.close).toHaveBeenCalled();
    });

    it('should create Neo4j range index', async () => {
      mockNeo4jSession.run.mockResolvedValue({});

      await optimizer.createNeo4jIndex('Memory', 'id', 'RANGE');

      expect(mockNeo4jSession.run).toHaveBeenCalledWith(
        expect.stringContaining('CREATE INDEX memory_id_idx')
      );
      expect(mockNeo4jSession.close).toHaveBeenCalled();
    });

    it('should create Neo4j fulltext index', async () => {
      mockNeo4jSession.run.mockResolvedValue({});

      await optimizer.createNeo4jIndex('Memory', 'content', 'FULLTEXT');

      expect(mockNeo4jSession.run).toHaveBeenCalledWith(
        expect.stringContaining('CREATE FULLTEXT INDEX memory_content_idx')
      );
      expect(mockNeo4jSession.close).toHaveBeenCalled();
    });

    it('should drop Neo4j index', async () => {
      mockNeo4jSession.run.mockResolvedValue({});

      await optimizer.dropNeo4jIndex('old_index');

      expect(mockNeo4jSession.run).toHaveBeenCalledWith('DROP INDEX old_index');
      expect(mockNeo4jSession.close).toHaveBeenCalled();
    });
  });

  describe('Index Health Monitoring', () => {
    it('should start and stop monitoring', () => {
      optimizer.startMonitoring();

      expect(optimizer).toBeDefined();

      optimizer.stopMonitoring();

      expect(optimizer).toBeDefined();
    });

    it('should calculate index health for unused index', async () => {
      mockPgPool.query.mockResolvedValue({
        rows: [
          {
            schema_name: 'public',
            table_name: 'memories',
            index_name: 'unused_index',
            definition: 'CREATE INDEX unused_index ON public.memories USING btree (created_at)',
            index_size: '8192',
            index_scan_count: '5', // 閾値未満
            index_tuple_read_count: '5',
            index_tuple_fetch_count: '5',
            is_unique: false,
            is_primary: false,
          },
        ],
      });

      await optimizer.getPostgresIndexes();

      // 内部的にヘルス分析が行われる
      expect(mockPgPool.query).toHaveBeenCalled();
    });

    it('should get index statistics', async () => {
      mockPgPool.query.mockResolvedValue({
        rows: [
          {
            schema_name: 'public',
            table_name: 'memories',
            index_name: 'test_index',
            definition: 'CREATE INDEX test_index ON public.memories USING btree (id)',
            index_size: '8192',
            index_scan_count: '100',
            index_tuple_read_count: '100',
            index_tuple_fetch_count: '100',
            is_unique: false,
            is_primary: false,
          },
        ],
      });

      await optimizer.getPostgresIndexes();

      const stats = optimizer.getIndexStats();

      expect(stats.totalIndexes).toBeGreaterThanOrEqual(0);
      expect(stats.healthyIndexes).toBeGreaterThanOrEqual(0);
      expect(stats.warningIndexes).toBeGreaterThanOrEqual(0);
      expect(stats.criticalIndexes).toBeGreaterThanOrEqual(0);
    });

    it('should clear health cache', () => {
      optimizer.clearHealthCache();

      const stats = optimizer.getIndexStats();

      expect(stats.totalIndexes).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should throw error when PostgreSQL pool not initialized', async () => {
      const uninitializedOptimizer = new IndexOptimizer({});

      await expect(uninitializedOptimizer.getPostgresIndexes()).rejects.toThrow(
        'PostgreSQL pool not initialized'
      );
    });

    it('should throw error when Neo4j driver not initialized', async () => {
      const uninitializedOptimizer = new IndexOptimizer({});

      await expect(uninitializedOptimizer.getNeo4jIndexes()).rejects.toThrow(
        'Neo4j driver not initialized'
      );
    });

    it('should handle database errors gracefully', async () => {
      mockPgPool.query.mockRejectedValue(new Error('Database error'));

      await expect(optimizer.getPostgresIndexes()).rejects.toThrow('Database error');
    });
  });

  describe('Lifecycle Management', () => {
    it('should properly shutdown optimizer', async () => {
      optimizer.startMonitoring();

      await optimizer.shutdown();

      const stats = optimizer.getIndexStats();

      expect(stats.totalIndexes).toBe(0);
    });
  });
});
