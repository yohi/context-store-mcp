import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryManager } from '../../memory/memory-manager.js';
import { TransactionCoordinator } from '../../storage/transaction-coordinator.js';
import { GarbageCollectionJob } from '../../monitoring/garbage-collection-job.js';
import { MockStorageAdapter, MockVectorStoreAdapter, MockTransactionCoordinator } from '../mocks/index.js';
import { VectorStoreAdapter } from '../../storage/vector-store-adapter.js';

describe('Garbage Collection', () => {
    let memoryManager: MemoryManager;
    let mockStorage: MockStorageAdapter;
    let mockVectorStore: MockVectorStoreAdapter;
    let mockTransactionCoordinator: MockTransactionCoordinator;
    let gcJob: GarbageCollectionJob;

    beforeEach(() => {
        mockStorage = new MockStorageAdapter();
        mockVectorStore = new MockVectorStoreAdapter();
        mockTransactionCoordinator = new MockTransactionCoordinator(mockStorage);

        memoryManager = new MemoryManager({
            storage: mockStorage,
            vectorStore: mockVectorStore as unknown as VectorStoreAdapter,
            transactionCoordinator: mockTransactionCoordinator as unknown as TransactionCoordinator,
        });

        gcJob = new GarbageCollectionJob(memoryManager, {
            interval: 100, // Short interval for testing
            enabled: true,
        });
    });

    it('should perform garbage collection via TransactionCoordinator', async () => {
        const mockDeletedIds = ['id1', 'id2'];
        mockTransactionCoordinator.findSoftDeletedMemories.mockResolvedValue(mockDeletedIds);
        mockTransactionCoordinator.hardDeleteMemory.mockResolvedValue({ status: 'ok' });

        await memoryManager.performGarbageCollection();

        expect(mockTransactionCoordinator.findSoftDeletedMemories).toHaveBeenCalled();
        expect(mockTransactionCoordinator.hardDeleteMemory).toHaveBeenCalledTimes(2);
        expect(mockTransactionCoordinator.hardDeleteMemory).toHaveBeenCalledWith('id1');
        expect(mockTransactionCoordinator.hardDeleteMemory).toHaveBeenCalledWith('id2');
    });

    it('should handle GC job execution', async () => {
        vi.useFakeTimers();
        const gcSpy = vi.spyOn(memoryManager, 'performGarbageCollection').mockResolvedValue(undefined);

        gcJob.start();

        await vi.advanceTimersByTimeAsync(150);

        expect(gcSpy).toHaveBeenCalled();

        gcJob.stop();
        vi.useRealTimers();
    });
});
