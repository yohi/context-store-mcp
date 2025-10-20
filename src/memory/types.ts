/**
 * Memory domain types and interfaces
 * Based on design.md Memory Manager specification
 */

// Memory type classification
export type MemoryType = 'episodic' | 'semantic' | 'procedural';

// Unique identifier for memories
export type MemoryId = string; // UUID format

// Memory error types
export type MemoryError =
  | { type: 'STORAGE_ERROR'; message: string }
  | { type: 'INVALID_CONTENT'; message: string }
  | { type: 'MEMORY_NOT_FOUND'; message: string }
  | { type: 'QUOTA_EXCEEDED'; message: string };

// Result type for operations that can fail
export type Result<T, E> =
  | { success: true; value: T }
  | { success: false; error: E };

// Memory metadata structure
export interface MemoryMetadata {
  source?: string;
  timestamp?: Date;
  tags?: string[];
  memoryType?: MemoryType;
  userId?: string;
  projectId?: string;
}

// Complete memory entity
export interface Memory {
  id: MemoryId;
  content: string;
  memoryType: MemoryType;
  metadata: MemoryMetadata;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;
  accessCount: number;
  importanceScore: number;
  isDeleted: boolean;
  isProtected: boolean;
  deletedAt?: Date | null; // Timestamp when soft-deleted (GDPR compliance)
}

// Parameters for storing a new memory
export interface StoreMemoryParams {
  content: string;
  metadata?: MemoryMetadata;
}

// Memory Manager service interface
export interface MemoryManagerService {
  storeMemory(params: StoreMemoryParams): Promise<Result<MemoryId, MemoryError>>;
  updateMemory(
    id: MemoryId,
    updates: Partial<Memory>
  ): Promise<Result<boolean, MemoryError>>;
  deleteMemory(id: MemoryId): Promise<Result<boolean, MemoryError>>;
  mergeMemories(ids: MemoryId[]): Promise<Result<MemoryId, MemoryError>>;

  // Memory management operations
  performGarbageCollection(): Promise<void>;
  optimizeStorage(): Promise<void>;
}
