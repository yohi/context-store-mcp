import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  let mockVectorStore: any;
  let mockGraphStore: any;
  let mockCoordinator: any;

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
    // Using 'as any' to bypass type checking for TDD 'Red' phase
    // where the constructor signature hasn't been updated yet
    memoryManager = new MemoryManager({
      vectorStore: mockVectorStore,
      graphStore: mockGraphStore,
      transactionCoordinator: mockCoordinator
    } as any);
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
    mockCoordinator.deleteMemoryWithSaga.mockResolvedValue({
      status: 'ok',
      memoryId: 'del-id'
    });
    
    // Pre-populate memory so it exists for the check
    (memoryManager as any).memories.set('del-id', { id: 'del-id', isProtected: false });

    const result = await memoryManager.deleteMemory('del-id');

    expect(mockCoordinator.deleteMemoryWithSaga).toHaveBeenCalledWith('del-id');
    expect(result.success).toBe(true);
  });
});
