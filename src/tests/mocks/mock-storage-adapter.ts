/**
 * MockStorageAdapter
 * インメモリストレージを使用したStorageAdapterのモック実装
 * テスト用途専用
 */

import type { Memory, MemoryId, SearchParams } from '../../memory/types.js';
import type { StorageAdapter } from '../../storage/storage-adapter.js';

export class MockStorageAdapter implements StorageAdapter {
    private memories = new Map<MemoryId, Memory>();

    async storeMemory(memory: Memory): Promise<MemoryId> {
        this.memories.set(memory.id, { ...memory });
        return memory.id;
    }

    async getMemory(id: MemoryId): Promise<Memory | null> {
        const memory = this.memories.get(id);
        return memory ? { ...memory } : null;
    }

    async updateMemory(id: MemoryId, updates: Partial<Memory>): Promise<boolean> {
        const existing = this.memories.get(id);
        if (!existing) {
            return false;
        }

        const updated: Memory = {
            ...existing,
            ...updates,
            id: existing.id, // ID is immutable
            createdAt: existing.createdAt, // createdAt is immutable
            updatedAt: new Date(),
        };

        this.memories.set(id, updated);
        return true;
    }

    async deleteMemory(id: MemoryId): Promise<boolean> {
        const existing = this.memories.get(id);
        if (!existing) {
            return false;
        }

        // Soft delete
        const deleted: Memory = {
            ...existing,
            isDeleted: true,
            deletedAt: new Date(),
        };

        this.memories.set(id, deleted);
        return true;
    }

    async searchMemories(params: SearchParams): Promise<Memory[]> {
        const results: Memory[] = [];

        for (const memory of Array.from(this.memories.values())) {
            // Skip deleted memories
            if (memory.isDeleted) {
                continue;
            }

            // Apply memoryTypes filter
            if (
                params.memoryTypes &&
                params.memoryTypes.length > 0 &&
                !params.memoryTypes.includes(memory.memoryType)
            ) {
                continue;
            }

            // Apply tags filter
            if (params.tags && params.tags.length > 0) {
                const memoryTags = memory.metadata.tags || [];
                const hasMatchingTag = params.tags.some((tag) => memoryTags.includes(tag));
                if (!hasMatchingTag) {
                    continue;
                }
            }

            // Apply userId filter
            if (params.userId && memory.metadata.userId !== params.userId) {
                continue;
            }

            // Apply projectId filter
            if (params.projectId && memory.metadata.projectId !== params.projectId) {
                continue;
            }

            results.push({ ...memory });
        }

        // Apply limit
        if (params.limit && params.limit > 0) {
            return results.slice(0, params.limit);
        }

        return results;
    }

    async getAllMemoryIds(): Promise<MemoryId[]> {
        const ids: MemoryId[] = [];

        for (const [id, memory] of Array.from(this.memories.entries())) {
            // Only include non-deleted memories
            if (!memory.isDeleted) {
                ids.push(id);
            }
        }

        return ids;
    }

    // テストヘルパーメソッド
    getMemoryForTest(id: MemoryId): Memory | undefined {
        const memory = this.memories.get(id);
        return memory ? { ...memory } : undefined;
    }

    getAllMemoriesForTest(): Memory[] {
        return Array.from(this.memories.values()).map((m) => ({ ...m }));
    }

    setDeletedAtForTest(id: MemoryId, deletedAt: Date): void {
        const memory = this.memories.get(id);
        if (memory) {
            this.memories.set(id, {
                ...memory,
                deletedAt,
            });
        }
    }

    clear(): void {
        this.memories.clear();
    }
}
