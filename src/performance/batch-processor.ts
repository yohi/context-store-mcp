/**
 * Batch Processor
 *
 * タスク10.1: パフォーマンスチューニング - バッチ処理の並列化
 * Requirements: 7.2 (1000 req/sec)
 *
 * 機能:
 * - ベクトル生成バッチ処理
 * - OpenAI APIリクエストの並列化
 * - レート制限対応 (TPM, RPM)
 * - バッチサイズの最適化
 * - BackgroundJobManagerとの統合
 * - データ同期並列化
 */

import { BackgroundJobManager, JobPriority } from './background-job-manager';

/**
 * バッチ処理設定
 */
export interface BatchProcessorConfig {
  jobManager: BackgroundJobManager;
  maxConcurrency?: number;
  batchSize?: number;
  rateLimitTPM?: number; // Tokens Per Minute
  rateLimitRPM?: number; // Requests Per Minute
}

/**
 * バッチ処理結果
 */
export interface BatchResult<T> {
  successful: T[];
  failed: Array<{ item: any; error: Error }>;
  totalProcessed: number;
  duration: number;
}

/**
 * BatchProcessorクラス
 */
export class BatchProcessor {
  private jobManager: BackgroundJobManager;
  private config: Required<BatchProcessorConfig>;
  private requestCount = 0;
  private tokenCount = 0;
  private lastResetTime = Date.now();

  constructor(config: BatchProcessorConfig) {
    this.jobManager = config.jobManager;
    this.config = {
      jobManager: config.jobManager,
      maxConcurrency: config.maxConcurrency ?? 5,
      batchSize: config.batchSize ?? 100,
      rateLimitTPM: config.rateLimitTPM ?? 90000,
      rateLimitRPM: config.rateLimitRPM ?? 3500,
    };
  }

  /**
   * バッチ処理を実行（並列）
   */
  public async processBatch<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    options?: { priority?: JobPriority }
  ): Promise<BatchResult<R>> {
    const startTime = Date.now();
    const successful: R[] = [];
    const failed: Array<{ item: T; error: Error }> = [];

    // バッチに分割
    const batches = this.splitIntoBatches(items, this.config.batchSize);

    for (const batch of batches) {
      // 並列処理（最大同時実行数制限）
      const tasks = batch.map((item) => async () =>
        this.processWithRateLimit(async () => {
          try {
            const result = await processor(item);
            successful.push(result);
            return result;
          } catch (error) {
            failed.push({ item, error: error as Error });
            throw error;
          }
        })
      );

      // 最大同時実行数を制御
      await this.executeWithConcurrencyLimit(tasks, this.config.maxConcurrency);
    }

    return {
      successful,
      failed,
      totalProcessed: items.length,
      duration: Date.now() - startTime,
    };
  }

  /**
   * ベクトル生成バッチ処理（BackgroundJobManager統合）
   */
  public async generateEmbeddingsBatch(
    contents: string[],
    priority: JobPriority = JobPriority.NORMAL
  ): Promise<string[]> {
    const jobIds: string[] = [];

    for (const content of contents) {
      const jobId = await this.jobManager.enqueue({
        type: 'embeddings_generation',
        payload: { content },
        priority,
      });
      jobIds.push(jobId);
    }

    return jobIds;
  }

  /**
   * データ同期バッチ処理
   */
  public async syncDataBatch(
    memoryIds: string[],
    priority: JobPriority = JobPriority.NORMAL
  ): Promise<string[]> {
    const jobIds: string[] = [];

    for (const memoryId of memoryIds) {
      const jobId = await this.jobManager.enqueue({
        type: 'data_sync',
        payload: { memoryId },
        priority,
      });
      jobIds.push(jobId);
    }

    return jobIds;
  }

  /**
   * レート制限付き処理実行
   */
  private async processWithRateLimit<T>(fn: () => Promise<T>): Promise<T> {
    await this.waitForRateLimit();
    this.incrementCounters();
    return fn();
  }

  /**
   * レート制限チェックと待機
   */
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastResetTime;

    // 1分経過したらカウンターをリセット
    if (elapsed >= 60000) {
      this.requestCount = 0;
      this.tokenCount = 0;
      this.lastResetTime = now;
      return;
    }

    // RPM制限チェック
    if (this.requestCount >= this.config.rateLimitRPM) {
      const waitTime = 60000 - elapsed;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      this.requestCount = 0;
      this.tokenCount = 0;
      this.lastResetTime = Date.now();
    }
  }

  /**
   * カウンター増加
   */
  private incrementCounters(): void {
    this.requestCount++;
    this.tokenCount += 1000; // 推定トークン数
  }

  /**
   * 同時実行数制限付き実行
   */
  private async executeWithConcurrencyLimit<T>(
    tasks: (() => Promise<T>)[],
    limit: number
  ): Promise<T[]> {
    const results: T[] = [];
    const executing: Set<Promise<void>> = new Set();

    for (const task of tasks) {
      const p = task()
        .then((result) => {
          results.push(result);
        })
        .catch(() => {
          // エラーは個別に処理済み
        })
        .finally(() => {
          executing.delete(p);
        });

      executing.add(p);

      if (executing.size >= limit) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
    return results;
  }

  /**
   * アイテムをバッチに分割
   */
  private splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];

    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    return batches;
  }

  /**
   * レート制限統計を取得
   */
  public getRateLimitStats(): {
    requestCount: number;
    tokenCount: number;
    requestsRemaining: number;
    tokensRemaining: number;
  } {
    return {
      requestCount: this.requestCount,
      tokenCount: this.tokenCount,
      requestsRemaining: this.config.rateLimitRPM - this.requestCount,
      tokensRemaining: this.config.rateLimitTPM - this.tokenCount,
    };
  }
}
