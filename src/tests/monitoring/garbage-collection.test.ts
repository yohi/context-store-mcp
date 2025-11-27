import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryManager } from '../../memory/memory-manager.js';
import { TransactionCoordinator } from '../../storage/transaction-coordinator.js';
import { GarbageCollectionJob } from '../../monitoring/garbage-collection-job.js';

describe('Garbage Collection', () => {
    let memoryManager: MemoryManager;
    let transactionCoordinator: TransactionCoordinator;
    let gcJob: GarbageCollectionJob;

    beforeEach(() => {
        transactionCoordinator = {
            findSoftDeletedMemories: vi.fn(),
            hardDeleteMemory: vi.fn(),
        } as unknown as TransactionCoordinator;

        memoryManager = new MemoryManager({
            transactionCoordinator,
        });

        gcJob = new GarbageCollectionJob(memoryManager, {
            interval: 100, // Short interval for testing
            enabled: true,
        });
    });

    it('should perform garbage collection via TransactionCoordinator', async () => {
        const mockDeletedIds = ['id1', 'id2'];
        (transactionCoordinator.findSoftDeletedMemories as any).mockResolvedValue(mockDeletedIds);
        (transactionCoordinator.hardDeleteMemory as any).mockResolvedValue({ status: 'ok' });

        await memoryManager.performGarbageCollection();

        expect(transactionCoordinator.findSoftDeletedMemories).toHaveBeenCalled();
        expect(transactionCoordinator.hardDeleteMemory).toHaveBeenCalledTimes(2);
        expect(transactionCoordinator.hardDeleteMemory).toHaveBeenCalledWith('id1');
        expect(transactionCoordinator.hardDeleteMemory).toHaveBeenCalledWith('id2');
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
