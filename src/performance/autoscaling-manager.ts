/**
 * Autoscaling Manager
 *
 * タスク10.2: スケーラビリティと自動化
 * Requirements: 7.2 (自動スケーリング), 7.4 (並行処理制御), 7.6 (性能劣化自動検知)
 *
 * 機能:
 * - リソース使用率の監視（CPU、メモリ）
 * - オートスケーリングのトリガー（閾値ベース）
 * - スケールアップ/ダウンの実行
 * - 性能劣化の自動検知（P95 < 2秒）
 * - データパーティショニング戦略
 * - バックグラウンド最適化処理
 */

import * as os from 'os';

/**
 * リソース使用率メトリクス
 */
export interface ResourceMetrics {
  cpuUsage: number; // 0.0 - 1.0
  memoryUsage: number; // 0.0 - 1.0
  activeConnections: number;
  queueDepth: number;
}

/**
 * AutoscalingManager設定
 */
export interface AutoscalingConfig {
  minWorkers: number;
  maxWorkers: number;
  scaleUpThreshold: number; // CPU使用率（0.0 - 1.0）
  scaleDownThreshold: number; // CPU使用率（0.0 - 1.0）
  checkInterval: number; // チェック間隔（ミリ秒）
}

/**
 * スケーリングイベント
 */
interface ScalingEvent {
  timestamp: number;
  type: 'scale_up' | 'scale_down';
  fromWorkers: number;
  toWorkers: number;
}

/**
 * スケーリングレポート
 */
export interface ScalingReport {
  totalScaleUps: number;
  totalScaleDowns: number;
  events: ScalingEvent[];
}

/**
 * リソース使用率トレンド
 */
export interface ResourceTrend {
  direction: 'increasing' | 'decreasing' | 'stable';
}

/**
 * 最適化タスク
 */
type OptimizationTask = () => Promise<void>;

/**
 * AutoscalingManagerクラス
 */
export class AutoscalingManager {
  private config: Required<AutoscalingConfig>;
  private workerCount: number;
  private lastScalingTime: number = 0;
  private cooldownPeriod: number = 60000; // 60秒
  private requestCount: number = 0;
  private lastRequestTime: number = Date.now();
  private responseTimes: number[] = [];
  private maxResponseTimes: number = 100; // 最大保持数
  private partitionUsage: Map<number, number> = new Map();
  private optimizationTasks: Map<string, OptimizationTask> = new Map();
  private scalingEvents: ScalingEvent[] = [];
  private workerAddedCallbacks: Array<() => void> = [];
  private workerRemovedCallbacks: Array<() => void> = [];

  constructor(config: AutoscalingConfig) {
    this.config = {
      minWorkers: config.minWorkers,
      maxWorkers: config.maxWorkers,
      scaleUpThreshold: config.scaleUpThreshold,
      scaleDownThreshold: config.scaleDownThreshold,
      checkInterval: config.checkInterval,
    };
    this.workerCount = config.minWorkers;
  }

  /**
   * リソースメトリクスを取得
   */
  public async getResourceMetrics(): Promise<ResourceMetrics> {
    // CPU使用率の計算
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    }

    const cpuUsage = 1 - totalIdle / totalTick;

    // メモリ使用率の計算
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memoryUsage = (totalMem - freeMem) / totalMem;

    // アクティブ接続数とキュー深度（仮の実装）
    const activeConnections = this.workerCount * 10; // 仮の値
    const queueDepth = Math.max(0, this.requestCount - this.workerCount * 5);

    return {
      cpuUsage: Math.min(1, Math.max(0, cpuUsage)),
      memoryUsage: Math.min(1, Math.max(0, memoryUsage)),
      activeConnections,
      queueDepth,
    };
  }

  /**
   * リクエストを記録
   */
  public recordRequest(): void {
    this.requestCount++;
    this.lastRequestTime = Date.now();
  }

  /**
   * スループットを取得（req/sec）
   */
  public getThroughput(): number {
    if (this.requestCount === 0) return 0;
    const timeDiff = (Date.now() - this.lastRequestTime) / 1000;
    // 時間差が非常に小さい場合は、requestCountをそのまま返す
    if (timeDiff < 0.001) return this.requestCount;
    return this.requestCount / timeDiff;
  }

  /**
   * レスポンスタイムを記録
   */
  public recordResponseTime(timeMs: number): void {
    this.responseTimes.push(timeMs);
    if (this.responseTimes.length > this.maxResponseTimes) {
      this.responseTimes.shift();
    }
  }

  /**
   * 性能劣化を検知（P95 < 2秒）
   */
  public isPerformanceDegraded(): boolean {
    if (this.responseTimes.length === 0) return false;

    // P95を計算
    const sorted = [...this.responseTimes].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p95 = sorted[p95Index];

    // p95がundefinedの場合は劣化していないとみなす
    if (p95 === undefined) return false;

    // 2秒（2000ms）を超える場合は劣化
    return p95 > 2000;
  }

  /**
   * スケーリングのチェックと実行
   */
  public async checkAndScale(): Promise<void> {
    // Cooldown期間中はスキップ
    const now = Date.now();
    if (now - this.lastScalingTime < this.cooldownPeriod) {
      return;
    }

    const metrics = await this.getResourceMetrics();

    // スケールアップ判定
    if (metrics.cpuUsage > this.config.scaleUpThreshold) {
      const targetWorkers = Math.min(this.config.maxWorkers, this.workerCount + 1);
      if (targetWorkers > this.workerCount) {
        await this.scaleUp(targetWorkers - this.workerCount);
      }
    }
    // スケールダウン判定
    else if (metrics.cpuUsage < this.config.scaleDownThreshold) {
      const targetWorkers = Math.max(this.config.minWorkers, this.workerCount - 1);
      if (targetWorkers < this.workerCount) {
        await this.scaleDown(this.workerCount - targetWorkers);
      }
    }
  }

  /**
   * スケールアップ
   */
  private async scaleUp(count: number): Promise<void> {
    const fromWorkers = this.workerCount;
    this.workerCount = Math.min(this.config.maxWorkers, this.workerCount + count);
    const toWorkers = this.workerCount;

    this.lastScalingTime = Date.now();
    this.recordScalingEvent('scale_up', fromWorkers, toWorkers);

    // コールバック実行
    const addCount = toWorkers - fromWorkers;
    for (let i = 0; i < addCount; i++) {
      this.workerAddedCallbacks.forEach((callback) => callback());
    }
  }

  /**
   * スケールダウン
   */
  private async scaleDown(count: number): Promise<void> {
    const fromWorkers = this.workerCount;
    this.workerCount = Math.max(this.config.minWorkers, this.workerCount - count);
    const toWorkers = this.workerCount;

    this.lastScalingTime = Date.now();
    this.recordScalingEvent('scale_down', fromWorkers, toWorkers);

    // コールバック実行
    const removeCount = fromWorkers - toWorkers;
    for (let i = 0; i < removeCount; i++) {
      this.workerRemovedCallbacks.forEach((callback) => callback());
    }
  }

  /**
   * Worker数を取得
   */
  public getWorkerCount(): number {
    return this.workerCount;
  }

  /**
   * Worker数を設定（テスト用）
   */
  public setWorkerCount(count: number): void {
    this.workerCount = count;
  }

  /**
   * Workerが追加されたときのコールバック登録
   */
  public onWorkerAdded(callback: () => void): void {
    this.workerAddedCallbacks.push(callback);
  }

  /**
   * Workerが削除されたときのコールバック登録
   */
  public onWorkerRemoved(callback: () => void): void {
    this.workerRemovedCallbacks.push(callback);
  }

  /**
   * メモリIDに対するパーティション番号を計算
   */
  public getPartitionForMemory(memoryId: string, partitionCount: number): number {
    // シンプルなハッシュベースのパーティショニング
    let hash = 0;
    for (let i = 0; i < memoryId.length; i++) {
      const char = memoryId.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash) % partitionCount;
  }

  /**
   * パーティション使用率を設定
   */
  public setPartitionUsage(partition: number, usage: number): void {
    this.partitionUsage.set(partition, usage);
  }

  /**
   * パーティションのリバランスが必要かチェック
   */
  public shouldRebalancePartitions(): boolean {
    if (this.partitionUsage.size === 0) return false;

    const usages = Array.from(this.partitionUsage.values());
    const max = Math.max(...usages);
    const min = Math.min(...usages);

    // 最大と最小の差が50%以上の場合はリバランス推奨
    return max - min > 0.5;
  }

  /**
   * 最適化タスクを登録
   */
  public registerOptimizationTask(name: string, task: OptimizationTask): void {
    this.optimizationTasks.set(name, task);
  }

  /**
   * バックグラウンド最適化を実行
   */
  public async runBackgroundOptimizations(): Promise<void> {
    const metrics = await this.getResourceMetrics();

    // CPU使用率が高い場合は最適化をスキップ
    if (metrics.cpuUsage > 0.7) {
      return;
    }

    // すべての最適化タスクを実行
    for (const [name, task] of this.optimizationTasks.entries()) {
      try {
        await task();
      } catch (error) {
        console.error(`Optimization task ${name} failed:`, error);
      }
    }
  }

  /**
   * スケーリングイベントを記録
   */
  private recordScalingEvent(
    type: 'scale_up' | 'scale_down',
    fromWorkers: number,
    toWorkers: number
  ): void {
    this.scalingEvents.push({
      timestamp: Date.now(),
      type,
      fromWorkers,
      toWorkers,
    });
  }

  /**
   * スケーリングレポートを取得
   */
  public getScalingReport(): ScalingReport {
    const totalScaleUps = this.scalingEvents.filter((e) => e.type === 'scale_up').length;
    const totalScaleDowns = this.scalingEvents.filter((e) => e.type === 'scale_down').length;

    return {
      totalScaleUps,
      totalScaleDowns,
      events: this.scalingEvents,
    };
  }

  /**
   * リソース使用率トレンドを取得
   */
  public getResourceTrend(): ResourceTrend {
    if (this.responseTimes.length < 2) {
      return { direction: 'stable' };
    }

    // 前半と後半の平均を比較
    const mid = Math.floor(this.responseTimes.length / 2);
    const firstHalf = this.responseTimes.slice(0, mid);
    const secondHalf = this.responseTimes.slice(mid);

    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    // 10%以上の変化を「増加」「減少」とみなす
    const threshold = avgFirst * 0.1;
    if (avgSecond > avgFirst + threshold) {
      return { direction: 'increasing' };
    } else if (avgSecond < avgFirst - threshold) {
      return { direction: 'decreasing' };
    } else {
      return { direction: 'stable' };
    }
  }
}
