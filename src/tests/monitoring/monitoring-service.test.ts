/**
 * Monitoring Service Tests
 * 監視サービスのテスト
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MonitoringService, AlertLevel, HealthStatus } from '../../monitoring/monitoring-service';
import { MetricsCollector, StorageProvider } from '../../monitoring/metrics-collector';
import { PerformanceMetrics } from '../../mcp/performance-metrics';

describe('MonitoringService', () => {
  let metricsCollector: MetricsCollector;
  let monitoringService: MonitoringService;
  let mockStorageProvider: StorageProvider;

  beforeEach(() => {
    metricsCollector = new MetricsCollector({
      collectionInterval: 100,
    });

    mockStorageProvider = {
      getStorageStats: vi.fn().mockResolvedValue({
        total: 1000000000,
        used: 500000000,
        free: 500000000,
      }),
    };

    metricsCollector.setStorageProvider(mockStorageProvider);

    monitoringService = new MonitoringService(metricsCollector, {
      checkInterval: 100,
      thresholds: {
        cpu: { warning: 0.7, critical: 0.9 },
        memory: { warning: 0.8, critical: 0.95 },
        storage: { warning: 0.8, critical: 0.95 },
        errorRate: { warning: 0.05, critical: 0.1 },
        latency: { warning: 2000, critical: 5000 },
      },
    });
  });

  afterEach(() => {
    metricsCollector.stop();
    monitoringService.stop();
    // Ensure real timers are always restored, even if a test throws
    vi.useRealTimers();
  });

  describe('ヘルスチェック', () => {
    it('システムが健全な場合はHEALTHYを返す', async () => {
      // システムメトリクスをモックして健全な状態を返す
      vi.spyOn(metricsCollector, 'collectSystemMetrics').mockResolvedValue({
        cpu: { usage: 0.1, loadAverage: [0.1, 0.1, 0.1], cores: 4 },
        memory: { total: 1000000000, used: 200000000, free: 800000000, usage: 0.2 },
        storage: { total: 1000000000, used: 500000000, free: 500000000, usage: 0.5 },
        timestamp: Date.now(),
      });

      await metricsCollector.collectSystemMetrics();

      const result = monitoringService.performHealthCheck();

      expect(result.status).toBe(HealthStatus.HEALTHY);
      expect(result.checks.cpu.status).toBe(HealthStatus.HEALTHY);
      expect(result.checks.memory.status).toBe(HealthStatus.HEALTHY);
      expect(result.checks.storage.status).toBe(HealthStatus.HEALTHY);
    });

    it('ストレージ使用率が警告閾値を超えた場合はDEGRADEDを返す', async () => {
      mockStorageProvider.getStorageStats = vi.fn().mockResolvedValue({
        total: 1000000000,
        used: 850000000, // 85% 使用
        free: 150000000,
      });

      // システムメトリクスのモック
      const mockMetrics = {
        cpu: { usage: 0.1, loadAverage: [0.1, 0.1, 0.1], cores: 4 },
        memory: { total: 1000000000, used: 200000000, free: 800000000, usage: 0.2 },
        storage: { total: 1000000000, used: 850000000, free: 150000000, usage: 0.85 },
        timestamp: Date.now(),
      };

      vi.spyOn(metricsCollector, 'collectSystemMetrics').mockResolvedValue(mockMetrics);
      vi.spyOn(metricsCollector, 'getLatestSystemMetrics').mockReturnValue(mockMetrics);

      await metricsCollector.collectSystemMetrics();

      const result = monitoringService.performHealthCheck();

      expect(result.status).toBe(HealthStatus.DEGRADED);
      expect(result.checks.storage.status).toBe(HealthStatus.DEGRADED);
      expect(result.checks.storage.usage).toBeCloseTo(0.85, 2);
    });



    it('ストレージ使用率が危険閾値を超えた場合はUNHEALTHYを返す', async () => {
      mockStorageProvider.getStorageStats = vi.fn().mockResolvedValue({
        total: 1000000000,
        used: 960000000, // 96% 使用
        free: 40000000,
      });

      // システムメトリクスのモック
      const mockMetrics = {
        cpu: { usage: 0.1, loadAverage: [0.1, 0.1, 0.1], cores: 4 },
        memory: { total: 1000000000, used: 200000000, free: 800000000, usage: 0.2 },
        storage: { total: 1000000000, used: 960000000, free: 40000000, usage: 0.96 },
        timestamp: Date.now(),
      };

      vi.spyOn(metricsCollector, 'collectSystemMetrics').mockResolvedValue(mockMetrics);
      vi.spyOn(metricsCollector, 'getLatestSystemMetrics').mockReturnValue(mockMetrics);

      await metricsCollector.collectSystemMetrics();

      const result = monitoringService.performHealthCheck();

      expect(result.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.checks.storage.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.checks.storage.usage).toBeCloseTo(0.96, 2);
    });

    it('エラー率が警告閾値を超えた場合はDEGRADEDを返す', () => {
      const performanceMetrics = metricsCollector.getPerformanceMetrics();

      // 20リクエスト中1エラー = 5% エラー率（警告閾値）
      for (let i = 0; i < 19; i++) {
        performanceMetrics.recordSuccess('test_op');
      }
      performanceMetrics.recordError('test_op', new Error('Test error'));

      const result = monitoringService.performHealthCheck();

      expect(result.status).toBe(HealthStatus.DEGRADED);
      expect(result.checks.errorRate.status).toBe(HealthStatus.DEGRADED);
      expect(result.checks.errorRate.rate).toBeCloseTo(0.05, 2);
    });

    it('レイテンシが警告閾値を超えた場合はDEGRADEDを返す', () => {
      const performanceMetrics = metricsCollector.getPerformanceMetrics();

      // P95が2500msを超えるようにレイテンシを記録
      // 90個が1000ms、10個が3000ms
      for (let i = 0; i < 90; i++) {
        performanceMetrics.recordSuccess('test_op');
        performanceMetrics.recordLatency('test_op', 1000);
      }
      for (let i = 0; i < 10; i++) {
        performanceMetrics.recordSuccess('test_op');
        performanceMetrics.recordLatency('test_op', 3000);
      }

      // P95レイテンシを確認
      const p95 = performanceMetrics.getP95Latency('test_op');
      expect(p95).toBeGreaterThanOrEqual(2000); // 警告閾値を超えている

      const result = monitoringService.performHealthCheck();

      expect(result.status).toBe(HealthStatus.DEGRADED);
      expect(result.checks.latency.status).toBe(HealthStatus.DEGRADED);
      expect(result.checks.latency.p95).toBeGreaterThanOrEqual(2000);
    });

    it('複数の問題がある場合は最も深刻なステータスを返す', async () => {
      // ストレージを危険レベルに
      mockStorageProvider.getStorageStats = vi.fn().mockResolvedValue({
        total: 1000000000,
        used: 960000000,
        free: 40000000,
      });

      await metricsCollector.collectSystemMetrics();

      // エラー率を警告レベルに（5%）
      const performanceMetrics = metricsCollector.getPerformanceMetrics();
      for (let i = 0; i < 19; i++) {
        performanceMetrics.recordSuccess('test_op');
      }
      performanceMetrics.recordError('test_op', new Error('Test error'));

      const result = monitoringService.performHealthCheck();

      // UNHEALTHYが優先される
      expect(result.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.checks.storage.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.checks.errorRate.status).toBe(HealthStatus.DEGRADED);
    });
  });

  describe('アラート', () => {
    it('閾値を超えた場合にアラートが生成される', async () => {
      mockStorageProvider.getStorageStats = vi.fn().mockResolvedValue({
        total: 1000000000,
        used: 960000000,
        free: 40000000,
      });

      await metricsCollector.collectSystemMetrics();
      monitoringService.performHealthCheck();

      const alerts = monitoringService.getRecentAlerts();
      expect(alerts.length).toBeGreaterThan(0);

      const storageAlert = alerts.find((a) => a.category === 'storage');
      expect(storageAlert).toBeDefined();
      expect(storageAlert?.level).toBe(AlertLevel.CRITICAL);
      expect(storageAlert?.message).toContain('Storage usage is critical');
    });

    it('アラートハンドラーが呼び出される', async () => {
      const alertHandler = vi.fn();
      monitoringService.onAlert(alertHandler);

      mockStorageProvider.getStorageStats = vi.fn().mockResolvedValue({
        total: 1000000000,
        used: 960000000,
        free: 40000000,
      });

      // システムメトリクスのモック（他は正常）
      const mockMetrics = {
        cpu: { usage: 0.1, loadAverage: [0.1, 0.1, 0.1], cores: 4 },
        memory: { total: 1000000000, used: 200000000, free: 800000000, usage: 0.2 },
        storage: { total: 1000000000, used: 960000000, free: 40000000, usage: 0.96 },
        timestamp: Date.now(),
      };

      vi.spyOn(metricsCollector, 'collectSystemMetrics').mockResolvedValue(mockMetrics);
      vi.spyOn(metricsCollector, 'getLatestSystemMetrics').mockReturnValue(mockMetrics);

      metricsCollector.start(); // メトリクス収集を開始
      monitoringService.start(); // モニタリングを開始し、定期チェックをトリガー

      // 閾値チェック間隔（checkInterval）が100msなので、少し長く待つ
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(alertHandler).toHaveBeenCalled();

      // 複数のアラートが来る可能性があるので、引数から探す
      const alertCalls = alertHandler.mock.calls.map(call => call[0]);
      const storageAlert = alertCalls.find(alert => alert.category === 'storage');

      expect(storageAlert).toBeDefined();
      expect(storageAlert?.level).toBe(AlertLevel.CRITICAL);
    });

    it('複数のアラートハンドラーを登録できる', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      monitoringService.onAlert(handler1);
      monitoringService.onAlert(handler2);

      mockStorageProvider.getStorageStats = vi.fn().mockResolvedValue({
        total: 1000000000,
        used: 960000000,
        free: 40000000,
      });

      await metricsCollector.collectSystemMetrics();
      monitoringService.performHealthCheck();

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('非同期アラートハンドラーをサポートする', async () => {
      const asyncHandler = vi.fn().mockResolvedValue(undefined);
      monitoringService.onAlert(asyncHandler);

      mockStorageProvider.getStorageStats = vi.fn().mockResolvedValue({
        total: 1000000000,
        used: 960000000,
        free: 40000000,
      });

      await metricsCollector.collectSystemMetrics();
      monitoringService.performHealthCheck();

      expect(asyncHandler).toHaveBeenCalled();
    });

    it('アラートハンドラーのエラーは無視される', async () => {
      const errorHandler = vi.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      const normalHandler = vi.fn();

      monitoringService.onAlert(errorHandler);
      monitoringService.onAlert(normalHandler);

      mockStorageProvider.getStorageStats = vi.fn().mockResolvedValue({
        total: 1000000000,
        used: 960000000,
        free: 40000000,
      });

      await metricsCollector.collectSystemMetrics();

      // エラーが発生してもクラッシュしない
      expect(() => monitoringService.performHealthCheck()).not.toThrow();

      // 他のハンドラーは呼び出される
      expect(normalHandler).toHaveBeenCalled();
    });

    it('最近のアラートを制限数で取得できる', async () => {
      // 複数のアラートを生成
      for (let i = 0; i < 5; i++) {
        mockStorageProvider.getStorageStats = vi.fn().mockResolvedValue({
          total: 1000000000,
          used: 960000000,
          free: 40000000,
        });

        await metricsCollector.collectSystemMetrics();
        monitoringService.performHealthCheck();
      }

      const alerts = monitoringService.getRecentAlerts(3);
      expect(alerts).toHaveLength(3);
    });

    it('アラートをクリアできる', async () => {
      mockStorageProvider.getStorageStats = vi.fn().mockResolvedValue({
        total: 1000000000,
        used: 960000000,
        free: 40000000,
      });

      await metricsCollector.collectSystemMetrics();
      monitoringService.performHealthCheck();

      expect(monitoringService.getRecentAlerts().length).toBeGreaterThan(0);

      monitoringService.clearAlerts();

      expect(monitoringService.getRecentAlerts()).toHaveLength(0);
    });
  });

  describe('自動監視', () => {
    it('start()で定期的なヘルスチェックを開始できる', async () => {
      vi.useFakeTimers();

      const alertHandler = vi.fn();
      monitoringService.onAlert(alertHandler);

      // ストレージを危険レベルに
      mockStorageProvider.getStorageStats = vi.fn().mockResolvedValue({
        total: 1000000000,
        used: 960000000,
        free: 40000000,
      });

      metricsCollector.start();
      monitoringService.start();

      // checkInterval (100ms) よりも少し長く時間を進める
      await vi.advanceTimersByTime(120);
      await vi.runOnlyPendingTimersAsync(); // 保留中のマイクロタスクとタイマーをフラッシュ

      expect(alertHandler).toHaveBeenCalled();

      const alertCalls = alertHandler.mock.calls.map(call => call[0]);
      const storageAlert = alertCalls.find(alert => alert.category === 'storage');

      expect(storageAlert).toBeDefined();
      expect(storageAlert?.level).toBe(AlertLevel.CRITICAL);
    });

    it('stop()で定期チェックを停止できる', async () => {
      const alertHandler = vi.fn();
      monitoringService.onAlert(alertHandler);

      monitoringService.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      monitoringService.stop();

      const callCountBefore = alertHandler.mock.calls.length;

      // ストレージを危険レベルに
      mockStorageProvider.getStorageStats = vi.fn().mockResolvedValue({
        total: 1000000000,
        used: 960000000,
        free: 40000000,
      });

      await new Promise((resolve) => setTimeout(resolve, 150));

      // 停止後は呼び出されない
      expect(alertHandler.mock.calls.length).toBe(callCountBefore);
    });
  });

  describe('メトリクスサマリー', () => {
    it('メトリクスサマリーを取得できる', async () => {
      await metricsCollector.collectSystemMetrics();
      metricsCollector.recordCustomMetric('test', 42, 'count');

      const summary = monitoringService.getMetricsSummary();

      expect(summary.system).toBeDefined();
      expect(summary.performance).toBeDefined();
      expect(summary.custom).toHaveLength(1);
      expect(summary.timestamp).toBeGreaterThan(0);
    });
  });

  describe('カスタム閾値', () => {
    it('カスタム閾値を設定できる', async () => {
      const customService = new MonitoringService(metricsCollector, {
        thresholds: {
          storage: { warning: 0.5, critical: 0.6 },
        },
      });

      // 55% 使用（カスタム閾値では警告レベル）
      mockStorageProvider.getStorageStats = vi.fn().mockResolvedValue({
        total: 1000000000,
        used: 550000000,
        free: 450000000,
      });

      await metricsCollector.collectSystemMetrics();

      const result = customService.performHealthCheck();

      expect(result.checks.storage.status).toBe(HealthStatus.DEGRADED);
    });
  });
});
