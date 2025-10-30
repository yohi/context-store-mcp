/**
 * Transaction Coordinator Tests (Task 9.1)
 * テスト対象: PostgreSQL-Neo4j間のトランザクション調整とSagaパターン
 *
 * Requirements: 5.3 (ハイブリッドストレージのフェイルオーバー)
 *
 * TDD Red Phase: まず失敗するテストを作成
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Pool } from 'pg';
import type { Driver } from 'neo4j-driver';
import {
  TransactionCoordinator,
  type MemoryEntity,
  type TransactionResult,
} from '../../storage/transaction-coordinator.js';

describe('TransactionCoordinator - Task 9.1: Saga Pattern', () => {
  let mockPgPool: Pool;
  let mockNeo4jDriver: Driver;
  let coordinator: TransactionCoordinator;

  beforeEach(() => {
    // Mock PostgreSQL Pool
    mockPgPool = {
      query: vi.fn(),
      connect: vi.fn(),
    } as unknown as Pool;

    // Mock Neo4j Driver
    mockNeo4jDriver = {
      session: vi.fn(),
      close: vi.fn(),
    } as unknown as Driver;

    // Initialize coordinator (will fail in Red Phase)
    coordinator = new TransactionCoordinator({
      postgresPool: mockPgPool,
      neo4jDriver: mockNeo4jDriver,
      maxRetries: 3,
      initialDelayMs: 100,
      maxDelayMs: 400,
      backoffMultiplier: 2.0,
    });
  });

  describe('storeMemoryWithSaga', () => {
    it('should successfully store memory in both PostgreSQL and Neo4j', async () => {
      // Arrange
      const memory: MemoryEntity = {
        id: 'test-memory-id-001',
        content: 'Test memory content',
        memoryType: 'procedural', // procedural タイプはNeo4jノードを作成する
        metadata: { source: 'test' },
      };

      // Mock successful PostgreSQL insert
      vi.mocked(mockPgPool.query).mockResolvedValueOnce({
        rows: [{ id: memory.id }],
        command: 'INSERT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      // Mock successful Neo4j node creation
      const mockSession = {
        run: vi.fn().mockResolvedValue({ records: [] }),
        close: vi.fn(),
      };
      vi.mocked(mockNeo4jDriver.session).mockReturnValue(mockSession as never);

      // Act
      const result = await coordinator.storeMemoryWithSaga(memory);

      // Assert
      expect(result.success).toBe(true);
      expect(result.memoryId).toBe(memory.id);
      expect(mockPgPool.query).toHaveBeenCalledTimes(1);
      expect(mockSession.run).toHaveBeenCalledTimes(1);
    });

    it('should handle PostgreSQL failure (PG失敗 → 全体ロールバック)', async () => {
      // Arrange
      const memory: MemoryEntity = {
        id: 'test-memory-id-002',
        content: 'Test memory',
        memoryType: 'episodic',
        metadata: {},
      };

      // Mock PostgreSQL failure (リトライ3回全て失敗)
      vi.mocked(mockPgPool.query).mockRejectedValue(new Error('PG connection failed'));

      // Act
      const result = await coordinator.storeMemoryWithSaga(memory);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('POSTGRESQL_ERROR');
      expect(result.error?.message).toContain('PG connection failed');
      // Neo4jは呼ばれないはず
      expect(mockNeo4jDriver.session).not.toHaveBeenCalled();
    });

    it('should handle Neo4j failure with sync_status marking (PG成功 + Neo4j失敗)', async () => {
      // Arrange
      const memory: MemoryEntity = {
        id: 'test-memory-id-003',
        content: 'Test memory',
        memoryType: 'procedural',
        metadata: {},
      };

      // Mock successful PostgreSQL insert
      vi.mocked(mockPgPool.query)
        .mockResolvedValueOnce({
          rows: [{ id: memory.id }],
          command: 'INSERT',
          rowCount: 1,
          oid: 0,
          fields: [],
        })
        // Mock sync_status update
        .mockResolvedValueOnce({
          rows: [],
          command: 'UPDATE',
          rowCount: 1,
          oid: 0,
          fields: [],
        });

      // Mock Neo4j failure
      const mockSession = {
        run: vi.fn().mockRejectedValue(new Error('Neo4j node creation failed')),
        close: vi.fn(),
      };
      vi.mocked(mockNeo4jDriver.session).mockReturnValue(mockSession as never);

      // Act
      const result = await coordinator.storeMemoryWithSaga(memory);

      // Assert
      expect(result.success).toBe(true); // PostgreSQL成功なので全体は成功
      expect(result.memoryId).toBe(memory.id);
      expect(result.error?.type).toBe('SYNC_FAILURE');
      expect(result.error?.message).toContain('Neo4j');
      // sync_status = 'pending_graph' への更新が呼ばれたか確認
      expect(mockPgPool.query).toHaveBeenCalledTimes(2);
    });

    it('should implement idempotency (同一操作を複数回実行しても安全)', async () => {
      // Arrange
      const memory: MemoryEntity = {
        id: 'test-memory-id-004',
        content: 'Test idempotency',
        memoryType: 'procedural', // Neo4jノード作成をテスト
        metadata: {},
      };

      // Mock PostgreSQL: 2回とも成功（ON CONFLICT DO NOTHINGにより）
      vi.mocked(mockPgPool.query).mockResolvedValue({
        rows: [],
        command: 'INSERT',
        rowCount: 0, // DO NOTHINGなので影響なし
        oid: 0,
        fields: [],
      });

      // Mock Neo4j: 両方とも成功（MERGEにより）
      const mockSession = {
        run: vi.fn().mockResolvedValue({ records: [] }),
        close: vi.fn(),
      };
      vi.mocked(mockNeo4jDriver.session).mockReturnValue(mockSession as never);

      // Act - 1回目
      const result1 = await coordinator.storeMemoryWithSaga(memory);
      expect(result1.success).toBe(true);

      // Act - 2回目（同じIDで再実行）
      const result2 = await coordinator.storeMemoryWithSaga(memory);

      // Assert - べき等性: 2回目も成功とみなす（すでに存在するため）
      expect(result2.success).toBe(true);
      expect(result2.memoryId).toBe(memory.id);
    });
  });

  describe('deleteMemoryWithSaga', () => {
    it('should successfully delete memory from both Neo4j and PostgreSQL', async () => {
      // Arrange
      const memoryId: MemoryId = 'test-memory-id-005';

      // Mock successful Neo4j deletion (依存関係を先に削除)
      const mockSession = {
        run: vi.fn().mockResolvedValue({ records: [] }),
        close: vi.fn(),
      };
      vi.mocked(mockNeo4jDriver.session).mockReturnValue(mockSession as never);

      // Mock successful PostgreSQL soft delete
      vi.mocked(mockPgPool.query).mockResolvedValueOnce({
        rows: [],
        command: 'UPDATE',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      // Act
      const result = await coordinator.deleteMemoryWithSaga(memoryId);

      // Assert
      expect(result.success).toBe(true);
      expect(mockSession.run).toHaveBeenCalledTimes(1);
      expect(mockPgPool.query).toHaveBeenCalledTimes(1);
    });

    it('should handle Neo4j deletion failure gracefully (孤立ノードとして後で清掃)', async () => {
      // Arrange
      const memoryId: MemoryId = 'test-memory-id-006';

      // Mock Neo4j failure
      const mockSession = {
        run: vi.fn().mockRejectedValue(new Error('Neo4j deletion timeout')),
        close: vi.fn(),
      };
      vi.mocked(mockNeo4jDriver.session).mockReturnValue(mockSession as never);

      // Mock successful PostgreSQL deletion
      vi.mocked(mockPgPool.query).mockResolvedValueOnce({
        rows: [],
        command: 'UPDATE',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      // Act
      const result = await coordinator.deleteMemoryWithSaga(memoryId);

      // Assert - PostgreSQLでの削除が成功していれば、操作は成功とみなす
      expect(result.success).toBe(true);
      expect(result.error?.type).toBe('SYNC_FAILURE');
      expect(result.error?.message).toContain('Neo4j');
    });

    it('should rollback if PostgreSQL deletion fails', async () => {
      // Arrange
      const memoryId: MemoryId = 'test-memory-id-007';

      // Mock successful Neo4j deletion
      const mockSession = {
        run: vi.fn().mockResolvedValue({ records: [] }),
        close: vi.fn(),
      };
      vi.mocked(mockNeo4jDriver.session).mockReturnValue(mockSession as never);

      // Mock PostgreSQL failure
      vi.mocked(mockPgPool.query).mockRejectedValueOnce(
        new Error('PostgreSQL connection lost')
      );

      // Act
      const result = await coordinator.deleteMemoryWithSaga(memoryId);

      // Assert - 致命的エラー
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('POSTGRESQL_ERROR');
      expect(result.error?.requiresCompensation).toBe(true);
    });
  });

  describe('Exponential Backoff Retry Policy', () => {
    it('should retry transient errors with exponential backoff (最大3回)', async () => {
      // Arrange
      const memory: MemoryEntity = {
        id: 'test-memory-id-008',
        content: 'Test retry',
        memoryType: 'semantic',
        metadata: {},
      };

      // Mock PostgreSQL: 2回失敗→3回目成功
      vi.mocked(mockPgPool.query)
        .mockRejectedValueOnce(new Error('Transient connection timeout'))
        .mockRejectedValueOnce(new Error('Transient connection timeout'))
        .mockResolvedValueOnce({
          rows: [{ id: memory.id }],
          command: 'INSERT',
          rowCount: 1,
          oid: 0,
          fields: [],
        });

      // Mock Neo4j success
      const mockSession = {
        run: vi.fn().mockResolvedValue({ records: [] }),
        close: vi.fn(),
      };
      vi.mocked(mockNeo4jDriver.session).mockReturnValue(mockSession as never);

      // Act
      const result = await coordinator.storeMemoryWithSaga(memory);

      // Assert
      expect(result.success).toBe(true);
      // 2回のリトライ + 1回の成功 = 合計3回呼ばれる
      expect(mockPgPool.query).toHaveBeenCalledTimes(3);
    });

    it('should fail after max retries exceeded', async () => {
      // Arrange
      const memory: MemoryEntity = {
        id: 'test-memory-id-009',
        content: 'Test max retries',
        memoryType: 'episodic',
        metadata: {},
      };

      // Mock PostgreSQL: 常に失敗
      vi.mocked(mockPgPool.query).mockRejectedValue(new Error('Permanent failure'));

      // Act
      const result = await coordinator.storeMemoryWithSaga(memory);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('POSTGRESQL_ERROR');
      // maxRetries=3なので、合計3回試行される
      expect(mockPgPool.query).toHaveBeenCalledTimes(3);
    });
  });
});
