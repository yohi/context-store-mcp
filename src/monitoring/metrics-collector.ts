/**
 * Metrics Collector
 * メトリクス収集システム
 *
 * システムリソース使用率、パフォーマンスメトリクス、カスタムメトリクスを収集・記録します。
 * Requirements: 8.1, 8.2, 8.3
 */

import * as os from 'os';
import { PerformanceMetrics } from '../mcp/performance-metrics';

/**
 * システムリソースメトリクス
 */
export interface SystemResourceMetrics {
  cpu: {
    usage: number; // 0.0 - 1.0
    loadAverage: number[]; // [1min, 5min, 15min]
    cores: number;
  };
  memory: {
    total: number; // bytes
    used: number; // bytes
    free: number; // bytes
    usage: number; // 0.0 - 1.0
  };
  storage: {
    total: number; // bytes
    used: number; // bytes
    free: number; // bytes
    usage: number; // 0.0 - 1.0
  };
  timestamp: number;
}

/**
 * カスタムメトリクス
 */
export interface CustomMetric {
  name: string;
  value: number;
  unit: string;
  tags?: Record<string, string>;
  timestamp: number;
}

/**
 * メトリクスサマリー
 */
export interface MetricsSummary {
  system: SystemResourceMetrics;
  performance: {
    [operationName: string]: {
      successCount: number;
      errorCount: number;
      totalCount: number;
      averageLatency: number;
      p50Latency: number;
      p95Latency: number;
      p99Latency: number;
      errorRate: number;
      throughput: number;
    };
  };
  custom: CustomMetric[];
  timestamp: number;
}

/**
 * メトリクス収集設定
 */
export interface MetricsCollectorConfig {
  collectionInterval?: number; // ミリ秒
  retentionPeriod?: number; // ミリ秒
  maxCustomMetrics?: number;
  enableSystemMetrics?: boolean;
  enablePerformanceMetrics?: boolean;
}

/**
 * ストレージプロバイダーインターフェース
 */
export interface StorageProvider {
  getStorageStats(): Promise<{ total: number; used: number; free: number }>;
}

/**
 * メトリクス収集クラス
 */
export class MetricsCollector {
  private static readonly DEFAULT_COLLECTION_INTERVAL = 60000; // 60秒
  private static readonly DEFAULT_RETENTION_PERIOD = 3600000; // 1時間
  private static readonly DEFAULT_MAX_CUSTOM_METRICS = 1000;

  private readonly config: Required<MetricsCollectorConfig>;
  private readonly performanceMetrics: PerformanceMetrics;
  private readonly customMetrics: CustomMetric[] = [];
  private readonly systemMetricsHistory: SystemResourceMetrics[] = [];
  private storageProvider?: StorageProvider;
  private collectionTimer?: NodeJS.Timeout;
  private lastCpuUsage?: { user: number; system: number; timestamp: number };

  constructor(
    config?: MetricsCollectorConfig,
    performanceMetrics?: PerformanceMetrics
  ) {
    this.config = {
      collectionInterval:
        config?.collectionInterval ?? MetricsCollector.DEFAULT_COLLECTION_INTERVAL,
      retentionPeriod:
        config?.retentionPeriod ?? MetricsCollector.DEFAULT_RETENTION_PERIOD,
      maxCustomMetrics:
        config?.maxCustomMetrics ?? MetricsCollector.DEFAULT_MAX_CUSTOM_METRICS,
      enableSystemMetrics: config?.enableSystemMetrics ?? true,
      enablePerformanceMetrics: config?.enablePerformanceMetrics ?? true,
    };

    this.performanceMetrics = performanceMetrics ?? new PerformanceMetrics();
  }

  /**
   * ストレージプロバイダーを設定
   */
  setStorageProvider(provider: StorageProvider): void {
    this.storageProvider = provider;
  }

  /**
   * メトリクス収集を開始
   */
  start(): void {
    if (this.collectionTimer) {
      return; // 既に開始済み
    }

    // 初回収集を即座に実行
    if (this.config.enableSystemMetrics) {
      this.collectSystemMetrics().catch((error) => {
        console.error('Failed to collect initial system metrics:', error);
      });
    }

    // 定期収集を開始
    this.collectionTimer = setInterval(() => {
      if (this.config.enableSystemMetrics) {
        this.collectSystemMetrics().catch((error) => {
          console.error('Failed to collect system metrics:', error);
        });
      }
      this.pruneOldMetrics();
    }, this.config.collectionInterval);
  }

  /**
   * メトリクス収集を停止
   */
  stop(): void {
    if (this.collectionTimer) {
      clearInterval(this.collectionTimer);
      delete this.collectionTimer;
    }
  }

  /**
   * システムリソースメトリクスを収集
   */
  async collectSystemMetrics(): Promise<SystemResourceMetrics> {
    const cpuUsage = await this.getCpuUsage();
    const memoryMetrics = this.getMemoryMetrics();
    const storageMetrics = await this.getStorageMetrics();

    const metrics: SystemResourceMetrics = {
      cpu: {
        usage: cpuUsage,
        loadAverage: os.loadavg(),
        cores: os.cpus().length,
      },
      memory: memoryMetrics,
      storage: storageMetrics,
      timestamp: Date.now(),
    };

    this.systemMetricsHistory.push(metrics);
    return metrics;
  }

  /**
   * カスタムメトリクスを記録
   */
  recordCustomMetric(
    name: string,
    value: number,
    unit: string,
    tags?: Record<string, string>
  ): void {
    const metric: CustomMetric = {
      name,
      value,
      unit,
      timestamp: Date.now(),
      ...(tags !== undefined ? { tags: tags } : {}), // 条件付きでtagsを追加
    };

    this.customMetrics.push(metric);

    // 最大数を超えた場合、古いメトリクスを削除
    if (this.customMetrics.length > this.config.maxCustomMetrics) {
      const removeCount = this.customMetrics.length - this.config.maxCustomMetrics;
      this.customMetrics.splice(0, removeCount);
    }
  }

  /**
   * 最新のシステムメトリクスを取得
   */
  getLatestSystemMetrics(): SystemResourceMetrics | undefined {
    return this.systemMetricsHistory[this.systemMetricsHistory.length - 1];
  }

  /**
   * システムメトリクス履歴を取得
   */
  getSystemMetricsHistory(limit?: number): SystemResourceMetrics[] {
    if (limit) {
      return this.systemMetricsHistory.slice(-limit);
    }
    return [...this.systemMetricsHistory];
  }

  /**
   * カスタムメトリクスを取得
   */
  getCustomMetrics(name?: string, limit?: number): CustomMetric[] {
    let metrics = name
      ? this.customMetrics.filter((m) => m.name === name)
      : [...this.customMetrics];

    if (limit) {
      metrics = metrics.slice(-limit);
    }

    return metrics;
  }

  /**
   * パフォーマンスメトリクスを取得
   */
  getPerformanceMetrics() {
    return this.performanceMetrics;
  }

  /**
   * すべてのメトリクスのサマリーを取得
   */
  getMetricsSummary(): MetricsSummary {
    return {
      system: this.getLatestSystemMetrics() ?? this.createEmptySystemMetrics(),
      performance: this.config.enablePerformanceMetrics
        ? this.performanceMetrics.exportMetrics()
        : {},
      custom: this.customMetrics,
      timestamp: Date.now(),
    };
  }

  /**
   * メトリクスをリセット
   */
  reset(): void {
    this.systemMetricsHistory.length = 0;
    this.customMetrics.length = 0;
    this.performanceMetrics.resetAll();
    delete this.lastCpuUsage;
  }

  /**
   * CPU使用率を取得
   */
  private async getCpuUsage(): Promise<number> {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    }

    const currentUsage = {
      user: totalTick - totalIdle,
      system: totalTick,
      timestamp: Date.now(),
    };

    let usage = 0;

    if (this.lastCpuUsage) {
      const userDiff = currentUsage.user - this.lastCpuUsage.user;
      const systemDiff = currentUsage.system - this.lastCpuUsage.system;

      if (systemDiff > 0) {
        usage = userDiff / systemDiff;
      }
    }

    this.lastCpuUsage = currentUsage;
    return Math.max(0, Math.min(1, usage));
  }

  /**
   * メモリメトリクスを取得
   */
  private getMemoryMetrics() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const usage = total > 0 ? used / total : 0;

    return {
      total,
      used,
      free,
      usage,
    };
  }

  /**
   * ストレージメトリクスを取得
   */
  private async getStorageMetrics() {
    if (this.storageProvider) {
      try {
        const stats = await this.storageProvider.getStorageStats();
        return {
          ...stats,
          usage: stats.total > 0 ? stats.used / stats.total : 0,
        };
      } catch (error) {
        console.error('Failed to get storage stats from provider:', error);
      }
    }

    // フォールバック: 空のメトリクス
    return {
      total: 0,
      used: 0,
      free: 0,
      usage: 0,
    };
  }

  /**
   * 古いメトリクスを削除
   */
  private pruneOldMetrics(): void {
    const now = Date.now();
    const cutoff = now - this.config.retentionPeriod;

    // システムメトリクス履歴のプルーニング
    const validIndex = this.systemMetricsHistory.findIndex(
      (m) => m.timestamp >= cutoff
    );
    if (validIndex > 0) {
      this.systemMetricsHistory.splice(0, validIndex);
    } else if (validIndex === -1 && this.systemMetricsHistory.length > 0) {
      // すべて古い場合はクリア
      this.systemMetricsHistory.length = 0;
    }

    // カスタムメトリクスのプルーニング
    const validCustomIndex = this.customMetrics.findIndex((m) => m.timestamp >= cutoff);
    if (validCustomIndex > 0) {
      this.customMetrics.splice(0, validCustomIndex);
    } else if (validCustomIndex === -1 && this.customMetrics.length > 0) {
      // すべて古い場合はクリア
      this.customMetrics.length = 0;
    }
  }

  /**
   * 空のシステムメトリクスを作成
   */
  private createEmptySystemMetrics(): SystemResourceMetrics {
    return {
      cpu: {
        usage: 0,
        loadAverage: [0, 0, 0],
        cores: os.cpus().length,
      },
      memory: {
        total: 0,
        used: 0,
        free: 0,
        usage: 0,
      },
      storage: {
        total: 0,
        used: 0,
        free: 0,
        usage: 0,
      },
      timestamp: Date.now(),
    };
  }
}
