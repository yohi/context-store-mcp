/**
 * Metrics Collector Tests
 * メトリクス収集システムのテスト
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MetricsCollector,
  StorageProvider,
  SystemResourceMetrics,
} from '../../monitoring/metrics-collector';
import { PerformanceMetrics } from '../../mcp/performance-metrics';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;
  let mockStorageProvider: StorageProvider;

  beforeEach(() => {
    collector = new MetricsCollector({
      collectionInterval: 100,
      retentionPeriod: 1000,
      maxCustomMetrics: 10,
    });

    mockStorageProvider = {
      getStorageStats: vi.fn().mockResolvedValue({
        total: 1000000000, // 1GB
        used: 500000000, // 500MB
        free: 500000000, // 500MB
      }),
    };

    collector.setStorageProvider(mockStorageProvider);
  });

  afterEach(() => {
    collector.stop();
  });

  describe('システムメトリクス収集', () => {
    it('システムリソースメトリクスを収集できる', async () => {
      const metrics = await collector.collectSystemMetrics();

      expect(metrics).toBeDefined();
      expect(metrics.cpu).toBeDefined();
      expect(metrics.cpu.usage).toBeGreaterThanOrEqual(0);
      expect(metrics.cpu.usage).toBeLessThanOrEqual(1);
      expect(metrics.cpu.cores).toBeGreaterThan(0);
      expect(metrics.cpu.loadAverage).toHaveLength(3);

      expect(metrics.memory).toBeDefined();
      expect(metrics.memory.total).toBeGreaterThan(0);
      expect(metrics.memory.usage).toBeGreaterThanOrEqual(0);
      expect(metrics.memory.usage).toBeLessThanOrEqual(1);

      expect(metrics.storage).toBeDefined();
      expect(metrics.storage.total).toBe(1000000000);
      expect(metrics.storage.used).toBe(500000000);
      expect(metrics.storage.usage).toBe(0.5);

      expect(metrics.timestamp).toBeGreaterThan(0);
    });

    it('ストレージプロバイダーがない場合は空のストレージメトリクスを返す', async () => {
      const collectorWithoutProvider = new MetricsCollector();
      const metrics = await collectorWithoutProvider.collectSystemMetrics();

      expect(metrics.storage.total).toBe(0);
      expect(metrics.storage.used).toBe(0);
      expect(metrics.storage.free).toBe(0);
      expect(metrics.storage.usage).toBe(0);
    });

    it('ストレージプロバイダーがエラーを投げた場合は空のメトリクスを返す', async () => {
      const errorProvider: StorageProvider = {
        getStorageStats: vi.fn().mockRejectedValue(new Error('Storage error')),
      };

      collector.setStorageProvider(errorProvider);
      const metrics = await collector.collectSystemMetrics();

      expect(metrics.storage.total).toBe(0);
      expect(metrics.storage.used).toBe(0);
      expect(metrics.storage.free).toBe(0);
      expect(metrics.storage.usage).toBe(0);
    });
  });

  describe('カスタムメトリクス', () => {
    it('カスタムメトリクスを記録できる', () => {
      collector.recordCustomMetric('test_metric', 42, 'count');

      const metrics = collector.getCustomMetrics('test_metric');
      expect(metrics).toHaveLength(1);
      expect(metrics[0].name).toBe('test_metric');
      expect(metrics[0].value).toBe(42);
      expect(metrics[0].unit).toBe('count');
    });

    it('タグ付きカスタムメトリクスを記録できる', () => {
      collector.recordCustomMetric('api_calls', 100, 'count', {
        endpoint: '/api/search',
        method: 'POST',
      });

      const metrics = collector.getCustomMetrics('api_calls');
      expect(metrics).toHaveLength(1);
      expect(metrics[0].tags).toEqual({
        endpoint: '/api/search',
        method: 'POST',
      });
    });

    it('最大数を超えたカスタムメトリクスは古いものから削除される', () => {
      for (let i = 0; i < 15; i++) {
        collector.recordCustomMetric(`metric_${i}`, i, 'count');
      }

      const allMetrics = collector.getCustomMetrics();
      expect(allMetrics).toHaveLength(10); // maxCustomMetrics = 10
      expect(allMetrics[0].name).toBe('metric_5'); // 最初の5つは削除された
    });

    it('名前でカスタムメトリクスをフィルタリングできる', () => {
      collector.recordCustomMetric('metric_a', 1, 'count');
      collector.recordCustomMetric('metric_b', 2, 'count');
      collector.recordCustomMetric('metric_a', 3, 'count');

      const metricsA = collector.getCustomMetrics('metric_a');
      expect(metricsA).toHaveLength(2);
      expect(metricsA.every((m) => m.name === 'metric_a')).toBe(true);
    });

    it('制限数でカスタムメトリクスを取得できる', () => {
      for (let i = 0; i < 5; i++) {
        collector.recordCustomMetric('test', i, 'count');
      }

      const metrics = collector.getCustomMetrics('test', 3);
      expect(metrics).toHaveLength(3);
      expect(metrics[0].value).toBe(2); // 最新の3つ
    });
  });

  describe('メトリクス履歴', () => {
    it('システムメトリクス履歴を保持する', async () => {
      await collector.collectSystemMetrics();
      await collector.collectSystemMetrics();
      await collector.collectSystemMetrics();

      const history = collector.getSystemMetricsHistory();
      expect(history).toHaveLength(3);
    });

    it('最新のシステムメトリクスを取得できる', async () => {
      await collector.collectSystemMetrics();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const latest = await collector.collectSystemMetrics();

      const retrieved = collector.getLatestSystemMetrics();
      expect(retrieved).toEqual(latest);
    });

    it('制限数でシステムメトリクス履歴を取得できる', async () => {
      for (let i = 0; i < 5; i++) {
        await collector.collectSystemMetrics();
      }

      const history = collector.getSystemMetricsHistory(3);
      expect(history).toHaveLength(3);
    });
  });

  describe('自動収集', () => {
    it('start()で定期的なメトリクス収集を開始できる', async () => {
      collector.start();

      // 初回収集を待つ
      await new Promise((resolve) => setTimeout(resolve, 50));

      const metrics = collector.getLatestSystemMetrics();
      expect(metrics).toBeDefined();

      // 2回目の収集を待つ
      await new Promise((resolve) => setTimeout(resolve, 150));

      const history = collector.getSystemMetricsHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
    });

    it('stop()で定期収集を停止できる', async () => {
      collector.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const countBefore = collector.getSystemMetricsHistory().length;

      collector.stop();
      await new Promise((resolve) => setTimeout(resolve, 150));

      const countAfter = collector.getSystemMetricsHistory().length;
      expect(countAfter).toBe(countBefore); // 増えていない
    });

    it('start()を複数回呼んでも重複して開始しない', async () => {
      collector.start();
      collector.start();
      collector.start();

      await new Promise((resolve) => setTimeout(resolve, 150));

      // タイマーが1つだけ動作していることを確認
      // （正確な回数は環境依存だが、極端に多くないことを確認）
      const history = collector.getSystemMetricsHistory();
      expect(history.length).toBeLessThan(10);
    });
  });

  describe('メトリクスサマリー', () => {
    it('すべてのメトリクスのサマリーを取得できる', async () => {
      await collector.collectSystemMetrics();
      collector.recordCustomMetric('test', 42, 'count');

      const performanceMetrics = collector.getPerformanceMetrics();
      performanceMetrics.recordSuccess('test_operation');
      performanceMetrics.recordLatency('test_operation', 100);

      const summary = collector.getMetricsSummary();

      expect(summary.system).toBeDefined();
      expect(summary.performance).toBeDefined();
      expect(summary.custom).toHaveLength(1);
      expect(summary.timestamp).toBeGreaterThan(0);
    });

    it('システムメトリクスがない場合は空のメトリクスを返す', () => {
      const summary = collector.getMetricsSummary();

      expect(summary.system.cpu.usage).toBe(0);
      expect(summary.system.memory.total).toBe(0);
      expect(summary.system.storage.total).toBe(0);
    });
  });

  describe('メトリクスのプルーニング', () => {
    it('保持期間を超えたシステムメトリクスは削除される', async () => {
      const shortRetentionCollector = new MetricsCollector({
        collectionInterval: 10,
        retentionPeriod: 50, // 50ms
      });

      shortRetentionCollector.start();

      // 複数回収集
      await new Promise((resolve) => setTimeout(resolve, 100));

      shortRetentionCollector.stop();

      // プルーニングを待つ
      await new Promise((resolve) => setTimeout(resolve, 100));

      const history = shortRetentionCollector.getSystemMetricsHistory();
      // 古いメトリクスは削除されているはず
      expect(history.length).toBeLessThan(10);
    });

    it('保持期間を超えたカスタムメトリクスは削除される', async () => {
      const shortRetentionCollector = new MetricsCollector({
        collectionInterval: 10,
        retentionPeriod: 50, // 50ms
      });

      shortRetentionCollector.recordCustomMetric('old', 1, 'count');
      await new Promise((resolve) => setTimeout(resolve, 100));
      shortRetentionCollector.recordCustomMetric('new', 2, 'count');

      shortRetentionCollector.start();
      await new Promise((resolve) => setTimeout(resolve, 50));
      shortRetentionCollector.stop();

      const metrics = shortRetentionCollector.getCustomMetrics();
      expect(metrics.length).toBeLessThanOrEqual(1);
      if (metrics.length > 0) {
        expect(metrics[0].name).toBe('new');
      }
    });
  });

  describe('リセット', () => {
    it('reset()ですべてのメトリクスをクリアできる', async () => {
      await collector.collectSystemMetrics();
      collector.recordCustomMetric('test', 42, 'count');

      const performanceMetrics = collector.getPerformanceMetrics();
      performanceMetrics.recordSuccess('test_operation');

      collector.reset();

      expect(collector.getSystemMetricsHistory()).toHaveLength(0);
      expect(collector.getCustomMetrics()).toHaveLength(0);
      expect(performanceMetrics.getSuccessCount('test_operation')).toBe(0);
    });
  });

  describe('パフォーマンスメトリクス統合', () => {
    it('外部のPerformanceMetricsインスタンスを使用できる', () => {
      const externalMetrics = new PerformanceMetrics();
      const collectorWithExternal = new MetricsCollector({}, externalMetrics);

      externalMetrics.recordSuccess('external_op');

      const retrieved = collectorWithExternal.getPerformanceMetrics();
      expect(retrieved.getSuccessCount('external_op')).toBe(1);
    });

    it('PerformanceMetricsが指定されない場合は内部で作成する', () => {
      const collectorWithInternal = new MetricsCollector();
      const metrics = collectorWithInternal.getPerformanceMetrics();

      metrics.recordSuccess('internal_op');
      expect(metrics.getSuccessCount('internal_op')).toBe(1);
    });
  });
});
