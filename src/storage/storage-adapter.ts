/**
 * StorageAdapter Interface
 * Defines the contract for storage implementations (PostgreSQL, Neo4j, etc.)
 */

import type { Memory, MemoryId, SearchParams } from '../memory/types.js';

/**
 * Common storage adapter interface
 */
export interface StorageAdapter {
  /** Store a new memory */
  storeMemory(memory: Memory): Promise<MemoryId>;

  /** Retrieve a memory by ID */
  getMemory(id: MemoryId): Promise<Memory | null>;

  /** Update an existing memory */
  updateMemory(id: MemoryId, updates: Partial<Memory>): Promise<boolean>;

  /** Delete a memory */
  deleteMemory(id: MemoryId): Promise<boolean>;

  /** Search memories based on parameters */
  searchMemories(params: SearchParams): Promise<Memory[]>;

  /** Get all memory IDs (for reconciliation) */
  getAllMemoryIds(): Promise<MemoryId[]>;
}
