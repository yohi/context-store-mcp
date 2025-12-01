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
    let filteredMemories = Array.from(this.memories.values()).filter(m => {
      if (params.tags && params.tags.length > 0) {
        if (!m.metadata.tags || !params.tags.some(t => m.metadata.tags!.includes(t))) return false;
      }
      if (params.memoryTypes && params.memoryTypes.length > 0) {
        if (!params.memoryTypes.includes(m.memoryType)) return false;
      }
      if (m.isDeleted) return false;
      return true;
    });

    if (params.limit !== undefined && params.limit > 0) {
      filteredMemories = filteredMemories.slice(0, params.limit);
    }

    return filteredMemories;
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
  addEmbeddingForMemory = vi.fn().mockImplementation(async (_memoryId: string, _embedding: number[], _userId: string) => {
    return { success: true, value: true };
  });
  searchSimilar = vi.fn().mockResolvedValue([]);
  async deleteVector(_id: string): Promise<boolean> { return true; }
}

export class MockTransactionCoordinator implements Partial<TransactionCoordinator> {
  public versions: any[] = [];
  public storedVersions: Map<string, any[]> = new Map();
  private storage: MockStorageAdapter | undefined;

  constructor(storage?: MockStorageAdapter) {
    this.storage = storage;
  }

  getMemory = vi.fn().mockImplementation(async (id: MemoryId): Promise<Memory | null> => {
    if (this.storage) {
      return this.storage.getMemory(id);
    }
    return null;
  });

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
                ...entity, // Apply all properties from entity
                version: (existing.version || 1) + 1,
                updatedAt: new Date()
            });
        }
    }
    return { status: 'ok', memoryId: entity.id };
  });

  deleteMemoryWithSaga = vi.fn().mockImplementation(async (id) => {
      if (this.storage) {
          const existing = this.storage.memories.get(id);
          if (existing) {
              this.storage.memories.set(id, { ...existing, isDeleted: true, deletedAt: new Date() });
          }
      }
      return { status: 'ok', memoryId: id };
  });
  
  saveMemoryVersion = vi.fn().mockImplementation(async (memoryData, versionNumber) => {
      const memoryId = memoryData.id;
      const currentVersions = this.storedVersions.get(memoryId) || [];
      // Assuming memoryData contains content, metadata, etc.
      currentVersions.push({
          memoryId: memoryId,
          version: versionNumber,
          content: memoryData.content,
          metadata: memoryData.metadata,
          timestamp: new Date(), // Capture current time as history timestamp
          // The 'id' in MemoryHistoryEntry refers to the history entry's ID, not memoryId.
          // For mock, we can just use a placeholder or generate one.
          id: `history-${memoryId}-v${versionNumber}` 
      });
      this.storedVersions.set(memoryId, currentVersions);
  });

  getMemoryVersions = vi.fn().mockImplementation(async (memoryId) => {
      return this.storedVersions.get(memoryId) || [];
  });

  getMemoryVersion = vi.fn().mockImplementation(async (memoryId: MemoryId, version: number) => {
      const versions = this.storedVersions.get(memoryId);
      if (!versions) {
          return null;
      }
      return versions.find(entry => entry.version === version) || null;
  });
  findSoftDeletedMemories = vi.fn().mockImplementation(async (threshold: Date) => {
    if (!this.storage) return [];
    const softDeleted = Array.from(this.storage.memories.values()).filter(m => 
      m.isDeleted && m.deletedAt && m.deletedAt < threshold && !m.isProtected
    );
    return softDeleted.map(m => m.id);
  });

  hardDeleteMemory = vi.fn().mockImplementation(async (id: MemoryId) => {
    if (this.storage) {
      this.storage.memories.delete(id);
    }
    return { status: 'ok' };
  });

  deleteLowImportanceMemories = vi.fn().mockImplementation(async (importanceThreshold: number, olderThan: Date) => {
    if (!this.storage) return 0;
    let deletedCount = 0;
    const memoriesToDelete = Array.from(this.storage.memories.values()).filter(m =>
        !m.isProtected && m.importanceScore < importanceThreshold && m.updatedAt < olderThan
    );
    for (const memory of memoriesToDelete) {
        this.storage.memories.delete(memory.id);
        deletedCount++;
    }
    return deletedCount;
  });

  getDatabaseSize = vi.fn().mockResolvedValue(0);
}

// Assuming MemoryClassifierService is an interface or type defined elsewhere
// For now, we'll import it or define a minimal version if not found
// If it's a real interface, ensure it's imported or defined.
interface MemoryClassifierService {
  classifyContent: (content: string) => Promise<{ primaryType: string; confidence: number }>;
  getConfidenceScore: (content: string) => Promise<number>;
  trainClassifier: (data: any[]) => Promise<void>;
  generateEmbedding: (content: string) => Promise<number[]>;
  evaluateAccuracy: (testData: any[]) => Promise<{ overall: number; perType: Record<string, number>; confusionMatrix: any[] }>;
  getClassificationStats: () => Promise<{ totalClassified: number; userOverrideRate: number; averageConfidence: number; lowConfidenceCount: number }>;
}

export class MockMemoryClassifierService implements MemoryClassifierService {
  classifyContent = vi.fn().mockResolvedValue({ primaryType: 'semantic', confidence: 0.8 });
  getConfidenceScore = vi.fn().mockResolvedValue(0.8);
  trainClassifier = vi.fn().mockResolvedValue(undefined);
  generateEmbedding = vi.fn().mockImplementation(async (content: string) => {
    // Return a consistent mock embedding for any content
    return [0.1, 0.2, 0.3, content.length * 0.01]; // Simple deterministic embedding
  });
  evaluateAccuracy = vi.fn().mockResolvedValue({ overall: 0.9, perType: {}, confusionMatrix: [] });
  getClassificationStats = vi.fn().mockResolvedValue({ totalClassified: 100, userOverrideRate: 0.1, averageConfidence: 0.85, lowConfidenceCount: 5 });
}