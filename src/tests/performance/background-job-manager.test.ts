/**
 * BackgroundJobManagerのユニットテスト
 *
 * タスク10.1: パフォーマンスチューニング - 非同期処理とバックグラウンドジョブ
 * Requirements: 7.1 (P95 < 2秒), 7.3 (同時アクセス制御)
 *
 * テスト対象:
 * - ジョブキューの管理
 * - Worker poolによる並列実行
 * - ジョブの優先度制御
 * - エラーハンドリングとリトライ
 * - ジョブの進捗追跡
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// モック変数
let mockRedisClient: any;

// Redisモック - createClientが呼ばれた時点でmockRedisClientを返す
vi.mock('redis', () => {
  return {
    createClient: vi.fn(() => {
      // この時点でmockRedisClientは初期化されている
      return mockRedisClient;
    }),
  };
});

import { BackgroundJobManager, JobPriority, JobStatus } from '../../performance/background-job-manager';

describe('BackgroundJobManager - Task 10.1: Async Processing', () => {
  let manager: BackgroundJobManager;

  beforeEach(() => {
    let shuttingDown = false;

    // Redisクライアントのモック
    // BackgroundJobManagerのインスタンス作成
    manager = new BackgroundJobManager({
      redisUrl: 'redis://localhost:6379',
      maxWorkers: 2,
      jobTimeout: 30000,
    });

    let brPopCallCount = 0;
    // brPopのモック応答キュー
    const mockBrPopResponses: any[] = [];

    // テストヘルパー: brPopの応答をキューに追加
    (global as any).queueMockBrPopResponse = (response: any) => {
      mockBrPopResponses.push(response);
    };

    // Redisクライアントのモック
    mockRedisClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockImplementation(async () => {
        shuttingDown = true;
        mockRedisClient.isOpen = false;
        // console.log('Redis mock: Disconnect called, shuttingDown = true');
      }),
      lPush: vi.fn().mockResolvedValue(1),
      // デフォルトはタイムアウト（null返却）
      // メモリリーク防止のため、vi.fn()ではなく通常の関数を使用
      brPop: async () => {
        brPopCallCount++;
        if (brPopCallCount > 1000) {
          console.error('Infinite loop detected in brPop mock');
          throw new Error('Infinite loop detected in brPop mock');
        }

        // モック応答があればそれを返す
        if (mockBrPopResponses.length > 0) {
          const response = mockBrPopResponses.shift();
          // 即座に返すのではなく、少し待機して非同期性をシミュレート
          await new Promise((resolve) => setTimeout(resolve, 10));
          return response;
        }

        // Managerがシャットダウン中か、Redisが切断されていたら
        // 即座にnullを返す（ホットループ防止のため0ms待機）
        const isManagerShuttingDown = (manager as any)?.shuttingDown;
        if (shuttingDown || !mockRedisClient.isOpen || isManagerShuttingDown) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          return null;
        }
        // 通常のタイムアウト待機
        await new Promise((resolve) => setTimeout(resolve, 50));
        return null;
      },
      hSet: vi.fn().mockResolvedValue(1),
      hGetAll: vi.fn(),
      del: vi.fn().mockResolvedValue(1),
      lLen: vi.fn().mockResolvedValue(0),
      on: vi.fn(),
      isOpen: true, // Redis接続状態
    };
  });

  afterEach(async () => {
    try {
      await manager.shutdown();
      // console.log('Manager shutdown completed');
    } catch (error) {
      // Shutdown errors are acceptable in tests
      console.warn('Shutdown error in test:', error);
    }
    vi.clearAllMocks();
  }, 10000); // 10秒のタイムアウト

  describe('Job Queue Management', () => {
    it('should enqueue a job with default priority', async () => {
      await manager.initialize();

      const jobId = await manager.enqueue({
        type: 'embeddings_generation',
        payload: { memoryId: 'test-memory-1', content: 'Test content' },
      });

      expect(jobId).toBeTruthy();
      expect(mockRedisClient.lPush).toHaveBeenCalled();
      expect(mockRedisClient.hSet).toHaveBeenCalled();
    });

    it('should enqueue a job with high priority', async () => {
      await manager.initialize();

      const jobId = await manager.enqueue({
        type: 'embeddings_generation',
        payload: { memoryId: 'test-memory-1', content: 'Test content' },
        priority: JobPriority.HIGH,
      });

      expect(jobId).toBeTruthy();
      // 高優先度キューに追加されることを確認
      expect(mockRedisClient.lPush).toHaveBeenCalledWith(
        expect.stringContaining(':high'),
        expect.any(String)
      );
    });

    it('should get job status', async () => {
      await manager.initialize();

      const jobId = 'test-job-123';
      mockRedisClient.hGetAll.mockResolvedValue({
        id: jobId,
        type: 'embeddings_generation',
        status: JobStatus.PENDING,
        createdAt: Date.now().toString(),
      });

      const status = await manager.getJobStatus(jobId);

      expect(status).toBeDefined();
      expect(status?.id).toBe(jobId);
      expect(status?.status).toBe(JobStatus.PENDING);
    });

    it('should get queue statistics', async () => {
      await manager.initialize();

      mockRedisClient.lLen
        .mockResolvedValueOnce(5) // high priority
        .mockResolvedValueOnce(10) // normal priority
        .mockResolvedValueOnce(3); // low priority

      const stats = await manager.getQueueStats();

      expect(stats.highPriority).toBe(5);
      expect(stats.normalPriority).toBe(10);
      expect(stats.lowPriority).toBe(3);
      expect(stats.total).toBe(18);
    });
  });

  describe('Worker Pool Management', () => {
    it('should start worker pool', async () => {
      await manager.initialize();
      await manager.startWorkers();

      // Workerが起動するのを待つ
      await new Promise((resolve) => setTimeout(resolve, 50));

      const workerStats = manager.getWorkerStats();

      expect(workerStats.totalWorkers).toBe(2); // maxWorkers設定通り
      expect(workerStats.activeWorkers).toBe(0); // 初期状態
      expect(workerStats.idleWorkers).toBe(2);
    });

    it('should process jobs with workers', async () => {
      await manager.initialize();

      // ジョブハンドラーを登録
      const handler = vi.fn().mockResolvedValue({ success: true });
      manager.registerHandler('test_job', handler);

      // ジョブをキューに追加
      const jobId = await manager.enqueue({
        type: 'test_job',
        payload: { data: 'test' },
      });

      // モック: 最初の1回だけジョブを返す
      (global as any).queueMockBrPopResponse({
        key: 'jobs:queue:normal',
        element: jobId,
      });

      mockRedisClient.hGetAll.mockResolvedValue({
        id: jobId,
        type: 'test_job',
        status: JobStatus.PENDING,
        payload: JSON.stringify({ data: 'test' }),
        createdAt: Date.now().toString(),
        maxRetries: '3',
        retryCount: '0',
      });

      await manager.startWorkers();

      // ジョブが処理されるまで待機
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalledWith({ data: 'test' }, expect.any(String), expect.any(Object));
    });

    it('should handle job timeout', async () => {
      // 短いタイムアウトでManagerを再作成
      await manager.shutdown(); // 前のManagerをクリーンアップ
      manager = new BackgroundJobManager({
        redisUrl: 'redis://localhost:6379',
        maxWorkers: 2,
        jobTimeout: 50, // 50msでタイムアウト
      });
      await manager.initialize();

      // タイムアウトするハンドラーを登録
      let signalAborted = false;
      const handler = vi.fn().mockImplementation(
        (_payload, _jobId, signal: AbortSignal) => {
          // AbortSignalのabortイベントをリッスン
          signal.addEventListener('abort', () => {
            signalAborted = true;
          });
          return new Promise((resolve) => setTimeout(resolve, 200)); // タイムアウトより長く待つ
        }
      );
      manager.registerHandler('slow_job', handler);

      const jobId = await manager.enqueue({
        type: 'slow_job',
        payload: { data: 'test' },
      });

      (global as any).queueMockBrPopResponse({
        key: 'jobs:queue:normal',
        element: jobId,
      });

      mockRedisClient.hGetAll.mockResolvedValue({
        id: jobId,
        type: 'slow_job',
        status: JobStatus.PENDING,
        payload: JSON.stringify({ data: 'test' }),
        createdAt: Date.now().toString(),
        maxRetries: '3',
        retryCount: '3', // リトライ上限に達している状態にする
      });

      await manager.startWorkers();

      // タイムアウトまで待機 (50ms + マージン)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // タイムアウトによりジョブが失敗することを確認
      // hSetはオブジェクトで呼ばれる可能性があるため、objectContainingを使用
      expect(mockRedisClient.hSet).toHaveBeenCalledWith(
        `jobs:data:${jobId}`,
        expect.objectContaining({
          status: JobStatus.FAILED,
          error: 'Job execution timeout'
        })
      );

      // AbortSignalがabortされたことを確認
      expect(signalAborted).toBe(true);
    });
  });

  describe('Error Handling and Retry', () => {
    it('should retry failed jobs', async () => {
      await manager.initialize();

      let attemptCount = 0;
      const handler = vi.fn().mockImplementation((_payload, _jobId, _signal: AbortSignal) => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Temporary failure');
        }
        return Promise.resolve({ success: true });
      });

      manager.registerHandler('retry_job', handler);

      const jobId = await manager.enqueue({
        type: 'retry_job',
        payload: { data: 'test' },
        maxRetries: 3,
      });

      // ジョブ処理のシミュレーション（3回試行）
      (global as any).queueMockBrPopResponse({ key: 'jobs:queue:normal', element: jobId });
      (global as any).queueMockBrPopResponse({ key: 'jobs:queue:normal', element: jobId });
      (global as any).queueMockBrPopResponse({ key: 'jobs:queue:normal', element: jobId });

      let retryCount = 0;
      mockRedisClient.hGetAll.mockImplementation(() => {
        const currentRetry = retryCount;
        retryCount++;
        return Promise.resolve({
          id: jobId,
          type: 'retry_job',
          status: JobStatus.PENDING,
          payload: JSON.stringify({ data: 'test' }),
          maxRetries: '3',
          retryCount: currentRetry.toString(),
          createdAt: Date.now().toString(),
        });
      });

      await manager.startWorkers();

      // リトライが完了するまで待機
      await new Promise((resolve) => setTimeout(resolve, 200));

      // 3回試行されることを確認
      expect(handler).toHaveBeenCalledTimes(3);
    });

    it('should move to dead letter queue after max retries', async () => {
      await manager.initialize();

      const handler = vi.fn().mockRejectedValue(new Error('Persistent failure'));
      manager.registerHandler('failing_job', handler);

      const jobId = await manager.enqueue({
        type: 'failing_job',
        payload: { data: 'test' },
        maxRetries: 2,
      });

      (global as any).queueMockBrPopResponse({ key: 'jobs:queue:normal', element: jobId });

      mockRedisClient.hGetAll.mockResolvedValue({
        id: jobId,
        type: 'failing_job',
        status: JobStatus.PENDING,
        payload: JSON.stringify({ data: 'test' }),
        maxRetries: '2',
        retryCount: '2',
        createdAt: Date.now().toString(),
      });

      await manager.startWorkers();

      // 処理完了まで待機
      await new Promise((resolve) => setTimeout(resolve, 100));

      // デッドレターキューに移動されることを確認
      expect(mockRedisClient.lPush).toHaveBeenCalledWith(
        expect.stringContaining(':dlq'),
        jobId
      );
    });
  });

  describe('Job Progress Tracking', () => {
    it('should update job progress', async () => {
      await manager.initialize();

      const jobId = 'test-job-456';

      await manager.updateJobProgress(jobId, 50, 'Processing embeddings');

      expect(mockRedisClient.hSet).toHaveBeenCalledWith(
        expect.stringContaining(jobId),
        expect.objectContaining({
          progress: '50',
          progressMessage: 'Processing embeddings',
        })
      );
    });

    it('should track job completion', async () => {
      await manager.initialize();

      const handler = vi.fn().mockResolvedValue({ result: 'success' });
      manager.registerHandler('tracked_job', handler);

      const jobId = await manager.enqueue({
        type: 'tracked_job',
        payload: { data: 'test' },
      });

      (global as any).queueMockBrPopResponse({ key: 'jobs:queue:normal', element: jobId });

      mockRedisClient.hGetAll.mockResolvedValue({
        id: jobId,
        type: 'tracked_job',
        status: JobStatus.PENDING,
        payload: JSON.stringify({ data: 'test' }),
        createdAt: Date.now().toString(),
        maxRetries: '3',
        retryCount: '0',
      });

      await manager.startWorkers();

      // 処理完了まで待機
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 完了ステータスに更新されることを確認
      expect(mockRedisClient.hSet).toHaveBeenCalledWith(
        expect.stringContaining(jobId),
        expect.objectContaining({
          status: JobStatus.COMPLETED,
        })
      );
    });
  });

  describe('Lifecycle Management', () => {
    it('should gracefully shutdown workers', async () => {
      await manager.initialize();
      await manager.startWorkers();

      await manager.shutdown();

      const stats = manager.getWorkerStats();
      expect(stats.totalWorkers).toBe(0);
      expect(mockRedisClient.disconnect).toHaveBeenCalled();
    });

    it('should wait for active jobs to complete during shutdown', async () => {
      await manager.initialize();

      let jobCompleted = false;
      const handler = vi.fn().mockImplementation(
        (_payload, _jobId, _signal: AbortSignal) =>
          new Promise((resolve) => {
            setTimeout(() => {
              jobCompleted = true;
              resolve({ success: true });
            }, 50);
          })
      );

      manager.registerHandler('slow_job', handler);

      const jobId = await manager.enqueue({
        type: 'slow_job',
        payload: { data: 'test' },
      });

      (global as any).queueMockBrPopResponse({ key: 'jobs:queue:normal', element: jobId });

      mockRedisClient.hGetAll.mockResolvedValue({
        id: jobId,
        type: 'slow_job',
        status: JobStatus.PENDING,
        payload: JSON.stringify({ data: 'test' }),
        createdAt: Date.now().toString(),
        maxRetries: '3',
        retryCount: '0',
      });

      await manager.startWorkers();

      // ジョブが開始するのを待つ
      await new Promise((resolve) => setTimeout(resolve, 10));

      // シャットダウン（ジョブ完了を待つ）
      await manager.shutdown();

      expect(jobCompleted).toBe(true);
    });
  });
});
