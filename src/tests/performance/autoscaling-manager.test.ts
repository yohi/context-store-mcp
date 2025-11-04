/**
 * AutoscalingManagerのユニットテスト
 *
 * タスク10.2: スケーラビリティと自動化
 * Requirements: 7.2 (自動スケーリング), 7.4 (並行処理制御), 7.6 (性能劣化自動検知)
 *
 * テスト対象:
 * - リソース使用率の監視
 * - オートスケーリングのトリガー
 * - スケールアップ/ダウンの実行
 * - 性能劣化の自動検知
 * - データパーティショニング戦略
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AutoscalingManager } from '../../performance/autoscaling-manager';

describe('AutoscalingManager - Task 10.2: Scalability and Automation', () => {
  let manager: AutoscalingManager;

  beforeEach(() => {
    manager = new AutoscalingManager({
      minWorkers: 2,
      maxWorkers: 10,
      scaleUpThreshold: 0.7, // 70% CPU使用率
      scaleDownThreshold: 0.3, // 30% CPU使用率
      checkInterval: 5000,
    });
  });

  describe('Resource Monitoring', () => {
    it('should monitor CPU and memory usage', async () => {
      const metrics = await manager.getResourceMetrics();

      expect(metrics).toBeDefined();
      expect(metrics.cpuUsage).toBeGreaterThanOrEqual(0);
      expect(metrics.cpuUsage).toBeLessThanOrEqual(1);
      expect(metrics.memoryUsage).toBeGreaterThanOrEqual(0);
      expect(metrics.memoryUsage).toBeLessThanOrEqual(1);
    });

    it('should track request throughput', async () => {
      manager.recordRequest();
      manager.recordRequest();
      manager.recordRequest();

      const throughput = manager.getThroughput();

      expect(throughput).toBeGreaterThan(0);
    });

    it('should detect performance degradation', async () => {
      // 低いレスポンスタイムを記録
      manager.recordResponseTime(100);
      manager.recordResponseTime(120);
      manager.recordResponseTime(110);

      // 性能劣化が発生していないことを確認
      let degraded = manager.isPerformanceDegraded();
      expect(degraded).toBe(false);

      // 高いレスポンスタイムを記録（性能劣化）
      manager.recordResponseTime(3000); // P95 2秒を超える
      manager.recordResponseTime(3500);
      manager.recordResponseTime(4000);

      degraded = manager.isPerformanceDegraded();
      expect(degraded).toBe(true);
    });
  });

  describe('Autoscaling Triggers', () => {
    it('should trigger scale-up when CPU exceeds threshold', async () => {
      const scaleUpSpy = vi.spyOn(manager as any, 'scaleUp');

      // モックでCPU使用率を高くする
      vi.spyOn(manager, 'getResourceMetrics').mockResolvedValue({
        cpuUsage: 0.8, // 80% (閾値70%を超える)
        memoryUsage: 0.5,
        activeConnections: 50,
        queueDepth: 10,
      });

      await manager.checkAndScale();

      expect(scaleUpSpy).toHaveBeenCalled();
    });

    it('should trigger scale-down when CPU falls below threshold', async () => {
      // Worker数を増やしてからscaleDownできるようにする
      manager.setWorkerCount(5);

      const scaleDownSpy = vi.spyOn(manager as any, 'scaleDown');

      // モックでCPU使用率を低くする
      vi.spyOn(manager, 'getResourceMetrics').mockResolvedValue({
        cpuUsage: 0.2, // 20% (閾値30%を下回る)
        memoryUsage: 0.3,
        activeConnections: 5,
        queueDepth: 0,
      });

      await manager.checkAndScale();

      expect(scaleDownSpy).toHaveBeenCalled();
    });

    it('should not scale beyond max workers limit', async () => {
      const initialCount = 10; // maxWorkers設定
      manager.setWorkerCount(initialCount);

      vi.spyOn(manager, 'getResourceMetrics').mockResolvedValue({
        cpuUsage: 0.9,
        memoryUsage: 0.8,
        activeConnections: 100,
        queueDepth: 50,
      });

      await manager.checkAndScale();

      const finalCount = manager.getWorkerCount();
      expect(finalCount).toBeLessThanOrEqual(10);
    });

    it('should not scale below min workers limit', async () => {
      const initialCount = 2; // minWorkers設定
      manager.setWorkerCount(initialCount);

      vi.spyOn(manager, 'getResourceMetrics').mockResolvedValue({
        cpuUsage: 0.05,
        memoryUsage: 0.1,
        activeConnections: 0,
        queueDepth: 0,
      });

      await manager.checkAndScale();

      const finalCount = manager.getWorkerCount();
      expect(finalCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Scaling Operations', () => {
    it('should scale up by adding workers', async () => {
      const initialCount = 5;
      manager.setWorkerCount(initialCount);

      const addWorkerSpy = vi.fn();
      manager.onWorkerAdded(addWorkerSpy);

      await (manager as any).scaleUp(2);

      const finalCount = manager.getWorkerCount();
      expect(finalCount).toBe(7);
      expect(addWorkerSpy).toHaveBeenCalledTimes(2);
    });

    it('should scale down by removing workers', async () => {
      const initialCount = 8;
      manager.setWorkerCount(initialCount);

      const removeWorkerSpy = vi.fn();
      manager.onWorkerRemoved(removeWorkerSpy);

      await (manager as any).scaleDown(3);

      const finalCount = manager.getWorkerCount();
      expect(finalCount).toBe(5);
      expect(removeWorkerSpy).toHaveBeenCalledTimes(3);
    });

    it('should use exponential backoff for scaling decisions', async () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);

      // 最初のスケーリング
      await (manager as any).scaleUp(1);

      // すぐ後に再度スケーリングを試みる（cooldown期間中）
      vi.spyOn(Date, 'now').mockReturnValue(now + 10000); // 10秒後（短い）

      const scaleUpSpy = vi.spyOn(manager as any, 'scaleUp');
      await manager.checkAndScale();

      // cooldown期間中なのでスケーリングされない
      expect(scaleUpSpy).not.toHaveBeenCalled();

      // 十分に時間が経過
      vi.spyOn(Date, 'now').mockReturnValue(now + 65000); // 65秒後

      vi.spyOn(manager, 'getResourceMetrics').mockResolvedValue({
        cpuUsage: 0.85,
        memoryUsage: 0.6,
        activeConnections: 50,
        queueDepth: 10,
      });

      await manager.checkAndScale();

      // cooldown期間を過ぎたのでスケーリングされる
      expect(scaleUpSpy).toHaveBeenCalled();
    });
  });

  describe('Data Partitioning Strategy', () => {
    it('should calculate partition key for memory ID', () => {
      const memoryId = 'test-memory-123';
      const partitionCount = 4;

      const partition = manager.getPartitionForMemory(memoryId, partitionCount);

      expect(partition).toBeGreaterThanOrEqual(0);
      expect(partition).toBeLessThan(partitionCount);
    });

    it('should distribute memories evenly across partitions', () => {
      const partitionCount = 4;
      const memoryIds = Array.from({ length: 1000 }, (_, i) => `memory-${i}`);

      const partitions = new Map<number, number>();

      for (const memoryId of memoryIds) {
        const partition = manager.getPartitionForMemory(memoryId, partitionCount);
        partitions.set(partition, (partitions.get(partition) ?? 0) + 1);
      }

      // 各パーティションに均等に分散されることを確認（±10%の範囲）
      const expectedPerPartition = memoryIds.length / partitionCount;
      for (const count of partitions.values()) {
        expect(count).toBeGreaterThan(expectedPerPartition * 0.9);
        expect(count).toBeLessThan(expectedPerPartition * 1.1);
      }
    });

    it('should recommend partition rebalancing when needed', async () => {
      // パーティション使用率を設定
      manager.setPartitionUsage(0, 0.9); // 90% 使用（高負荷）
      manager.setPartitionUsage(1, 0.1); // 10% 使用（低負荷）
      manager.setPartitionUsage(2, 0.5); // 50% 使用（中程度）

      const recommendation = manager.shouldRebalancePartitions();

      expect(recommendation).toBe(true);
    });
  });

  describe('Background Optimization', () => {
    it('should schedule background optimization tasks', async () => {
      const optimizationSpy = vi.fn();
      manager.registerOptimizationTask('vacuum', optimizationSpy);

      await manager.runBackgroundOptimizations();

      expect(optimizationSpy).toHaveBeenCalled();
    });

    it('should run index optimization in background', async () => {
      const indexOptSpy = vi.fn().mockResolvedValue(undefined);
      manager.registerOptimizationTask('index_rebuild', indexOptSpy);

      await manager.runBackgroundOptimizations();

      expect(indexOptSpy).toHaveBeenCalled();
    });

    it('should throttle optimization tasks to avoid resource contention', async () => {
      const task1Spy = vi.fn().mockResolvedValue(undefined);
      const task2Spy = vi.fn().mockResolvedValue(undefined);

      manager.registerOptimizationTask('task1', task1Spy);
      manager.registerOptimizationTask('task2', task2Spy);

      // CPU使用率が高い場合は最適化をスキップ
      vi.spyOn(manager, 'getResourceMetrics').mockResolvedValue({
        cpuUsage: 0.85, // 85% (高負荷)
        memoryUsage: 0.7,
        activeConnections: 100,
        queueDepth: 20,
      });

      await manager.runBackgroundOptimizations();

      // 高負荷時は実行されない
      expect(task1Spy).not.toHaveBeenCalled();
      expect(task2Spy).not.toHaveBeenCalled();

      // CPU使用率が低い場合は最適化を実行
      vi.spyOn(manager, 'getResourceMetrics').mockResolvedValue({
        cpuUsage: 0.2, // 20% (低負荷)
        memoryUsage: 0.3,
        activeConnections: 5,
        queueDepth: 0,
      });

      await manager.runBackgroundOptimizations();

      // 低負荷時は実行される
      expect(task1Spy).toHaveBeenCalled();
      expect(task2Spy).toHaveBeenCalled();
    });
  });

  describe('Metrics and Reporting', () => {
    it('should generate scaling activity report', () => {
      // スケーリング履歴を記録
      (manager as any).recordScalingEvent('scale_up', 5, 7);
      (manager as any).recordScalingEvent('scale_down', 7, 5);

      const report = manager.getScalingReport();

      expect(report).toBeDefined();
      expect(report.totalScaleUps).toBe(1);
      expect(report.totalScaleDowns).toBe(1);
      expect(report.events).toHaveLength(2);
    });

    it('should calculate resource utilization trends', () => {
      // リソース使用率を記録
      manager.recordResponseTime(100);
      manager.recordResponseTime(150);
      manager.recordResponseTime(200);

      const trend = manager.getResourceTrend();

      expect(trend).toBeDefined();
      expect(trend.direction).toBe('increasing'); // レスポンスタイムが増加傾向
    });
  });
});
