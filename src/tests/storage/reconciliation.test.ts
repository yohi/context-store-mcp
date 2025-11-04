/**
 * Tests for ReconciliationService (整合性監視と自動修復)
 *
 * Requirements: 5.4, 5.5 - ストレージ間の一貫性監視と自動修復
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { StorageAdapter } from '../../storage/storage-adapter.js';
import type { MemoryId } from '../../types/memory.js';

// ReconciliationServiceをインポート（まだ存在しない）
import { ReconciliationService } from '../../storage/reconciliation-service.js';

describe('ReconciliationService', () => {
  let reconciliationService: ReconciliationService;
  let postgresAdapter: StorageAdapter;
  let neo4jAdapter: any;

  beforeEach(() => {
    // モックストレージアダプター
    postgresAdapter = {
      storeMemory: vi.fn(),
      getMemory: vi.fn(),
      updateMemory: vi.fn(),
      deleteMemory: vi.fn(),
      searchMemories: vi.fn(),
      getAllMemoryIds: vi.fn(),
    } as unknown as StorageAdapter;

    neo4jAdapter = {
      getAllNodeIds: vi.fn(),
      deleteNode: vi.fn(),
      createNode: vi.fn(),
    };

    reconciliationService = new ReconciliationService(postgresAdapter, neo4jAdapter);
  });

  describe('差分検出 (Divergence Detection)', () => {
    it('should detect memories in PostgreSQL but not in Neo4j', async () => {
      const pgIds: MemoryId[] = ['mem-1', 'mem-2', 'mem-3'];
      const neoIds: MemoryId[] = ['mem-1', 'mem-3'];

      vi.mocked(postgresAdapter.getAllMemoryIds).mockResolvedValue(pgIds);
      vi.mocked(neo4jAdapter.getAllNodeIds).mockResolvedValue(neoIds);

      const result = await reconciliationService.detectDivergence();

      expect(result.missingInNeo4j).toEqual(['mem-2']);
      expect(result.missingInPostgres).toEqual([]);
      expect(result.orphanedInNeo4j).toEqual([]);
      expect(result.totalDivergences).toBe(1);
    });

    it('should detect orphaned nodes in Neo4j (not in PostgreSQL)', async () => {
      const pgIds: MemoryId[] = ['mem-1', 'mem-2'];
      const neoIds: MemoryId[] = ['mem-1', 'mem-2', 'mem-orphan'];

      vi.mocked(postgresAdapter.getAllMemoryIds).mockResolvedValue(pgIds);
      vi.mocked(neo4jAdapter.getAllNodeIds).mockResolvedValue(neoIds);

      const result = await reconciliationService.detectDivergence();

      expect(result.orphanedInNeo4j).toEqual(['mem-orphan']);
      expect(result.totalDivergences).toBe(1);
    });

    it('should detect complex divergences (both missing and orphaned)', async () => {
      const pgIds: MemoryId[] = ['mem-1', 'mem-2', 'mem-3', 'mem-4'];
      const neoIds: MemoryId[] = ['mem-1', 'mem-3', 'mem-orphan-1', 'mem-orphan-2'];

      vi.mocked(postgresAdapter.getAllMemoryIds).mockResolvedValue(pgIds);
      vi.mocked(neo4jAdapter.getAllNodeIds).mockResolvedValue(neoIds);

      const result = await reconciliationService.detectDivergence();

      expect(result.missingInNeo4j).toEqual(['mem-2', 'mem-4']);
      expect(result.orphanedInNeo4j).toEqual(['mem-orphan-1', 'mem-orphan-2']);
      expect(result.totalDivergences).toBe(4);
    });

    it('should return zero divergences when stores are consistent', async () => {
      const ids: MemoryId[] = ['mem-1', 'mem-2', 'mem-3'];

      vi.mocked(postgresAdapter.getAllMemoryIds).mockResolvedValue(ids);
      vi.mocked(neo4jAdapter.getAllNodeIds).mockResolvedValue(ids);

      const result = await reconciliationService.detectDivergence();

      expect(result.missingInNeo4j).toEqual([]);
      expect(result.orphanedInNeo4j).toEqual([]);
      expect(result.totalDivergences).toBe(0);
      expect(result.isConsistent).toBe(true);
    });
  });

  describe('自動修復 (Auto-Repair)', () => {
    it('should create missing Neo4j nodes from PostgreSQL data', async () => {
      const missingId: MemoryId = 'mem-missing';
      const memoryData = {
        id: missingId,
        content: 'Missing memory',
        memoryType: 'semantic' as const,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(postgresAdapter.getMemory).mockResolvedValue(memoryData);
      vi.mocked(neo4jAdapter.createNode).mockResolvedValue(undefined);

      const result = await reconciliationService.repairMissingInNeo4j([missingId]);

      expect(postgresAdapter.getMemory).toHaveBeenCalledWith(missingId);
      expect(neo4jAdapter.createNode).toHaveBeenCalledWith(
        'Memory',
        expect.objectContaining({
          id: missingId,
          type: 'semantic',
        })
      );
      expect(result.repairedCount).toBe(1);
      expect(result.failedIds).toEqual([]);
    });

    it('should delete orphaned Neo4j nodes', async () => {
      const orphanedIds: MemoryId[] = ['orphan-1', 'orphan-2'];

      vi.mocked(neo4jAdapter.deleteNode).mockResolvedValue(true);

      const result = await reconciliationService.repairOrphanedInNeo4j(orphanedIds);

      expect(neo4jAdapter.deleteNode).toHaveBeenCalledTimes(2);
      expect(neo4jAdapter.deleteNode).toHaveBeenCalledWith('orphan-1');
      expect(neo4jAdapter.deleteNode).toHaveBeenCalledWith('orphan-2');
      expect(result.deletedCount).toBe(2);
      expect(result.failedIds).toEqual([]);
    });

    it('should handle partial failures during repair', async () => {
      const missingIds: MemoryId[] = ['mem-1', 'mem-2', 'mem-3'];

      vi.mocked(postgresAdapter.getMemory)
        .mockResolvedValueOnce({
          id: 'mem-1',
          content: 'Memory 1',
          memoryType: 'semantic' as const,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .mockResolvedValueOnce(null) // mem-2 not found
        .mockResolvedValueOnce({
          id: 'mem-3',
          content: 'Memory 3',
          memoryType: 'episodic' as const,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      vi.mocked(neo4jAdapter.createNode).mockResolvedValue(undefined);

      const result = await reconciliationService.repairMissingInNeo4j(missingIds);

      expect(result.repairedCount).toBe(2);
      expect(result.failedIds).toEqual(['mem-2']);
    });

    it('should rollback on Neo4j creation failure', async () => {
      const missingId: MemoryId = 'mem-fail';

      vi.mocked(postgresAdapter.getMemory).mockResolvedValue({
        id: missingId,
        content: 'Memory',
        memoryType: 'semantic' as const,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(neo4jAdapter.createNode).mockRejectedValue(new Error('Neo4j connection failed'));

      const result = await reconciliationService.repairMissingInNeo4j([missingId]);

      expect(result.repairedCount).toBe(0);
      expect(result.failedIds).toEqual([missingId]);
    });
  });

  describe('整合性レポート生成 (Consistency Reporting)', () => {
    it('should generate comprehensive consistency report', async () => {
      const pgIds: MemoryId[] = ['mem-1', 'mem-2', 'mem-3'];
      const neoIds: MemoryId[] = ['mem-1', 'mem-3', 'orphan-1'];

      vi.mocked(postgresAdapter.getAllMemoryIds).mockResolvedValue(pgIds);
      vi.mocked(neo4jAdapter.getAllNodeIds).mockResolvedValue(neoIds);

      const report = await reconciliationService.generateConsistencyReport();

      expect(report).toMatchObject({
        checkedAt: expect.any(Date),
        totalPostgresMemories: 3,
        totalNeo4jNodes: 3,
        missingInNeo4j: ['mem-2'],
        orphanedInNeo4j: ['orphan-1'],
        totalDivergences: 2,
        isConsistent: false,
        consistencyPercentage: expect.any(Number),
      });
    });

    it('should calculate consistency percentage correctly', async () => {
      const pgIds: MemoryId[] = ['mem-1', 'mem-2', 'mem-3', 'mem-4', 'mem-5'];
      const neoIds: MemoryId[] = ['mem-1', 'mem-2', 'mem-3', 'mem-4', 'mem-5'];

      vi.mocked(postgresAdapter.getAllMemoryIds).mockResolvedValue(pgIds);
      vi.mocked(neo4jAdapter.getAllNodeIds).mockResolvedValue(neoIds);

      const report = await reconciliationService.generateConsistencyReport();

      expect(report.consistencyPercentage).toBe(100);
      expect(report.isConsistent).toBe(true);
    });

    it('should handle empty databases gracefully', async () => {
      vi.mocked(postgresAdapter.getAllMemoryIds).mockResolvedValue([]);
      vi.mocked(neo4jAdapter.getAllNodeIds).mockResolvedValue([]);

      const report = await reconciliationService.generateConsistencyReport();

      expect(report.totalPostgresMemories).toBe(0);
      expect(report.totalNeo4jNodes).toBe(0);
      expect(report.isConsistent).toBe(true);
      expect(report.consistencyPercentage).toBe(100);
    });
  });

  describe('アラート発火 (Alert Triggering)', () => {
    it('should trigger alert when divergence exceeds threshold', async () => {
      const pgIds: MemoryId[] = Array.from({ length: 100 }, (_, i) => `mem-${i}`);
      const neoIds: MemoryId[] = Array.from({ length: 85 }, (_, i) => `mem-${i}`); // 15% divergence

      vi.mocked(postgresAdapter.getAllMemoryIds).mockResolvedValue(pgIds);
      vi.mocked(neo4jAdapter.getAllNodeIds).mockResolvedValue(neoIds);

      const shouldAlert = await reconciliationService.shouldTriggerAlert({ threshold: 10 });

      expect(shouldAlert).toBe(true);
    });

    it('should not trigger alert when divergence is below threshold', async () => {
      const pgIds: MemoryId[] = Array.from({ length: 100 }, (_, i) => `mem-${i}`);
      const neoIds: MemoryId[] = Array.from({ length: 95 }, (_, i) => `mem-${i}`); // 5% divergence

      vi.mocked(postgresAdapter.getAllMemoryIds).mockResolvedValue(pgIds);
      vi.mocked(neo4jAdapter.getAllNodeIds).mockResolvedValue(neoIds);

      const shouldAlert = await reconciliationService.shouldTriggerAlert({ threshold: 10 });

      expect(shouldAlert).toBe(false);
    });
  });

  describe('統合修復 (Full Reconciliation)', () => {
    it('should perform full reconciliation with repair', async () => {
      const pgIdsBefore: MemoryId[] = ['mem-1', 'mem-2', 'mem-3'];
      const neoIdsBefore: MemoryId[] = ['mem-1', 'orphan-1'];
      const idsAfterRepair: MemoryId[] = ['mem-1', 'mem-2', 'mem-3']; // All in sync after repair

      // First call (detectDivergence in performFullReconciliation)
      vi.mocked(postgresAdapter.getAllMemoryIds).mockResolvedValueOnce(pgIdsBefore);
      vi.mocked(neo4jAdapter.getAllNodeIds).mockResolvedValueOnce(neoIdsBefore);

      // Second and third calls (getAllMemoryIds in generateConsistencyReport)
      vi.mocked(postgresAdapter.getAllMemoryIds).mockResolvedValueOnce(idsAfterRepair);
      vi.mocked(neo4jAdapter.getAllNodeIds).mockResolvedValueOnce(idsAfterRepair);

      // Fourth and fifth calls (detectDivergence inside generateConsistencyReport)
      vi.mocked(postgresAdapter.getAllMemoryIds).mockResolvedValueOnce(idsAfterRepair);
      vi.mocked(neo4jAdapter.getAllNodeIds).mockResolvedValueOnce(idsAfterRepair);

      vi.mocked(postgresAdapter.getMemory)
        .mockResolvedValueOnce({
          id: 'mem-2',
          content: 'Memory 2',
          memoryType: 'semantic' as const,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'mem-3',
          content: 'Memory 3',
          memoryType: 'episodic' as const,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      vi.mocked(neo4jAdapter.createNode).mockResolvedValue(undefined);
      vi.mocked(neo4jAdapter.deleteNode).mockResolvedValue(true);

      const result = await reconciliationService.performFullReconciliation({ autoRepair: true });

      expect(result.divergencesBefore).toBe(3);
      expect(result.repaired).toBe(3);
      expect(result.divergencesAfter).toBe(0);
      expect(result.isConsistent).toBe(true);
    });

    it('should only detect divergences without auto-repair', async () => {
      const pgIds: MemoryId[] = ['mem-1', 'mem-2'];
      const neoIds: MemoryId[] = ['mem-1', 'orphan-1'];

      vi.mocked(postgresAdapter.getAllMemoryIds).mockResolvedValue(pgIds);
      vi.mocked(neo4jAdapter.getAllNodeIds).mockResolvedValue(neoIds);

      const result = await reconciliationService.performFullReconciliation({ autoRepair: false });

      expect(result.divergencesBefore).toBe(2);
      expect(result.repaired).toBe(0);
      expect(result.divergencesAfter).toBe(2);
      expect(postgresAdapter.getMemory).not.toHaveBeenCalled();
      expect(neo4jAdapter.createNode).not.toHaveBeenCalled();
      expect(neo4jAdapter.deleteNode).not.toHaveBeenCalled();
    });
  });
});
