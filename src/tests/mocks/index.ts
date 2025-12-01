import type { StorageAdapter } from '../../storage/storage-adapter.js';
import type { VectorStoreAdapter } from '../../storage/vector-store-adapter.js';
import type { TransactionCoordinator } from '../../storage/transaction-coordinator.js';
import type { Memory, MemoryId, SearchParams } from '../../memory/types.js';
import { vi } from 'vitest';

export class MockStorageAdapter implements StorageAdapter {
  public memories: Map<string, Memory> = new Map();

  async storeMemory(memory: Memory): Promise<MemoryId> {
    this.memories.set(memory.id, memory);
    return memory.id;
  }

  async getMemory(id: MemoryId): Promise<Memory | null> {
    return this.memories.get(id) || null;
  }

  async updateMemory(id: MemoryId, updates: Partial<Memory>): Promise<boolean> {
    const memory = this.memories.get(id);
    if (!memory) return false;
    this.memories.set(id, { ...memory, ...updates, updatedAt: new Date() });
    return true;
  }

  async deleteMemory(id: MemoryId): Promise<boolean> {
    const memory = this.memories.get(id);
    if (!memory) return false;
    this.memories.set(id, { ...memory, isDeleted: true, deletedAt: new Date() });
    return true;
  }

  async restoreMemory(id: MemoryId): Promise<void> {
    const memory = this.memories.get(id);
    if (memory) {
      this.memories.set(id, { ...memory, isDeleted: false, deletedAt: null });
    }
  }

  async searchMemories(params: SearchParams): Promise<Memory[]> {
    return Array.from(this.memories.values()).filter(m => {
      if (params.tags && params.tags.length > 0) {
        if (!m.metadata.tags || !params.tags.some(t => m.metadata.tags!.includes(t))) return false;
      }
      if (params.memoryTypes && params.memoryTypes.length > 0) {
        if (!params.memoryTypes.includes(m.memoryType)) return false;
      }
      if (m.isDeleted) return false;
      return true;
    });
  }

  async getAllMemoryIds(): Promise<MemoryId[]> {
    return Array.from(this.memories.keys());
  }

  // Test helper
  getMemoryForTest(id: MemoryId): Memory | undefined {
    return this.memories.get(id);
  }

  getAllMemoriesForTest(): Memory[] {
    return Array.from(this.memories.values());
  }

  setDeletedAtForTest(id: MemoryId, date: Date): void {
    const memory = this.memories.get(id);
    if (memory) {
      this.memories.set(id, { ...memory, deletedAt: date });
    }
  }
}

export class MockVectorStoreAdapter implements Partial<VectorStoreAdapter> {
  async addEmbeddingForMemory(id: string, content: string): Promise<void> {}
  async searchSimilar(content: string, limit: number): Promise<any[]> { return []; }
  async deleteVector(id: string): Promise<void> {}
}

export class MockTransactionCoordinator implements Partial<TransactionCoordinator> {
  public versions: any[] = [];
  private storage?: MockStorageAdapter;

  constructor(storage?: MockStorageAdapter) {
    this.storage = storage;
  }

  storeMemoryWithSaga = vi.fn().mockImplementation(async (entity) => {
    if (this.storage) {
        const memory = {
            id: entity.id,
            content: entity.content,
            memoryType: entity.memoryType,
            metadata: entity.metadata,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastAccessedAt: new Date(),
            accessCount: 0,
            importanceScore: 0,
            isDeleted: false,
            isProtected: false,
            version: 1,
            deletedAt: null
        };
        this.storage.memories.set(entity.id, memory);
    }
    return { status: 'ok', memoryId: entity.id };
  });

  updateMemoryWithSaga = vi.fn().mockImplementation(async (entity) => {
    if (this.storage) {
        const existing = this.storage.memories.get(entity.id);
        if (existing) {
            this.storage.memories.set(entity.id, {
                ...existing,
                content: entity.content,
                metadata: entity.metadata,
                memoryType: entity.memoryType,
                version: (existing.version || 1) + 1,
                updatedAt: new Date()
            });
        }
    }
    return { status: 'ok', memoryId: entity.id };
  });

  deleteMemoryWithSaga = vi.fn().mockImplementation(async (id) => {
      // We don't delete from storage here because deleteMemoryWithSaga is called *after* 
      // logic might check things?
      // Actually deleteMemoryWithSaga in real TC does soft delete.
      if (this.storage) {
          const existing = this.storage.memories.get(id);
          if (existing) {
              this.storage.memories.set(id, { ...existing, isDeleted: true, deletedAt: new Date() });
          }
      }
      return { status: 'ok', memoryId: id };
  });
  
  saveMemoryVersion = vi.fn().mockResolvedValue(undefined);
  getMemoryVersions = vi.fn().mockResolvedValue([]);
  getMemoryVersion = vi.fn().mockResolvedValue(null);
  findSoftDeletedMemories = vi.fn().mockResolvedValue([]);
  hardDeleteMemory = vi.fn().mockResolvedValue({ status: 'ok' });
  deleteLowImportanceMemories = vi.fn().mockResolvedValue(0);
  getDatabaseSize = vi.fn().mockResolvedValue(0);
}
