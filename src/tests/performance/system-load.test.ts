
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryManager } from '../../memory/memory-manager.js';
import { QueryProcessor } from '../../query/query-processor.js';
import { VectorStoreAdapter } from '../../storage/vector-store-adapter.js';

// Minimal mocks for performance test
const mockVectorStore = {
  storeWithEmbedding: vi.fn().mockResolvedValue('vec-id'),
  searchSimilar: vi.fn().mockResolvedValue([]),
  deleteVector: vi.fn(),
} as unknown as VectorStoreAdapter;

describe('System Load & Performance Tests (Task 12.3)', () => {
  let memoryManager: MemoryManager;

  beforeEach(() => {
    memoryManager = new MemoryManager({
      vectorStore: mockVectorStore,
    });
  });

  it('should handle high concurrency of store operations', async () => {
    const CONCURRENCY = 1000;
    const requests = Array.from({ length: CONCURRENCY }, (_, i) => ({
      content: `Performance test content ${i}`,
      metadata: { index: i }
    }));

    const start = performance.now();
    
    const results = await Promise.all(
      requests.map(req => memoryManager.storeMemory(req))
    );
    
    const end = performance.now();
    const durationMs = end - start;
    const tps = (CONCURRENCY / durationMs) * 1000;

    console.log(`[Load Test] Stored ${CONCURRENCY} items in ${durationMs.toFixed(2)}ms. TPS: ${tps.toFixed(2)}`);

    // Assertions
    expect(results.length).toBe(CONCURRENCY);
    expect(results.every(r => r.success)).toBe(true);
    
    // Verify simple SLA (mocked system should be fast)
    expect(tps).toBeGreaterThan(100); // Conservative baseline
  });

  it('should search within response time limits (simulated DB latency)', async () => {
     // We simulate DB latency to verify overhead is minimal
     const DELAY = 50; // 50ms DB delay
     
     const delayedVectorStore = {
         ...mockVectorStore,
         searchSimilar: vi.fn().mockImplementation(async () => {
             await new Promise(resolve => setTimeout(resolve, DELAY));
             return [];
         })
     } as unknown as VectorStoreAdapter;
     
     const perfProcessor = new QueryProcessor({ vectorAdapter: delayedVectorStore });
     
     const start = performance.now();
     await perfProcessor.hybridSearch('test');
     const end = performance.now();
     
     const duration = end - start;
     
     // Overhead should be small (< 50ms added to delay)
     // If it takes > 100ms total, something is adding too much overhead
     expect(duration).toBeLessThan(DELAY + 50); 
  });
});
