/**
 * Background Job Manager
 *
 * タスク10.1: パフォーマンスチューニング - 非同期処理とバックグラウンドジョブ
 * Requirements: 7.1 (P95 < 2秒), 7.3 (同時アクセス制御)
 *
 * 機能:
 * - ジョブキューの管理（Redis使用）
 * - Worker poolによる並列実行
 * - ジョブの優先度制御（HIGH, NORMAL, LOW）
 * - エラーハンドリングとリトライ
 * - ジョブの進捗追跡
 * - デッドレターキュー
 */

import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import { randomUUID } from 'crypto';

/**
 * ジョブ優先度
 */
export enum JobPriority {
  HIGH = 'high',
  NORMAL = 'normal',
  LOW = 'low',
}

/**
 * ジョブステータス
 */
export enum JobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRYING = 'retrying',
}

/**
 * ジョブ定義
 */
export interface Job {
  id: string;
  type: string;
  payload: Record<string, any>;
  priority: JobPriority;
  status: JobStatus;
  maxRetries: number;
  retryCount: number;
  createdAt: number;
  startedAt?: number | undefined;
  completedAt?: number | undefined;
  error?: string | undefined;
  progress?: number | undefined;
  progressMessage?: string | undefined;
}

/**
 * ジョブ投入パラメータ
 */
export interface EnqueueParams {
  type: string;
  payload: Record<string, any>;
  priority?: JobPriority;
  maxRetries?: number;
}

/**
 * キュー統計情報
 */
export interface QueueStats {
  highPriority: number;
  normalPriority: number;
  lowPriority: number;
  total: number;
}

/**
 * Worker統計情報
 */
export interface WorkerStats {
  totalWorkers: number;
  activeWorkers: number;
  idleWorkers: number;
}

/**
 * BackgroundJobManager設定
 */
export interface BackgroundJobManagerConfig {
  redisUrl: string;
  maxWorkers?: number;
  jobTimeout?: number;
  retryDelay?: number;
}

/**
 * ジョブハンドラー型
 * @param payload - ジョブのペイロード
 * @param jobId - ジョブID
 * @param signal - AbortSignal (タイムアウト時にキャンセルされる)
 */
export type JobHandler = (
  payload: Record<string, any>,
  jobId: string,
  signal: AbortSignal
) => Promise<any>;

/**
 * BackgroundJobManagerクラス
 */
export class BackgroundJobManager {
  private redisClient: RedisClientType | null = null;
  private config: Required<BackgroundJobManagerConfig>;
  private handlers: Map<string, JobHandler> = new Map();
  private workers: Array<{ id: string; active: boolean }> = [];
  private workerPromises: Promise<void>[] = [];
  private shuttingDown = false;

  constructor(config: BackgroundJobManagerConfig) {
    this.config = {
      redisUrl: config.redisUrl,
      maxWorkers: config.maxWorkers ?? 4,
      jobTimeout: config.jobTimeout ?? 30000,
      retryDelay: config.retryDelay ?? 1000,
    };
  }

  /**
   * Redisクライアントを初期化
   */
  public async initialize(): Promise<void> {
    this.redisClient = createClient({ url: this.config.redisUrl });

    this.redisClient.on('error', (err) => {
      console.error('Redis client error:', err);
    });

    await this.redisClient.connect();
  }

  /**
   * ジョブをキューに投入
   */
  public async enqueue(params: EnqueueParams): Promise<string> {
    if (!this.redisClient) {
      throw new Error('BackgroundJobManager not initialized');
    }

    const jobId = randomUUID();
    const priority = params.priority ?? JobPriority.NORMAL;

    const job: Job = {
      id: jobId,
      type: params.type,
      payload: params.payload,
      priority,
      status: JobStatus.PENDING,
      maxRetries: params.maxRetries ?? 3,
      retryCount: 0,
      createdAt: Date.now(),
    };

    // ジョブ情報をハッシュに保存
    await this.redisClient.hSet(`jobs:data:${jobId}`, {
      id: job.id,
      type: job.type,
      payload: JSON.stringify(job.payload),
      priority: job.priority,
      status: job.status,
      maxRetries: job.maxRetries.toString(),
      retryCount: job.retryCount.toString(),
      createdAt: job.createdAt.toString(),
    });

    // 優先度別キューに追加
    const queueKey = `jobs:queue:${priority}`;
    await this.redisClient.lPush(queueKey, jobId);

    return jobId;
  }

  /**
   * ジョブハンドラーを登録
   */
  public registerHandler(jobType: string, handler: JobHandler): void {
    this.handlers.set(jobType, handler);
  }

  /**
   * Workerプールを開始
   */
  public async startWorkers(): Promise<void> {
    for (let i = 0; i < this.config.maxWorkers; i++) {
      const workerId = `worker-${i + 1}`;
      this.workers.push({ id: workerId, active: false });

      const workerPromise = this.runWorker(workerId);
      this.workerPromises.push(workerPromise);
    }
  }

  /**
   * Worker実行ループ
   */
  private async runWorker(workerId: string): Promise<void> {
    if (!this.redisClient) return;

    while (!this.shuttingDown) {
      try {
        // 優先度順にジョブを取得（高→通常→低）
        const result = await this.redisClient.brPop(
          [
            'jobs:queue:high',
            'jobs:queue:normal',
            'jobs:queue:low',
          ],
          1 // 1秒タイムアウト
        );

        if (this.shuttingDown) {
          break; // シャットダウン中なら終了
        }

        if (!result) {
          continue; // タイムアウト、次のループへ
        }

        const jobId = result.element;
        const worker = this.workers.find((w) => w.id === workerId);
        if (worker) worker.active = true;

        await this.processJob(jobId);

        if (worker) worker.active = false;
      } catch (error) {
        console.error(`Worker ${workerId} error:`, error);
        // Redis接続エラーの場合はループを抜ける
        if (!this.redisClient?.isOpen) {
          break;
        }
      }
    }
  }

  /**
   * ジョブを処理
   */
  private async processJob(jobId: string): Promise<void> {
    if (!this.redisClient) return;

    try {
      // ジョブ情報を取得
      const jobData = await this.redisClient.hGetAll(`jobs:data:${jobId}`);
      if (!jobData || !jobData['type']) {
        console.warn(`Job ${jobId} not found or missing type`);
        return;
      }

      // payloadを安全にパース
      let payload: Record<string, any> = {};
      const rawPayload = jobData['payload'] ?? '{}';
      try {
        payload = JSON.parse(rawPayload);
      } catch (parseError) {
        console.warn(
          `Failed to parse payload for job ${jobId}. Raw payload: ${rawPayload}`,
          parseError
        );
        // パース失敗時はジョブを失敗としてマーク
        await this.updateJobStatus(jobId, JobStatus.FAILED, {
          completedAt: Date.now().toString(),
          error: `Invalid JSON payload: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}`,
        });
        return;
      }

      const job: Job = {
        id: jobData['id'] ?? jobId,
        type: jobData['type'],
        payload,
        priority: (jobData['priority'] as JobPriority) ?? JobPriority.NORMAL,
        status: (jobData['status'] as JobStatus) ?? JobStatus.PENDING,
        maxRetries: parseInt(jobData['maxRetries'] ?? '3', 10),
        retryCount: parseInt(jobData['retryCount'] ?? '0', 10),
        createdAt: jobData['createdAt'] ? parseInt(jobData['createdAt'], 10) : 0,
      };

      // ステータスを処理中に更新
      await this.updateJobStatus(jobId, JobStatus.PROCESSING, {
        startedAt: Date.now().toString(),
      });

      // ハンドラーを取得
      const handler = this.handlers.get(job.type);
      if (!handler) {
        throw new Error(`No handler registered for job type: ${job.type}`);
      }

      // AbortControllerを作成してタイムアウト時にキャンセルできるようにする
      const abortController = new AbortController();

      // タイムアウト付きでハンドラーを実行
      const result = await this.executeWithTimeout(
        handler(job.payload, job.id, abortController.signal),
        this.config.jobTimeout,
        abortController
      );

      // 成功
      await this.updateJobStatus(jobId, JobStatus.COMPLETED, {
        completedAt: Date.now().toString(),
        result: JSON.stringify(result),
      });
    } catch (error) {
      // エラー処理
      await this.handleJobError(jobId, error);
    }
  }

  /**
   * タイムアウト付きで関数を実行
   * タイムアウト時にAbortControllerを使用してジョブをキャンセルし、リソースリークを防ぐ
   */
  private async executeWithTimeout<T>(
    promise: Promise<T>,
    timeout: number,
    abortController: AbortController
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeoutId = setTimeout(() => {
            // タイムアウト時にAbortControllerをトリガーしてジョブをキャンセル
            abortController.abort();
            reject(new Error('Job execution timeout'));
          }, timeout);
        }),
      ]);
    } finally {
      // タイムアウトをクリア
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * ジョブエラーをハンドリング
   */
  private async handleJobError(jobId: string, error: unknown): Promise<void> {
    if (!this.redisClient) return;

    const jobData = await this.redisClient.hGetAll(`jobs:data:${jobId}`);
    if (!jobData) return;

    const retryCount = parseInt(jobData['retryCount'] ?? '0', 10);
    const maxRetries = parseInt(jobData['maxRetries'] ?? '3', 10);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (retryCount < maxRetries) {
      // リトライ
      await this.updateJobStatus(jobId, JobStatus.RETRYING, {
        retryCount: (retryCount + 1).toString(),
        error: errorMessage,
      });

      // 遅延後に再キュー
      // シャットダウン時に this.redisClient が null になる可能性があるため、
      // setTimeout スケジュール前にローカル変数にキャプチャ
      const redis = this.redisClient;
      const priority = (jobData['priority'] as JobPriority) ?? JobPriority.NORMAL;
      setTimeout(async () => {
        // redis が null でないことを確認してから lPush を呼び出す
        if (redis && redis.isOpen) {
          await redis.lPush(`jobs:queue:${priority}`, jobId);
        }
      }, this.config.retryDelay);
    } else {
      // 最大リトライ回数を超えた場合、デッドレターキューに移動
      await this.updateJobStatus(jobId, JobStatus.FAILED, {
        completedAt: Date.now().toString(),
        error: errorMessage,
      });

      await this.redisClient.lPush('jobs:queue:dlq', jobId);
    }
  }

  /**
   * ジョブステータスを更新
   */
  private async updateJobStatus(
    jobId: string,
    status: JobStatus,
    additionalFields?: Record<string, string>
  ): Promise<void> {
    if (!this.redisClient) return;

    const updates: Record<string, string> = {
      status,
      ...additionalFields,
    };

    await this.redisClient.hSet(`jobs:data:${jobId}`, updates);
  }

  /**
   * ジョブステータスを取得
   */
  public async getJobStatus(jobId: string): Promise<Job | null> {
    if (!this.redisClient) {
      throw new Error('BackgroundJobManager not initialized');
    }

    const jobData = await this.redisClient.hGetAll(`jobs:data:${jobId}`);
    if (!jobData || !jobData['id']) {
      return null;
    }

    // payloadを安全にパース
    let payload: Record<string, any> = {};
    const rawPayload = jobData['payload'] ?? '{}';
    try {
      payload = JSON.parse(rawPayload);
    } catch (parseError) {
      console.warn(
        `Failed to parse payload for job ${jobId}. Raw payload: ${rawPayload}`,
        parseError
      );
      // パース失敗時は空オブジェクトを使用
    }

    return {
      id: jobData['id'],
      type: jobData['type'] ?? 'unknown',
      payload,
      priority: (jobData['priority'] as JobPriority) ?? JobPriority.NORMAL,
      status: (jobData['status'] as JobStatus) ?? JobStatus.PENDING,
      maxRetries: parseInt(jobData['maxRetries'] ?? '3', 10),
      retryCount: parseInt(jobData['retryCount'] ?? '0', 10),
      createdAt: jobData['createdAt'] ? parseInt(jobData['createdAt'], 10) : 0,
      startedAt: jobData['startedAt'] ? parseInt(jobData['startedAt'], 10) : undefined,
      completedAt: jobData['completedAt'] ? parseInt(jobData['completedAt'], 10) : undefined,
      error: jobData['error'],
      progress: jobData['progress'] ? parseInt(jobData['progress'], 10) : undefined,
      progressMessage: jobData['progressMessage'],
    };
  }

  /**
   * ジョブの進捗を更新
   */
  public async updateJobProgress(
    jobId: string,
    progress: number,
    message?: string
  ): Promise<void> {
    if (!this.redisClient) {
      throw new Error('BackgroundJobManager not initialized');
    }

    const updates: Record<string, string> = {
      progress: progress.toString(),
    };

    if (message) {
      updates['progressMessage'] = message;
    }

    await this.redisClient.hSet(`jobs:data:${jobId}`, updates);
  }

  /**
   * キュー統計情報を取得
   */
  public async getQueueStats(): Promise<QueueStats> {
    if (!this.redisClient) {
      throw new Error('BackgroundJobManager not initialized');
    }

    const [highPriority, normalPriority, lowPriority] = await Promise.all([
      this.redisClient.lLen('jobs:queue:high'),
      this.redisClient.lLen('jobs:queue:normal'),
      this.redisClient.lLen('jobs:queue:low'),
    ]);

    return {
      highPriority,
      normalPriority,
      lowPriority,
      total: highPriority + normalPriority + lowPriority,
    };
  }

  /**
   * Worker統計情報を取得
   */
  public getWorkerStats(): WorkerStats {
    const activeWorkers = this.workers.filter((w) => w.active).length;

    return {
      totalWorkers: this.workers.length,
      activeWorkers,
      idleWorkers: this.workers.length - activeWorkers,
    };
  }

  /**
   * シャットダウン
   */
  public async shutdown(): Promise<void> {
    this.shuttingDown = true;

    // すべてのWorkerの完了を待つ
    await Promise.all(this.workerPromises);

    // Redisクライアントを切断
    if (this.redisClient) {
      await this.redisClient.disconnect();
      this.redisClient = null;
    }

    // Workerリストをクリア
    this.workers = [];
    this.workerPromises = [];
  }
}
