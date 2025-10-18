/**
 * Performance Metrics
 * パフォーマンスメトリクス記録機能
 *
 * オペレーションのレイテンシ、成功率、エラー率、スループットなどを記録・計算します。
 */

/**
 * オペレーション統計
 */
interface OperationStats {
  successCount: number;
  errorCount: number;
  latencies: number[];
  errors: Array<{ timestamp: number; error: Error }>;
  timestamps: number[];
}

/**
 * エクスポート用メトリクス
 */
export interface ExportedMetrics {
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
    lastUpdated: number;
  };
}

export class PerformanceMetrics {
  private readonly operations: Map<string, OperationStats> = new Map();

  /**
   * オペレーションのレイテンシを記録
   *
   * @param operationName オペレーション名
   * @param latency レイテンシ（ミリ秒）
   */
  recordLatency(operationName: string, latency: number): void {
    const stats = this.getOrCreateStats(operationName);
    stats.latencies.push(latency);
    stats.timestamps.push(Date.now());
  }

  /**
   * オペレーションの成功を記録
   *
   * @param operationName オペレーション名
   */
  recordSuccess(operationName: string): void {
    const stats = this.getOrCreateStats(operationName);
    stats.successCount++;
    stats.timestamps.push(Date.now());
  }

  /**
   * オペレーションのエラーを記録
   *
   * @param operationName オペレーション名
   * @param error エラーオブジェクト
   */
  recordError(operationName: string, error: Error): void {
    const stats = this.getOrCreateStats(operationName);
    stats.errorCount++;
    stats.errors.push({ timestamp: Date.now(), error });
    stats.timestamps.push(Date.now());
  }

  /**
   * オペレーションの平均レイテンシを取得
   *
   * @param operationName オペレーション名
   * @returns 平均レイテンシ（ミリ秒）
   */
  getAverageLatency(operationName: string): number {
    const stats = this.operations.get(operationName);
    if (!stats || stats.latencies.length === 0) {
      return 0;
    }

    const sum = stats.latencies.reduce((acc, val) => acc + val, 0);
    return sum / stats.latencies.length;
  }

  /**
   * オペレーションのP95レイテンシを取得
   *
   * @param operationName オペレーション名
   * @returns P95レイテンシ（ミリ秒）
   */
  getP95Latency(operationName: string): number {
    return this.getPercentileLatency(operationName, 0.95);
  }

  /**
   * オペレーションのP99レイテンシを取得
   *
   * @param operationName オペレーション名
   * @returns P99レイテンシ（ミリ秒）
   */
  getP99Latency(operationName: string): number {
    return this.getPercentileLatency(operationName, 0.99);
  }

  /**
   * オペレーションのP50レイテンシを取得（中央値）
   *
   * @param operationName オペレーション名
   * @returns P50レイテンシ（ミリ秒）
   */
  getP50Latency(operationName: string): number {
    return this.getPercentileLatency(operationName, 0.5);
  }

  /**
   * オペレーションの成功回数を取得
   *
   * @param operationName オペレーション名
   * @returns 成功回数
   */
  getSuccessCount(operationName: string): number {
    const stats = this.operations.get(operationName);
    return stats?.successCount ?? 0;
  }

  /**
   * オペレーションのエラー回数を取得
   *
   * @param operationName オペレーション名
   * @returns エラー回数
   */
  getErrorCount(operationName: string): number {
    const stats = this.operations.get(operationName);
    return stats?.errorCount ?? 0;
  }

  /**
   * オペレーションのエラー率を取得
   *
   * @param operationName オペレーション名
   * @returns エラー率（0.0 - 1.0）
   */
  getErrorRate(operationName: string): number {
    const stats = this.operations.get(operationName);
    if (!stats) {
      return 0;
    }

    const totalCount = stats.successCount + stats.errorCount;
    if (totalCount === 0) {
      return 0;
    }

    return stats.errorCount / totalCount;
  }

  /**
   * オペレーションのスループットを取得（リクエスト/秒）
   *
   * @param operationName オペレーション名
   * @param windowMs ウィンドウ期間（ミリ秒）デフォルト: 1000ms (1秒)
   * @returns スループット（req/sec）
   */
  getThroughput(operationName: string, windowMs = 1000): number {
    const stats = this.operations.get(operationName);
    if (!stats || stats.timestamps.length === 0) {
      return 0;
    }

    const now = Date.now();
    const windowStart = now - windowMs;

    // ウィンドウ期間内のタイムスタンプをカウント
    const requestsInWindow = stats.timestamps.filter(
      (timestamp) => timestamp >= windowStart
    ).length;

    // req/sec に変換
    return (requestsInWindow / windowMs) * 1000;
  }

  /**
   * オペレーションのメトリクスをリセット
   *
   * @param operationName オペレーション名
   */
  reset(operationName: string): void {
    this.operations.delete(operationName);
  }

  /**
   * すべてのメトリクスをリセット
   */
  resetAll(): void {
    this.operations.clear();
  }

  /**
   * すべてのメトリクスをエクスポート
   *
   * @returns エクスポートされたメトリクス
   */
  exportMetrics(): ExportedMetrics {
    const exported: ExportedMetrics = {};

    for (const [operationName, stats] of this.operations.entries()) {
      const totalCount = stats.successCount + stats.errorCount;
      const errorRate = totalCount === 0 ? 0 : stats.errorCount / totalCount;

      exported[operationName] = {
        successCount: stats.successCount,
        errorCount: stats.errorCount,
        totalCount,
        averageLatency: this.getAverageLatency(operationName),
        p50Latency: this.getP50Latency(operationName),
        p95Latency: this.getP95Latency(operationName),
        p99Latency: this.getP99Latency(operationName),
        errorRate,
        throughput: this.getThroughput(operationName),
        lastUpdated: Date.now(),
      };
    }

    return exported;
  }

  /**
   * パーセンタイルレイテンシを計算
   */
  private getPercentileLatency(
    operationName: string,
    percentile: number
  ): number {
    const stats = this.operations.get(operationName);
    if (!stats || stats.latencies.length === 0) {
      return 0;
    }

    const sorted = [...stats.latencies].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * オペレーション統計を取得または作成
   */
  private getOrCreateStats(operationName: string): OperationStats {
    let stats = this.operations.get(operationName);

    if (!stats) {
      stats = {
        successCount: 0,
        errorCount: 0,
        latencies: [],
        errors: [],
        timestamps: [],
      };
      this.operations.set(operationName, stats);
    }

    return stats;
  }
}
