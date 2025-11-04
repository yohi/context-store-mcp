/**
 * ScheduledReconciliationJob - 定期整合性チェックジョブ
 *
 * Requirements: 5.4, 5.5 - ストレージ間の一貫性監視と自動修復
 */

import type { ReconciliationService } from './reconciliation-service.js';

/**
 * ジョブ設定
 */
export interface ReconciliationJobConfig {
  /** 実行間隔（ミリ秒） */
  interval: number;
  /** 自動修復を有効にするか */
  autoRepair: boolean;
  /** アラート発火の閾値（パーセンテージ） */
  alertThreshold: number;
  /** アラートハンドラー */
  alertHandler?: (alert: ReconciliationAlert) => void;
  /** エラーハンドラー（テスト用） */
  errorHandler?: (error: unknown) => void;
}

/**
 * アラート情報
 */
export interface ReconciliationAlert {
  /** アラート発生時刻 */
  timestamp: Date;
  /** 差分数 */
  divergenceCount: number;
  /** 整合性パーセンテージ */
  consistencyPercentage: number;
  /** 詳細メッセージ */
  message: string;
}

/**
 * 実行統計情報
 */
export interface ReconciliationStatistics {
  /** 総実行回数 */
  totalRuns: number;
  /** 検出された総差分数 */
  totalDivergencesDetected: number;
  /** 修復された総数 */
  totalRepaired: number;
  /** 平均差分数 */
  averageDivergences: number;
  /** 最終実行時刻 */
  lastRun: Date | null;
  /** 失敗回数 */
  failureCount: number;
  /** 成功率（パーセンテージ） */
  successRate: number;
}

/**
 * ScheduledReconciliationJob - 定期的にストレージ間の整合性をチェック・修復
 */
export class ScheduledReconciliationJob {
  private config: ReconciliationJobConfig;
  private timerId: NodeJS.Timeout | null = null;
  private statistics: ReconciliationStatistics;

  constructor(
    private readonly reconciliationService: ReconciliationService,
    config?: Partial<ReconciliationJobConfig>
  ) {
    this.config = {
      interval: config?.interval ?? 3600000, // デフォルト: 1時間
      autoRepair: config?.autoRepair ?? false, // デフォルト: 検出のみ
      alertThreshold: config?.alertThreshold ?? 10, // デフォルト: 10%
      alertHandler: config?.alertHandler,
    };

    this.statistics = {
      totalRuns: 0,
      totalDivergencesDetected: 0,
      totalRepaired: 0,
      averageDivergences: 0,
      lastRun: null,
      failureCount: 0,
      successRate: 100,
    };
  }

  /**
   * ジョブを開始
   */
  start(): void {
    if (this.timerId !== null) {
      // 既に実行中の場合は無視
      return;
    }

    this.timerId = setInterval(async () => {
      await this.runOnce();
    }, this.config.interval);
  }

  /**
   * ジョブを停止
   */
  stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * 1回だけ実行
   */
  async runOnce(): Promise<void> {
    try {
      // 整合性チェックと修復を実行
      const result = await this.reconciliationService.performFullReconciliation({
        autoRepair: this.config.autoRepair,
      });

      // 統計情報を更新
      this.statistics.totalRuns++;
      this.statistics.totalDivergencesDetected += result.divergencesBefore;
      this.statistics.totalRepaired += result.repaired;
      this.statistics.averageDivergences =
        this.statistics.totalDivergencesDetected / this.statistics.totalRuns;
      this.statistics.lastRun = new Date();
      this.statistics.successRate =
        ((this.statistics.totalRuns - this.statistics.failureCount) / this.statistics.totalRuns) * 100;

      // アラート判定
      const shouldAlert = await this.reconciliationService.shouldTriggerAlert({
        threshold: this.config.alertThreshold,
      });

      if (shouldAlert && this.config.alertHandler) {
        const alert: ReconciliationAlert = {
          timestamp: new Date(),
          divergenceCount: result.divergencesAfter,
          consistencyPercentage: result.report.consistencyPercentage,
          message: `Storage consistency is below threshold: ${result.report.consistencyPercentage}% (threshold: ${100 - this.config.alertThreshold}%)`,
        };

        this.config.alertHandler(alert);
      }
    } catch (error) {
      // 失敗を記録
      this.statistics.totalRuns++;
      this.statistics.failureCount++;
      this.statistics.lastRun = new Date();
      this.statistics.successRate =
        ((this.statistics.totalRuns - this.statistics.failureCount) / this.statistics.totalRuns) * 100;

      // エラーをログ出力
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.error('Reconciliation job failed:', {
        message: errorMessage,
        stack: errorStack,
        timestamp: new Date().toISOString(),
      });

      // テスト環境ではerrorHandlerにエラーを渡す（設定されている場合）
      if (process.env.NODE_ENV === 'test' && this.config.errorHandler) {
        this.config.errorHandler(error);
      }

      // エラーを再スロー（テスト環境でも失敗を観測可能にする）
      throw error;
    }
  }

  /**
   * ジョブ設定を取得
   */
  getConfig(): ReconciliationJobConfig {
    return { ...this.config };
  }

  /**
   * 統計情報を取得
   */
  getStatistics(): ReconciliationStatistics {
    return { ...this.statistics };
  }
}
