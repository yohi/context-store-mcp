/**
 * BatchProcessorのユニットテスト
 *
 * タスク10.1: パフォーマンスチューニング - バッチ処理の並列化
 * Requirements: 7.2 (1000 req/sec)
 *
 * テスト対象:
 * - バッチ並列処理
 * - レート制限対応
 * - BackgroundJobManager統合
 * - 同時実行数制御
 * - エラーハンドリング
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BatchProcessor } from '../../performance/batch-processor';
import { BackgroundJobManager, JobPriority } from '../../performance/background-job-manager';

describe('BatchProcessor - Task 10.1: Batch Processing', () => {
  let processor: BatchProcessor;
  let mockJobManager: any;

  beforeEach(() => {
    // BackgroundJobManagerのモック
    mockJobManager = {
      enqueue: vi.fn().mockResolvedValue('job-id-123'),
    };

    processor = new BatchProcessor({
      jobManager: mockJobManager as BackgroundJobManager,
      maxConcurrency: 3,
      batchSize: 10,
      rateLimitTPM: 90000,
      rateLimitRPM: 100,
    });
  });

  describe('Batch Processing', () => {
    it('should process items in parallel with concurrency limit', async () => {
      const items = Array.from({ length: 20 }, (_, i) => i);
      let concurrentCount = 0;
      let maxConcurrent = 0;

      const processorFn = async (item: number) => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await new Promise((resolve) => setTimeout(resolve, 10));
        concurrentCount--;
        return item * 2;
      };

      const result = await processor.processBatch(items, processorFn);

      expect(result.successful.length).toBe(20);
      expect(result.failed.length).toBe(0);
      expect(result.totalProcessed).toBe(20);
      expect(maxConcurrent).toBeLessThanOrEqual(3); // maxConcurrency制限
    });

    it('should handle processing errors gracefully', async () => {
      const items = [1, 2, 3, 4, 5];

      const processorFn = async (item: number) => {
        if (item === 3) {
          throw new Error('Processing failed');
        }
        return item * 2;
      };

      const result = await processor.processBatch(items, processorFn);

      expect(result.successful.length).toBe(4);
      expect(result.failed.length).toBe(1);
      expect(result.failed[0].item).toBe(3);
      expect(result.totalProcessed).toBe(5);
    });

    it('should split items into batches', async () => {
      const items = Array.from({ length: 25 }, (_, i) => i);

      const processorFn = async (item: number) => item;

      const result = await processor.processBatch(items, processorFn);

      expect(result.successful.length).toBe(25);
      expect(result.totalProcessed).toBe(25);
    });
  });

  describe('BackgroundJobManager Integration', () => {
    it('should enqueue embeddings generation jobs', async () => {
      const contents = ['content1', 'content2', 'content3'];

      const jobIds = await processor.generateEmbeddingsBatch(contents, JobPriority.HIGH);

      expect(jobIds.length).toBe(3);
      expect(mockJobManager.enqueue).toHaveBeenCalledTimes(3);
      expect(mockJobManager.enqueue).toHaveBeenCalledWith({
        type: 'embeddings_generation',
        payload: { content: 'content1' },
        priority: JobPriority.HIGH,
      });
    });

    it('should enqueue data sync jobs', async () => {
      const memoryIds = ['mem1', 'mem2', 'mem3'];

      const jobIds = await processor.syncDataBatch(memoryIds, JobPriority.NORMAL);

      expect(jobIds.length).toBe(3);
      expect(mockJobManager.enqueue).toHaveBeenCalledTimes(3);
      expect(mockJobManager.enqueue).toHaveBeenCalledWith({
        type: 'data_sync',
        payload: { memoryId: 'mem1' },
        priority: JobPriority.NORMAL,
      });
    });
  });

  describe('Rate Limiting', () => {
    it('should track request and token counts', async () => {
      const items = [1, 2, 3];

      await processor.processBatch(items, async (item) => item);

      const stats = processor.getRateLimitStats();

      expect(stats.requestCount).toBeGreaterThan(0);
      expect(stats.tokenCount).toBeGreaterThan(0);
      expect(stats.requestsRemaining).toBeLessThanOrEqual(100);
    });

    it('should use dynamic token estimation', async () => {
      const items = ['short', 'longer content', 'very long content for testing'];
      const processorFn = async (item: string) => item;

      await processor.processBatch(items, processorFn, {
        itemToContent: (item) => item,
      });

      const stats = processor.getRateLimitStats();

      // 'short' -> 5 chars -> ceil(5/4) = 2
      // 'longer content' -> 14 chars -> ceil(14/4) = 4
      // 'very long content for testing' -> 29 chars -> ceil(29/4) = 8
      // Total: 14 tokens
      expect(stats.tokenCount).toBe(14);
    });

    it('should provide rate limit statistics', () => {
      const stats = processor.getRateLimitStats();

      expect(stats).toHaveProperty('requestCount');
      expect(stats).toHaveProperty('tokenCount');
      expect(stats).toHaveProperty('requestsRemaining');
      expect(stats).toHaveProperty('tokensRemaining');
    });
  });

  describe('Performance', () => {
    it('should process large batches efficiently', async () => {
      const items = Array.from({ length: 100 }, (_, i) => i);

      const startTime = Date.now();

      const result = await processor.processBatch(items, async (item) => item);

      const duration = Date.now() - startTime;

      expect(result.successful.length).toBe(100);
      expect(result.duration).toBeGreaterThan(0);
      expect(duration).toBeLessThan(5000); // 5秒以内に完了
    });
  });
});
