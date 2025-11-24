import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BackgroundJobManager, JobPriority, JobStatus } from '../../performance/background-job-manager';

// Mock redis
const mockRedisClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  disconnect: vi.fn().mockResolvedValue(undefined),
  hSet: vi.fn().mockResolvedValue(1),
  lPush: vi.fn().mockResolvedValue(1),
  brPop: vi.fn(),
  hGetAll: vi.fn(),
  lLen: vi.fn().mockResolvedValue(0),
  isOpen: true,
};

vi.mock('redis', () => ({
  createClient: vi.fn(() => mockRedisClient),
}));

describe('BackgroundJobManager', () => {
  let jobManager: BackgroundJobManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRedisClient.isOpen = true;
    jobManager = new BackgroundJobManager({ redisUrl: 'redis://localhost:6379' });
    await jobManager.initialize();
  });

  afterEach(async () => {
    await jobManager.shutdown();
  });

  it('should enqueue a job correctly', async () => {
    const params = {
      type: 'test-job',
      payload: { data: 'test' },
      priority: JobPriority.NORMAL,
    };

    const jobId = await jobManager.enqueue(params);

    expect(mockRedisClient.hSet).toHaveBeenCalledWith(
      expect.stringContaining('jobs:data:'),
      expect.objectContaining({
        type: 'test-job',
        priority: 'normal',
        status: 'pending',
      })
    );
    expect(mockRedisClient.lPush).toHaveBeenCalledWith(
      'jobs:queue:normal',
      expect.any(String)
    );
    expect(jobId).toBeDefined();
  });

  it('should process a job when worker is started', async () => {
    const jobId = 'test-job-id';
    const jobData = {
      id: jobId,
      type: 'test-job',
      payload: JSON.stringify({ foo: 'bar' }),
      priority: 'normal',
      status: 'pending',
      maxRetries: '3',
      retryCount: '0',
      createdAt: Date.now().toString(),
    };

    // Mock redis responses for worker loop
    mockRedisClient.brPop.mockResolvedValueOnce({
      key: 'jobs:queue:normal',
      element: jobId,
    });
    // Second call to brPop should block or return null/error to stop loop if we want, 
    // but since runWorker loops, we need to be careful. 
    // We can make it return null to simulate timeout or just let shutdown handle it.
    mockRedisClient.brPop.mockImplementation(async () => {
      // Wait a bit to prevent tight loop in test
      await new Promise(r => setTimeout(r, 100));
      return null; 
    });

    mockRedisClient.hGetAll.mockResolvedValue(jobData);

    const handler = vi.fn().mockResolvedValue('result');
    jobManager.registerHandler('test-job', handler);

    // Start workers
    await jobManager.startWorkers();

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(handler).toHaveBeenCalledWith(
      { foo: 'bar' },
      jobId,
      expect.any(AbortSignal)
    );

    // Verify status update to completed
    expect(mockRedisClient.hSet).toHaveBeenCalledWith(
      `jobs:data:${jobId}`,
      expect.objectContaining({
        status: JobStatus.COMPLETED,
      })
    );
  });

  it('should handle job failure and retry', async () => {
    const jobId = 'failed-job-id';
    const jobData = {
      id: jobId,
      type: 'fail-job',
      payload: '{}',
      priority: 'normal',
      status: 'pending',
      maxRetries: '3',
      retryCount: '0',
      createdAt: Date.now().toString(),
    };

    mockRedisClient.brPop.mockResolvedValueOnce({
      key: 'jobs:queue:normal',
      element: jobId,
    });
    mockRedisClient.hGetAll.mockResolvedValue(jobData);

    const handler = vi.fn().mockRejectedValue(new Error('Task failed'));
    jobManager.registerHandler('fail-job', handler);

    await jobManager.startWorkers();
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(mockRedisClient.hSet).toHaveBeenCalledWith(
      `jobs:data:${jobId}`,
      expect.objectContaining({
        status: JobStatus.RETRYING,
        retryCount: '1',
      })
    );
  });
});