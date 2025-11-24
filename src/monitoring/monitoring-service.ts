/**
 * Monitoring Service
 * 監視サービス
 *
 * システム全体の監視、アラート、ヘルスチェック機能を提供します。
 * Requirements: 8.1, 8.2, 8.3
 */

import { MetricsCollector } from './metrics-collector';
import type { SystemResourceMetrics, MetricsSummary } from './metrics-collector';

/**
 * アラート閾値設定
 */
export interface AlertThresholds {
  cpu: {
    warning: number; // 0.0 - 1.0
    critical: number; // 0.0 - 1.0
  };
  memory: {
    warning: number; // 0.0 - 1.0
    critical: number; // 0.0 - 1.0
  };
  storage: {
    warning: number; // 0.0 - 1.0
    critical: number; // 0.0 - 1.0
  };
  errorRate: {
    warning: number; // 0.0 - 1.0
    critical: number; // 0.0 - 1.0
  };
  latency: {
    warning: number; // ミリ秒
    critical: number; // ミリ秒
  };
}

/**
 * アラートレベル
 */
export enum AlertLevel {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical',
}

/**
 * アラート
 */
export interface Alert {
  id: string;
  level: AlertLevel;
  category: 'cpu' | 'memory' | 'storage' | 'error_rate' | 'latency' | 'custom';
  message: string;
  value: number;
  threshold: number;
  timestamp: number;
  metadata?: Record<string, unknown> | undefined;
}

/**
 * ヘルスステータス
 */
export enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
}

/**
 * ヘルスチェック結果
 */
export interface HealthCheckResult {
  status: HealthStatus;
  checks: {
    cpu: { status: HealthStatus; usage: number };
    memory: { status: HealthStatus; usage: number };
    storage: { status: HealthStatus; usage: number };
    errorRate: { status: HealthStatus; rate: number };
    latency: { status: HealthStatus; p95: number };
  };
  alerts: Alert[];
  timestamp: number;
}

/**
 * アラートハンドラー
 */
export type AlertHandler = (alert: Alert) => void | Promise<void>;

/**
 * 監視サービス設定
 */
export interface MonitoringServiceConfig {
  thresholds?: Partial<AlertThresholds>;
  checkInterval?: number; // ミリ秒
  alertRetentionPeriod?: number; // ミリ秒
  maxAlerts?: number;
}

/**
 * 監視サービスクラス
 */
export class MonitoringService {
  private static readonly DEFAULT_CHECK_INTERVAL = 30000; // 30秒
  private static readonly DEFAULT_ALERT_RETENTION = 86400000; // 24時間
  private static readonly DEFAULT_MAX_ALERTS = 1000;

  private static readonly DEFAULT_THRESHOLDS: AlertThresholds = {
    cpu: { warning: 0.7, critical: 0.9 },
    memory: { warning: 0.8, critical: 0.95 },
    storage: { warning: 0.8, critical: 0.95 },
    errorRate: { warning: 0.05, critical: 0.1 },
    latency: { warning: 2000, critical: 5000 },
  };

  private readonly metricsCollector: MetricsCollector;
  private readonly thresholds: AlertThresholds;
  private readonly config: Required<MonitoringServiceConfig>;
  private readonly alerts: Alert[] = [];
  private readonly alertHandlers: AlertHandler[] = [];
  private checkTimer?: NodeJS.Timeout | undefined;
  private alertIdCounter = 0;

  constructor(metricsCollector: MetricsCollector, config?: MonitoringServiceConfig) {
    this.metricsCollector = metricsCollector;

    this.config = {
      thresholds: config?.thresholds ?? {},
      checkInterval: config?.checkInterval ?? MonitoringService.DEFAULT_CHECK_INTERVAL,
      alertRetentionPeriod:
        config?.alertRetentionPeriod ?? MonitoringService.DEFAULT_ALERT_RETENTION,
      maxAlerts: config?.maxAlerts ?? MonitoringService.DEFAULT_MAX_ALERTS,
    };

    const thresholds = {} as AlertThresholds;
    for (const key of Object.keys(MonitoringService.DEFAULT_THRESHOLDS) as Array<keyof AlertThresholds>) {
      thresholds[key] = {
        ...MonitoringService.DEFAULT_THRESHOLDS[key],
        ...config?.thresholds?.[key],
      };
    }
    this.thresholds = thresholds;
  }

  /**
   * 監視を開始
   */
  start(): void {
    if (this.checkTimer) {
      return; // 既に開始済み
    }

    // 初回チェックを即座に実行
    this.performHealthCheck();

    // 定期チェックを開始
    this.checkTimer = setInterval(async () => {
      try {
        this.performHealthCheck();
        this.pruneOldAlerts();
      } catch (error) {
        console.error('Monitoring loop error:', error);
      }
    }, this.config.checkInterval);
  }

  /**
   * 監視を停止
   */
  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }
  }

  /**
   * アラートハンドラーを登録
   */
  onAlert(handler: AlertHandler): void {
    this.alertHandlers.push(handler);
  }

  /**
   * ヘルスチェックを実行
   */
  performHealthCheck(): HealthCheckResult {
    const systemMetrics = this.metricsCollector.getLatestSystemMetrics();
    const performanceMetrics = this.metricsCollector.getPerformanceMetrics().exportMetrics();

    const checks = {
      cpu: this.checkCpu(systemMetrics),
      memory: this.checkMemory(systemMetrics),
      storage: this.checkStorage(systemMetrics),
      errorRate: this.checkErrorRate(performanceMetrics),
      latency: this.checkLatency(performanceMetrics),
    };

    // 全体のステータスを決定
    const statuses = Object.values(checks).map((check) => check.status);
    const overallStatus = this.determineOverallStatus(statuses);

    const result: HealthCheckResult = {
      status: overallStatus,
      checks,
      alerts: this.getRecentAlerts(10),
      timestamp: Date.now(),
    };

    return result;
  }

  /**
   * 最近のアラートを取得
   */
  getRecentAlerts(limit?: number): Alert[] {
    const alerts = [...this.alerts].reverse(); // 新しい順
    return limit === undefined ? alerts : alerts.slice(0, Math.max(0, limit));
  }

  /**
   * アラートをクリア
   */
  clearAlerts(): void {
    this.alerts.length = 0;
  }

  /**
   * メトリクスサマリーを取得
   */
  getMetricsSummary(): MetricsSummary {
    return this.metricsCollector.getMetricsSummary();
  }

  /**
   * CPU使用率をチェック
   */
  private checkCpu(
    systemMetrics?: SystemResourceMetrics
  ): { status: HealthStatus; usage: number } {
    const usage = systemMetrics?.cpu.usage ?? 0;

    if (usage >= this.thresholds.cpu.critical) {
      this.createAlert(AlertLevel.CRITICAL, 'cpu', 'CPU usage is critical', usage, this.thresholds.cpu.critical);
      return { status: HealthStatus.UNHEALTHY, usage };
    } else if (usage >= this.thresholds.cpu.warning) {
      this.createAlert(AlertLevel.WARNING, 'cpu', 'CPU usage is high', usage, this.thresholds.cpu.warning);
      return { status: HealthStatus.DEGRADED, usage };
    }

    return { status: HealthStatus.HEALTHY, usage };
  }

  /**
   * メモリ使用率をチェック
   */
  private checkMemory(
    systemMetrics?: SystemResourceMetrics
  ): { status: HealthStatus; usage: number } {
    const usage = systemMetrics?.memory.usage ?? 0;

    if (usage >= this.thresholds.memory.critical) {
      this.createAlert(AlertLevel.CRITICAL, 'memory', 'Memory usage is critical', usage, this.thresholds.memory.critical);
      return { status: HealthStatus.UNHEALTHY, usage };
    } else if (usage >= this.thresholds.memory.warning) {
      this.createAlert(AlertLevel.WARNING, 'memory', 'Memory usage is high', usage, this.thresholds.memory.warning);
      return { status: HealthStatus.DEGRADED, usage };
    }

    return { status: HealthStatus.HEALTHY, usage };
  }

  /**
   * ストレージ使用率をチェック
   */
  private checkStorage(
    systemMetrics?: SystemResourceMetrics
  ): { status: HealthStatus; usage: number } {
    const usage = systemMetrics?.storage.usage ?? 0;

    if (usage >= this.thresholds.storage.critical) {
      this.createAlert(AlertLevel.CRITICAL, 'storage', 'Storage usage is critical', usage, this.thresholds.storage.critical);
      return { status: HealthStatus.UNHEALTHY, usage };
    } else if (usage >= this.thresholds.storage.warning) {
      this.createAlert(AlertLevel.WARNING, 'storage', 'Storage usage is high', usage, this.thresholds.storage.warning);
      return { status: HealthStatus.DEGRADED, usage };
    }

    return { status: HealthStatus.HEALTHY, usage };
  }

  /**
   * エラー率をチェック
   */
  private checkErrorRate(performanceMetrics: Record<string, any>): { status: HealthStatus; rate: number } {
    let totalErrors = 0;
    let totalRequests = 0;

    for (const metrics of Object.values(performanceMetrics)) {
      totalErrors += metrics.errorCount ?? 0;
      totalRequests += metrics.totalCount ?? 0;
    }

    const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;

    if (errorRate >= this.thresholds.errorRate.critical) {
      this.createAlert(AlertLevel.CRITICAL, 'error_rate', 'Error rate is critical', errorRate, this.thresholds.errorRate.critical);
      return { status: HealthStatus.UNHEALTHY, rate: errorRate };
    } else if (errorRate >= this.thresholds.errorRate.warning) {
      this.createAlert(AlertLevel.WARNING, 'error_rate', 'Error rate is high', errorRate, this.thresholds.errorRate.warning);
      return { status: HealthStatus.DEGRADED, rate: errorRate };
    }

    return { status: HealthStatus.HEALTHY, rate: errorRate };
  }

  /**
   * レイテンシをチェック
   */
  private checkLatency(performanceMetrics: Record<string, any>): { status: HealthStatus; p95: number } {
    let maxP95 = 0;

    for (const metrics of Object.values(performanceMetrics)) {
      const p95 = metrics.p95Latency ?? 0;
      if (p95 > maxP95) {
        maxP95 = p95;
      }
    }

    if (maxP95 >= this.thresholds.latency.critical) {
      this.createAlert(AlertLevel.CRITICAL, 'latency', 'P95 latency is critical', maxP95, this.thresholds.latency.critical);
      return { status: HealthStatus.UNHEALTHY, p95: maxP95 };
    } else if (maxP95 >= this.thresholds.latency.warning) {
      this.createAlert(AlertLevel.WARNING, 'latency', 'P95 latency is high', maxP95, this.thresholds.latency.warning);
      return { status: HealthStatus.DEGRADED, p95: maxP95 };
    }

    return { status: HealthStatus.HEALTHY, p95: maxP95 };
  }

  /**
   * アラートを作成
   */
  private createAlert(
    level: AlertLevel,
    category: Alert['category'],
    message: string,
    value: number,
    threshold: number,
    metadata?: Record<string, unknown>
  ): void {
    const alert: Alert = {
      id: `alert-${++this.alertIdCounter}`,
      level,
      category,
      message,
      value,
      threshold,
      timestamp: Date.now(),
      metadata,
    };

    this.alerts.push(alert);

    // 最大数を超えた場合、古いアラートを削除
    if (this.alerts.length > this.config.maxAlerts) {
      const removeCount = this.alerts.length - this.config.maxAlerts;
      this.alerts.splice(0, removeCount);
    }

    // アラートハンドラーを呼び出し
    this.notifyAlertHandlers(alert);
  }

  /**
   * アラートハンドラーに通知
   */
  private notifyAlertHandlers(alert: Alert): void {
    for (const handler of this.alertHandlers) {
      try {
        const result = handler(alert);
        if (result instanceof Promise) {
          result.catch((error) => {
            console.error('Alert handler error:', error);
          });
        }
      } catch (error) {
        console.error('Alert handler error:', error);
      }
    }
  }

  /**
   * 全体のステータスを決定
   */
  private determineOverallStatus(statuses: HealthStatus[]): HealthStatus {
    if (statuses.some((s) => s === HealthStatus.UNHEALTHY)) {
      return HealthStatus.UNHEALTHY;
    }
    if (statuses.some((s) => s === HealthStatus.DEGRADED)) {
      return HealthStatus.DEGRADED;
    }
    return HealthStatus.HEALTHY;
  }

  /**
   * 古いアラートを削除
   */
  private pruneOldAlerts(): void {
    const now = Date.now();
    const cutoff = now - this.config.alertRetentionPeriod;

    const validIndex = this.alerts.findIndex((a) => a.timestamp >= cutoff);
    if (validIndex > 0) {
      this.alerts.splice(0, validIndex);
    } else if (validIndex === -1 && this.alerts.length > 0) {
      // すべて古い場合はクリア
      this.alerts.length = 0;
    }
  }
}
