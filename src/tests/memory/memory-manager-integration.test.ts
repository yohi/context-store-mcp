import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { MemoryManager } from '../../memory/memory-manager.js';
import { VectorStoreAdapter } from '../../storage/vector-store-adapter.js';
import { GraphStoreAdapter } from '../../storage/graph-store-adapter.js';
import { TransactionCoordinator } from '../../storage/transaction-coordinator.js';
import { MemoryClassifierService } from '../../memory/types.js';
import { MockStorageAdapter, MockVectorStoreAdapter, MockTransactionCoordinator, MockMemoryClassifierService } from '../mocks/index.js';

describe('MemoryManager Integration', () => {
  let memoryManager: MemoryManager;
  let mockStorage: MockStorageAdapter;
  let mockVectorStore: MockVectorStoreAdapter;
  let mockGraphStore: any; // Assuming MockGraphStoreAdapter might be needed later
  let mockTransactionCoordinator: MockTransactionCoordinator;
  let mockClassifier: MockMemoryClassifierService;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    mockStorage = new MockStorageAdapter();
    mockVectorStore = new MockVectorStoreAdapter();
    mockTransactionCoordinator = new MockTransactionCoordinator(mockStorage);
    mockClassifier = new MockMemoryClassifierService();

    // Mock GraphStoreAdapter for consistency, even if not fully used in all tests here
    mockGraphStore = {
      createNode: vi.fn(),
      createRelationship: vi.fn(),
      traverseGraph: vi.fn(),
      getNodeRelationships: vi.fn(),
    };

    // Initialize MemoryManager with dependencies
    memoryManager = new MemoryManager({
      storage: mockStorage,
      vectorStore: mockVectorStore as unknown as VectorStoreAdapter,
      graphStore: mockGraphStore as unknown as GraphStoreAdapter,
      transactionCoordinator: mockTransactionCoordinator as unknown as TransactionCoordinator,
      classifier: mockClassifier as unknown as MemoryClassifierService,
    });
  });

  it('should use TransactionCoordinator for storing memory', async () => {
    const content = 'Test memory content';
    mockTransactionCoordinator.storeMemoryWithSaga.mockResolvedValue({
      status: 'ok',
      memoryId: 'ignored-in-this-check'
    });

    const result = await memoryManager.storeMemory({ content });

    expect(mockTransactionCoordinator.storeMemoryWithSaga).toHaveBeenCalled();
    expect(result.success).toBe(true);
    if (result.success) {
      const callArgs = mockTransactionCoordinator.storeMemoryWithSaga.mock.calls[0][0];
      expect(callArgs.id).toBe(result.value);
    }
  });

  it('should use VectorStoreAdapter for finding similar memories', async () => {
    const content = 'search query';
    mockVectorStore.searchSimilar.mockResolvedValue([
      { id: 'mem-1', content: 'result 1', similarity: 0.9, metadata: {} }
    ]);

    await memoryManager.findSimilarMemories(content);

    // VectorStoreAdapter handles embedding generation internally
    expect(mockVectorStore.searchSimilar).toHaveBeenCalledWith(content, 5);
  });

  it('should use TransactionCoordinator for deleting memory', async () => {
    // Setup for storeMemory
    mockTransactionCoordinator.storeMemoryWithSaga.mockResolvedValue({
      status: 'ok',
      memoryId: 'generated-id'
    });

    // Pre-populate memory using public API
    const storeResult = await memoryManager.storeMemory({ content: 'to delete' });
    expect(storeResult.success).toBe(true);
    if (!storeResult.success) return;

    const memoryId = storeResult.value;

    // Manually seed the storage so getMemory finds it
    mockStorage.memories.set(memoryId, {
      id: memoryId,
      content: 'to delete',
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      lastAccessedAt: new Date(),
      accessCount: 0,
      importanceScore: 0,
      isProtected: false,
      version: 1,
      isDeleted: false,
      memoryType: 'semantic'
    });

    // Setup for deleteMemory
    mockTransactionCoordinator.deleteMemoryWithSaga.mockResolvedValue({
      status: 'ok',
      memoryId: memoryId
    });

    const result = await memoryManager.deleteMemory(memoryId);

    expect(mockTransactionCoordinator.deleteMemoryWithSaga).toHaveBeenCalledWith(memoryId);
    expect(result.success).toBe(true);
  });
});
