/**
 * Tests for ScheduledReconciliationJob (定期整合性チェックジョブ)
 *
 * Requirements: 5.4, 5.5 - ストレージ間の一貫性監視と自動修復
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ScheduledReconciliationJob } from '../../storage/scheduled-reconciliation-job.js';
import type { ReconciliationService } from '../../storage/reconciliation-service.js';

describe('ScheduledReconciliationJob', () => {
  let scheduledJob: ScheduledReconciliationJob;
  let reconciliationService: ReconciliationService;
  let mockAlertHandler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // モックReconciliationService
    reconciliationService = {
      detectDivergence: vi.fn(),
      performFullReconciliation: vi.fn(),
      shouldTriggerAlert: vi.fn(),
      generateConsistencyReport: vi.fn(),
    } as unknown as ReconciliationService;

    mockAlertHandler = vi.fn();

    scheduledJob = new ScheduledReconciliationJob(reconciliationService, {
      interval: 1000, // 1秒（テスト用）
      autoRepair: true,
      alertThreshold: 10,
      alertHandler: mockAlertHandler,
    });
  });

  afterEach(() => {
    scheduledJob.stop();
  });

  describe('ジョブ設定 (Job Configuration)', () => {
    it('should create job with default configuration', () => {
      const defaultJob = new ScheduledReconciliationJob(reconciliationService);

      expect(defaultJob.getConfig()).toMatchObject({
        interval: 3600000, // 1時間（デフォルト）
        autoRepair: false, // デフォルトは検出のみ
        alertThreshold: 10, // 10%
      });
    });

    it('should create job with custom configuration', () => {
      const config = scheduledJob.getConfig();

      expect(config.interval).toBe(1000);
      expect(config.autoRepair).toBe(true);
      expect(config.alertThreshold).toBe(10);
    });
  });

  describe('ジョブ実行 (Job Execution)', () => {
    it('should execute reconciliation check', async () => {
      vi.mocked(reconciliationService.performFullReconciliation).mockResolvedValue({
        divergencesBefore: 0,
        repaired: 0,
        divergencesAfter: 0,
        isConsistent: true,
        report: {
          checkedAt: new Date(),
          totalPostgresMemories: 100,
          totalNeo4jNodes: 100,
          missingInNeo4j: [],
          orphanedInNeo4j: [],
          totalDivergences: 0,
          isConsistent: true,
          consistencyPercentage: 100,
        },
      });

      await scheduledJob.runOnce();

      expect(reconciliationService.performFullReconciliation).toHaveBeenCalledWith({
        autoRepair: true,
      });
    });

    it('should trigger alert when threshold exceeded', async () => {
      vi.mocked(reconciliationService.performFullReconciliation).mockResolvedValue({
        divergencesBefore: 15,
        repaired: 5,
        divergencesAfter: 10,
        isConsistent: false,
        report: {
          checkedAt: new Date(),
          totalPostgresMemories: 100,
          totalNeo4jNodes: 90,
          missingInNeo4j: ['mem-1', 'mem-2'],
          orphanedInNeo4j: [],
          totalDivergences: 10,
          isConsistent: false,
          consistencyPercentage: 90,
        },
      });

      vi.mocked(reconciliationService.shouldTriggerAlert).mockResolvedValue(true);

      await scheduledJob.runOnce();

      expect(mockAlertHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          divergenceCount: 10,
          consistencyPercentage: 90,
        })
      );
    });

    it('should not trigger alert when threshold not exceeded', async () => {
      vi.mocked(reconciliationService.performFullReconciliation).mockResolvedValue({
        divergencesBefore: 5,
        repaired: 5,
        divergencesAfter: 0,
        isConsistent: true,
        report: {
          checkedAt: new Date(),
          totalPostgresMemories: 100,
          totalNeo4jNodes: 100,
          missingInNeo4j: [],
          orphanedInNeo4j: [],
          totalDivergences: 0,
          isConsistent: true,
          consistencyPercentage: 100,
        },
      });

      vi.mocked(reconciliationService.shouldTriggerAlert).mockResolvedValue(false);

      await scheduledJob.runOnce();

      expect(mockAlertHandler).not.toHaveBeenCalled();
    });
  });

  describe('ジョブスケジューリング (Job Scheduling)', () => {
    it('should start and stop scheduled job', async () => {
      vi.useFakeTimers();

      vi.mocked(reconciliationService.performFullReconciliation).mockResolvedValue({
        divergencesBefore: 0,
        repaired: 0,
        divergencesAfter: 0,
        isConsistent: true,
        report: {
          checkedAt: new Date(),
          totalPostgresMemories: 100,
          totalNeo4jNodes: 100,
          missingInNeo4j: [],
          orphanedInNeo4j: [],
          totalDivergences: 0,
          isConsistent: true,
          consistencyPercentage: 100,
        },
      });

      scheduledJob.start();

      // 1秒経過（1回目の実行）
      await vi.advanceTimersByTimeAsync(1000);
      expect(reconciliationService.performFullReconciliation).toHaveBeenCalledTimes(1);

      // さらに1秒経過（2回目の実行）
      await vi.advanceTimersByTimeAsync(1000);
      expect(reconciliationService.performFullReconciliation).toHaveBeenCalledTimes(2);

      // ジョブ停止
      scheduledJob.stop();

      // さらに1秒経過（実行されない）
      await vi.advanceTimersByTimeAsync(1000);
      expect(reconciliationService.performFullReconciliation).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should not start job twice', async () => {
      vi.useFakeTimers();

      vi.mocked(reconciliationService.performFullReconciliation).mockResolvedValue({
        divergencesBefore: 0,
        repaired: 0,
        divergencesAfter: 0,
        isConsistent: true,
        report: {
          checkedAt: new Date(),
          totalPostgresMemories: 100,
          totalNeo4jNodes: 100,
          missingInNeo4j: [],
          orphanedInNeo4j: [],
          totalDivergences: 0,
          isConsistent: true,
          consistencyPercentage: 100,
        },
      });

      scheduledJob.start();
      scheduledJob.start(); // 2回目の呼び出し（無視される）

      await vi.advanceTimersByTimeAsync(1000);
      expect(reconciliationService.performFullReconciliation).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  describe('統計情報 (Statistics)', () => {
    it('should track execution statistics', async () => {
      vi.mocked(reconciliationService.performFullReconciliation)
        .mockResolvedValueOnce({
          divergencesBefore: 10,
          repaired: 10,
          divergencesAfter: 0,
          isConsistent: true,
          report: {
            checkedAt: new Date(),
            totalPostgresMemories: 100,
            totalNeo4jNodes: 100,
            missingInNeo4j: [],
            orphanedInNeo4j: [],
            totalDivergences: 0,
            isConsistent: true,
            consistencyPercentage: 100,
          },
        })
        .mockResolvedValueOnce({
          divergencesBefore: 5,
          repaired: 5,
          divergencesAfter: 0,
          isConsistent: true,
          report: {
            checkedAt: new Date(),
            totalPostgresMemories: 100,
            totalNeo4jNodes: 100,
            missingInNeo4j: [],
            orphanedInNeo4j: [],
            totalDivergences: 0,
            isConsistent: true,
            consistencyPercentage: 100,
          },
        });

      await scheduledJob.runOnce();
      await scheduledJob.runOnce();

      const stats = scheduledJob.getStatistics();

      expect(stats.totalRuns).toBe(2);
      expect(stats.totalDivergencesDetected).toBe(15);
      expect(stats.totalRepaired).toBe(15);
      expect(stats.averageDivergences).toBe(7.5);
      expect(stats.lastRun).toBeInstanceOf(Date);
    });

    it('should track failure statistics', async () => {
      vi.mocked(reconciliationService.performFullReconciliation)
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValueOnce({
          divergencesBefore: 0,
          repaired: 0,
          divergencesAfter: 0,
          isConsistent: true,
          report: {
            checkedAt: new Date(),
            totalPostgresMemories: 100,
            totalNeo4jNodes: 100,
            missingInNeo4j: [],
            orphanedInNeo4j: [],
            totalDivergences: 0,
            isConsistent: true,
            consistencyPercentage: 100,
          },
        });

      await scheduledJob.runOnce();
      await scheduledJob.runOnce();

      const stats = scheduledJob.getStatistics();

      expect(stats.totalRuns).toBe(2);
      expect(stats.failureCount).toBe(1);
      expect(stats.successRate).toBe(50);
    });
  });
});
