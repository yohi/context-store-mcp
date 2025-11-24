import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BatchProcessor } from '../../performance/batch-processor';
import { BackgroundJobManager, JobPriority } from '../../performance/background-job-manager';

vi.mock('../../performance/background-job-manager');

describe('BatchProcessor', () => {
  let processor: BatchProcessor;
  let mockJobManager: any;

  beforeEach(() => {
    mockJobManager = {
      enqueue: vi.fn().mockResolvedValue('job-id'),
    };
    processor = new BatchProcessor({
      jobManager: mockJobManager,
      batchSize: 2,
      maxConcurrency: 2
    });
  });

  it('should process items in batches and return results', async () => {
    const items = [1, 2, 3, 4, 5];
    const processFn = vi.fn().mockImplementation(async (item) => item * 2);

    const result = await processor.processBatch(items, processFn);

    expect(processFn).toHaveBeenCalledTimes(5);
    // Order might not be guaranteed due to concurrency, but values should be present
    expect(result.successful.sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10]);
    expect(result.failed).toHaveLength(0);
  });

  it('should generate embeddings batch via job manager', async () => {
    const contents = ['a', 'b', 'c'];
    const jobIds = await processor.generateEmbeddingsBatch(contents);
    
    expect(mockJobManager.enqueue).toHaveBeenCalledTimes(3);
    expect(mockJobManager.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      type: 'embeddings_generation',
      payload: { content: 'a' }
    }));
  });

  it('should handle rate limiting stats update', async () => {
     const items = [1];
     const processFn = vi.fn().mockResolvedValue(1);
     await processor.processBatch(items, processFn);
     
     const stats = processor.getRateLimitStats();
     expect(stats.requestCount).toBe(1);
  });
});