import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { MemoryManager } from '../../memory/memory-manager.js';
import { VectorStoreAdapter } from '../../storage/vector-store-adapter.js';
import { GraphStoreAdapter } from '../../storage/graph-store-adapter.js';
import { TransactionCoordinator } from '../../storage/transaction-coordinator.js';

// Mocks
vi.mock('../../storage/vector-store-adapter.js');
vi.mock('../../storage/graph-store-adapter.js');
vi.mock('../../storage/transaction-coordinator.js');

describe('MemoryManager Integration', () => {
  let memoryManager: MemoryManager;
  let mockVectorStore: {
    searchSimilar: Mock;
    searchSimilarAdvanced: Mock;
    storeWithEmbedding: Mock;
    deleteVector: Mock;
  };
  let mockGraphStore: {
    createNode: Mock;
    createRelationship: Mock;
    traverseGraph: Mock;
    getNodeRelationships: Mock;
  };
  let mockCoordinator: {
    storeMemoryWithSaga: Mock;
    deleteMemoryWithSaga: Mock;
  };

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    mockVectorStore = {
      searchSimilar: vi.fn(),
      searchSimilarAdvanced: vi.fn(),
      storeWithEmbedding: vi.fn(),
      deleteVector: vi.fn(),
    };

    mockGraphStore = {
      createNode: vi.fn(),
      createRelationship: vi.fn(),
      traverseGraph: vi.fn(),
      getNodeRelationships: vi.fn(),
    };

    mockCoordinator = {
      storeMemoryWithSaga: vi.fn(),
      deleteMemoryWithSaga: vi.fn(),
    };

    // Initialize MemoryManager with dependencies
    memoryManager = new MemoryManager({
      vectorStore: mockVectorStore as unknown as VectorStoreAdapter,
      graphStore: mockGraphStore as unknown as GraphStoreAdapter,
      transactionCoordinator: mockCoordinator as unknown as TransactionCoordinator
    });
  });

  it('should use TransactionCoordinator for storing memory', async () => {
    const content = 'Test memory content';
    mockCoordinator.storeMemoryWithSaga.mockResolvedValue({
      status: 'ok',
      memoryId: 'ignored-in-this-check'
    });

    const result = await memoryManager.storeMemory({ content });

    expect(mockCoordinator.storeMemoryWithSaga).toHaveBeenCalled();
    expect(result.success).toBe(true);
    if (result.success) {
      const callArgs = mockCoordinator.storeMemoryWithSaga.mock.calls[0][0];
      expect(callArgs.id).toBe(result.value);
    }
  });

  it('should use VectorStoreAdapter for finding similar memories', async () => {
    const content = 'search query';
    mockVectorStore.searchSimilar.mockResolvedValue([
      { id: 'mem-1', content: 'result 1', similarity: 0.9, metadata: {} }
    ]);

    await memoryManager.findSimilarMemories(content);

    expect(mockVectorStore.searchSimilar).toHaveBeenCalledWith(content, 5);
  });

  it('should use TransactionCoordinator for deleting memory', async () => {
    // Setup for storeMemory
    mockCoordinator.storeMemoryWithSaga.mockResolvedValue({
      status: 'ok',
      memoryId: 'generated-id'
    });

    // Pre-populate memory using public API
    const storeResult = await memoryManager.storeMemory({ content: 'to delete' });
    expect(storeResult.success).toBe(true);
    if (!storeResult.success) return;

    const memoryId = storeResult.value;

    // Setup for deleteMemory
    mockCoordinator.deleteMemoryWithSaga.mockResolvedValue({
      status: 'ok',
      memoryId: memoryId
    });

    const result = await memoryManager.deleteMemory(memoryId);

    expect(mockCoordinator.deleteMemoryWithSaga).toHaveBeenCalledWith(memoryId);
    expect(result.success).toBe(true);
  });
});
