import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryManager } from '../../memory/memory-manager.js';
import { TransactionCoordinator } from '../../storage/transaction-coordinator.js';
import { MockStorageAdapter } from '../mocks/index.js';

describe('Memory Versioning', () => {
    let memoryManager: MemoryManager;
    let mockStorage: MockStorageAdapter;
    let transactionCoordinator: TransactionCoordinator;

    beforeEach(() => {
        mockStorage = new MockStorageAdapter();
        transactionCoordinator = {
            saveMemoryVersion: vi.fn(),
            getMemoryVersions: vi.fn(),
            getMemoryVersion: vi.fn(),
            storeMemoryWithSaga: vi.fn().mockResolvedValue({ status: 'ok' }),
            updateMemoryWithSaga: vi.fn().mockResolvedValue({ status: 'ok' }),
        } as unknown as TransactionCoordinator;

        memoryManager = new MemoryManager({
            storage: mockStorage,
            transactionCoordinator,
        });
    });

    it('should save version history on update', async () => {
        // Setup initial memory
        const id = 'mem-1';
        mockStorage.memories.set(id, {
            id,
            content: 'v1',
            version: 1,
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date(),
            lastAccessedAt: new Date(),
            accessCount: 0,
            importanceScore: 0,
            isProtected: false,
            memoryType: 'semantic',
            isDeleted: false,
        });

        await memoryManager.updateMemory(id, { content: 'v2' });

        expect(transactionCoordinator.saveMemoryVersion).toHaveBeenCalledWith(
            expect.objectContaining({ content: 'v1' }),
            1
        );
        expect(transactionCoordinator.updateMemoryWithSaga).toHaveBeenCalledWith(
            expect.objectContaining({ content: 'v2' })
        );
    });

    it('should revert to previous version', async () => {
        const id = 'mem-1';
        mockStorage.memories.set(id, {
            id,
            content: 'v2',
            version: 2,
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date(),
            lastAccessedAt: new Date(),
            accessCount: 0,
            importanceScore: 0,
            isProtected: false,
            memoryType: 'semantic',
            isDeleted: false,
        });

        (transactionCoordinator.getMemoryVersion as any).mockResolvedValue({
            id,
            content: 'v1',
            metadata: { tag: 'old' },
        });

        await memoryManager.revertToVersion(id, 1);

        expect(transactionCoordinator.getMemoryVersion).toHaveBeenCalledWith(id, 1);
        // Should call updateMemory with old content
        expect(transactionCoordinator.saveMemoryVersion).toHaveBeenCalled(); // Saves v2 before revert
        expect(transactionCoordinator.updateMemoryWithSaga).toHaveBeenCalledWith(
            expect.objectContaining({ content: 'v1' })
        );
    });
});
