/**
 * Failover Manager Test
 *
 * タスク9.2: フェイルオーバーとエラーリカバリー
 * - コンポーネント別フェイルオーバーモード
 * - サーキットブレーカーパターン
 * - 読み取り専用モードへの自動切り替え
 * - グラフ機能の無効化
 *
 * Requirements: 5.3 (ハイブリッドストレージのフェイルオーバーとエラーリカバリー)
 * Design Reference: design.md - フェイルオーバーモードとフォールバック動作
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Pool } from 'pg';
import type { Driver } from 'neo4j-driver';
import { CircuitBreaker } from '../../storage/circuit-breaker.js';
import { FailoverManager, OperationMode } from '../../storage/failover-manager.js';

describe('FailoverManager - Task 9.2: Failover and Error Recovery', () => {
  let mockPgPool: Pool;
  let mockNeo4jDriver: Driver;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock PostgreSQL Pool
    mockPgPool = {
      query: vi.fn(),
      connect: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    } as unknown as Pool;

    // Mock Neo4j Driver
    mockNeo4jDriver = {
      session: vi.fn(),
      close: vi.fn(),
      verifyConnectivity: vi.fn(),
    } as unknown as Driver;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Circuit Breaker Pattern', () => {
    it('should open circuit after 5 consecutive failures', async () => {
      // Arrange
      const circuitBreaker = new CircuitBreaker({ failureThreshold: 5, timeout: 30000 });

      // Act: 5回連続で失敗させる
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('Connection failed');
          });
        } catch (error) {
          // エラーを無視して続行
        }
      }

      // Assert
      expect(circuitBreaker.getState()).toBe('OPEN');
    });

    it('should reject requests immediately when circuit is OPEN', async () => {
      // Arrange
      const circuitBreaker = new CircuitBreaker({ failureThreshold: 5, timeout: 30000 });

      // 5回失敗させてサーキットをOPENにする
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('Connection failed');
          });
        } catch (error) {
          // エラーを無視
        }
      }

      // Act & Assert
      await expect(circuitBreaker.execute(async () => 'success')).rejects.toThrow('Circuit breaker is OPEN');
    });

    it('should transition to HALF_OPEN after timeout', async () => {
      // Arrange
      const circuitBreaker = new CircuitBreaker({ failureThreshold: 5, timeout: 100 });

      // 5回失敗させてサーキットをOPENにする
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('Connection failed');
          });
        } catch (error) {
          // エラーを無視
        }
      }

      // Act: 100ms待機
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Assert
      expect(circuitBreaker.getState()).toBe('HALF_OPEN');
    });

    it('should close circuit after 2 consecutive successes in HALF_OPEN', async () => {
      // Arrange
      const circuitBreaker = new CircuitBreaker({ failureThreshold: 5, timeout: 100, successThreshold: 2 });

      // 5回失敗させてOPENにし、100ms待機してHALF_OPENに
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('Connection failed');
          });
        } catch (error) {
          // エラーを無視
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Act: 2回成功させる
      await circuitBreaker.execute(async () => 'success 1');
      await circuitBreaker.execute(async () => 'success 2');

      // Assert
      expect(circuitBreaker.getState()).toBe('CLOSED');
    });

    it('should reopen circuit if failure occurs in HALF_OPEN', async () => {
      // Arrange
      const circuitBreaker = new CircuitBreaker({ failureThreshold: 5, timeout: 100 });

      // 5回失敗させてOPENにし、100ms待機してHALF_OPENに
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('Connection failed');
          });
        } catch (error) {
          // エラーを無視
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Act: HALF_OPEN状態で失敗
      try {
        await circuitBreaker.execute(async () => {
          throw new Error('Connection failed again');
        });
      } catch (error) {
        // エラーを無視
      }

      // Assert
      expect(circuitBreaker.getState()).toBe('OPEN');
    });
  });

  describe('PostgreSQL Failover Mode', () => {
    it('should enter read-only mode when PostgreSQL connection fails', async () => {
      // Arrange
      const failoverManager = new FailoverManager({ postgresPool: mockPgPool, neo4jDriver: mockNeo4jDriver });

      // Act
      await failoverManager.handlePostgresFailure();

      // Assert
      expect(failoverManager.getMode()).toBe(OperationMode.READ_ONLY);
      expect(failoverManager.isPostgresAvailable()).toBe(false);
    });

    it('should return metadata from Neo4j in read-only mode', async () => {
      // Arrange
      const failoverManager = new FailoverManager({ postgresPool: mockPgPool, neo4jDriver: mockNeo4jDriver });
      await failoverManager.handlePostgresFailure();

      // Mock Neo4j session
      const mockSession = {
        run: vi.fn().mockResolvedValue({
          records: [
            {
              get: (key: string) => {
                if (key === 'id') return 'memory-001';
                if (key === 'type') return 'episodic';
                if (key === 'created_at') return new Date();
              },
            },
          ],
        }),
        close: vi.fn(),
      };
      vi.mocked(mockNeo4jDriver.session).mockReturnValue(mockSession as never);

      // Act
      const metadata = await failoverManager.getMemoryMetadata('memory-001');

      // Assert
      expect(metadata.id).toBe('memory-001');
      expect(metadata.type).toBe('episodic');
      expect(metadata.warning).toBe('Vector search unavailable (PostgreSQL offline)');
    });

    it('should reject write operations in read-only mode', async () => {
      // Arrange
      const failoverManager = new FailoverManager({ postgresPool: mockPgPool, neo4jDriver: mockNeo4jDriver });
      await failoverManager.handlePostgresFailure();

      // Act & Assert
      await expect(failoverManager.storeMemory({ id: 'mem-001', content: 'test' })).rejects.toThrow(
        'Write operations not available in READ_ONLY mode'
      );
    });

    it('should recover from read-only mode when PostgreSQL becomes available', async () => {
      // Arrange
      const failoverManager = new FailoverManager({ postgresPool: mockPgPool, neo4jDriver: mockNeo4jDriver });
      await failoverManager.handlePostgresFailure();

      // Mock PostgreSQL recovery
      vi.mocked(mockPgPool.query).mockResolvedValue({ rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] });

      // Act
      await failoverManager.checkPostgresHealth();

      // Assert
      expect(failoverManager.getMode()).toBe(OperationMode.NORMAL);
      expect(failoverManager.isPostgresAvailable()).toBe(true);
    });
  });

  describe('Neo4j Failover Mode', () => {
    it('should disable graph features when Neo4j connection fails', async () => {
      // Arrange
      const failoverManager = new FailoverManager({ postgresPool: mockPgPool, neo4jDriver: mockNeo4jDriver });

      // Act
      await failoverManager.handleNeo4jFailure();

      // Assert
      expect(failoverManager.isGraphAvailable()).toBe(false);
      expect(failoverManager.getMode()).toBe(OperationMode.GRAPH_DISABLED);
    });

    it('should perform flat search when graph is unavailable', async () => {
      // Arrange
      const failoverManager = new FailoverManager({ postgresPool: mockPgPool, neo4jDriver: mockNeo4jDriver });
      await failoverManager.handleNeo4jFailure();

      // Mock PostgreSQL query for flat search
      vi.mocked(mockPgPool.query).mockResolvedValue({
        rows: [{ id: 'mem-001', content: 'Test memory', memory_type: 'semantic' }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      // Act
      const results = await failoverManager.searchMemories('test query');

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0].warning).toBe('Graph relationships unavailable (Neo4j offline)');
    });

    it('should mark sync_status as pending_graph for new memories when Neo4j is down', async () => {
      // Arrange
      const failoverManager = new FailoverManager({ postgresPool: mockPgPool, neo4jDriver: mockNeo4jDriver });
      await failoverManager.handleNeo4jFailure();

      // Mock PostgreSQL success for INSERT and UPDATE
      vi.mocked(mockPgPool.query)
        .mockResolvedValueOnce({
          rows: [{ id: 'mem-002' }],
          command: 'INSERT',
          rowCount: 1,
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [],
          command: 'UPDATE',
          rowCount: 1,
          oid: 0,
          fields: [],
        });

      // Mock Neo4j session (will fail due to GRAPH_DISABLED mode)
      const mockSession = {
        run: vi.fn().mockRejectedValue(new Error('Neo4j connection refused')),
        close: vi.fn(),
      };
      vi.mocked(mockNeo4jDriver.session).mockReturnValue(mockSession as never);

      // Act
      const result = await failoverManager.storeMemory({ id: 'mem-002', content: 'test', memoryType: 'procedural' });

      // Assert
      expect(result.success).toBe(true);
      expect(result.syncStatus).toBe('pending_graph');
    });
  });

  describe('Total System Failure', () => {
    it('should reject all requests when both PostgreSQL and Neo4j are down', async () => {
      // Arrange
      const failoverManager = new FailoverManager({ postgresPool: mockPgPool, neo4jDriver: mockNeo4jDriver });

      // Mock both failures
      await failoverManager.handlePostgresFailure();
      await failoverManager.handleNeo4jFailure();

      // Act & Assert
      await expect(failoverManager.storeMemory({ id: 'mem-003', content: 'test' })).rejects.toThrow(
        'Context Store temporarily unavailable'
      );
      await expect(failoverManager.searchMemories('test')).rejects.toThrow('Context Store temporarily unavailable');
    });
  });

  describe('Health Check Integration', () => {
    it('should periodically check component health', async () => {
      // Arrange
      const failoverManager = new FailoverManager({
        postgresPool: mockPgPool,
        neo4jDriver: mockNeo4jDriver,
        healthCheckInterval: 100,
        enableAutoHealthCheck: true,
      });

      // Mock health check responses
      vi.mocked(mockPgPool.query).mockResolvedValue({ rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] });
      vi.mocked(mockNeo4jDriver.verifyConnectivity).mockResolvedValue(undefined);

      // Act: 250ms待機（2回のヘルスチェックが実行される）
      await new Promise((resolve) => setTimeout(resolve, 250));

      // Assert
      expect(mockPgPool.query).toHaveBeenCalled();
      expect(mockNeo4jDriver.verifyConnectivity).toHaveBeenCalled();

      // Cleanup
      await failoverManager.cleanup();
    });
  });
});
