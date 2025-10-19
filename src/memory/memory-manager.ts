/**
 * Memory Manager Implementation
 * Orchestrates memory storage, updates, and deletion
 * Requirements: 1.1, 1.2, 1.6
 */

import { randomUUID } from 'node:crypto';
import type {
  Memory,
  MemoryId,
  MemoryError,
  MemoryManagerService,
  MemoryMetadata,
  MemoryType,
  Result,
  StoreMemoryParams,
} from './types.js';

export class MemoryManager implements MemoryManagerService {
  // In-memory storage for testing (will be replaced with PostgreSQL in later tasks)
  private memories: Map<MemoryId, Memory> = new Map();

  /**
   * Store a new memory with automatic ID generation and timestamp management
   * Requirements: 1.1 (永続的保存), 1.2 (セッション間アクセス), 1.6 (整合性維持)
   */
  async storeMemory(
    params: StoreMemoryParams
  ): Promise<Result<MemoryId, MemoryError>> {
    // Content validation
    const validationError = this.validateContent(params.content);
    if (validationError !== null) {
      return {
        success: false,
        error: validationError,
      };
    }

    // Generate unique ID (UUID v4)
    const memoryId = this.generateMemoryId();

    // Process metadata with defaults
    const processedMetadata = this.processMetadata(params.metadata);

    // Auto-generate timestamps
    const timestamps = this.createTimestamps();

    // Create memory entity
    const memory: Memory = {
      id: memoryId,
      content: params.content,
      memoryType: processedMetadata.memoryType || 'semantic', // Default to semantic
      metadata: processedMetadata,
      ...timestamps,
      accessCount: 0,
      importanceScore: 0.0,
      isDeleted: false,
      isProtected: false,
    };

    // Store in memory (will be replaced with PostgreSQL later)
    this.memories.set(memoryId, memory);

    return {
      success: true,
      value: memoryId,
    };
  }

  /**
   * Update an existing memory
   * Requirements: 1.3 (記憶更新), Task 3.2
   */
  async updateMemory(
    id: MemoryId,
    updates: Partial<Memory>
  ): Promise<Result<boolean, MemoryError>> {
    // Check if memory exists
    const existing = this.memories.get(id);
    if (!existing) {
      return {
        success: false,
        error: {
          type: 'MEMORY_NOT_FOUND',
          message: `Memory with ID ${id} not found`,
        },
      };
    }

    // Validate content if being updated
    if (updates.content !== undefined) {
      const validationError = this.validateContent(updates.content);
      if (validationError !== null) {
        return {
          success: false,
          error: validationError,
        };
      }
    }

    // Update the memory (preserving fields not in updates)
    const updatedMemory: Memory = {
      ...existing,
      ...updates,
      id: existing.id, // ID cannot be changed
      createdAt: existing.createdAt, // createdAt cannot be changed
      updatedAt: new Date(), // Always update updatedAt
    };

    this.memories.set(id, updatedMemory);

    return {
      success: true,
      value: true,
    };
  }

  /**
   * Soft delete a memory (mark as deleted, don't remove)
   * Requirements: 1.5 (削除), Task 3.2
   */
  async deleteMemory(id: MemoryId): Promise<Result<boolean, MemoryError>> {
    // Check if memory exists
    const existing = this.memories.get(id);
    if (!existing) {
      return {
        success: false,
        error: {
          type: 'MEMORY_NOT_FOUND',
          message: `Memory with ID ${id} not found`,
        },
      };
    }

    // Check if memory is protected
    if (existing.isProtected) {
      return {
        success: false,
        error: {
          type: 'STORAGE_ERROR',
          message: 'Cannot delete protected memory',
        },
      };
    }

    // Soft delete: mark as deleted instead of removing
    const deletedMemory: Memory = {
      ...existing,
      isDeleted: true,
      updatedAt: new Date(),
    };

    this.memories.set(id, deletedMemory);

    return {
      success: true,
      value: true,
    };
  }

  /**
   * Merge multiple memories into a single memory
   * Requirements: 1.3 (統合), Task 3.2
   */
  async mergeMemories(
    ids: MemoryId[]
  ): Promise<Result<MemoryId, MemoryError>> {
    // Validate input
    if (ids.length < 2) {
      return {
        success: false,
        error: {
          type: 'INVALID_CONTENT',
          message: 'Must provide at least 2 memories to merge',
        },
      };
    }

    // Check all memories exist
    const memories: Memory[] = [];
    for (const id of ids) {
      const memory = this.memories.get(id);
      if (!memory) {
        return {
          success: false,
          error: {
            type: 'MEMORY_NOT_FOUND',
            message: `Memory with ID ${id} not found`,
          },
        };
      }
      memories.push(memory);
    }

    // Combine content from all memories
    const combinedContent = memories
      .map((m, index) => `[Memory ${index + 1}]\n${m.content}`)
      .join('\n\n');

    // Merge tags from all memories (unique tags only)
    const allTags = new Set<string>();
    for (const memory of memories) {
      if (memory.metadata.tags) {
        for (const tag of memory.metadata.tags) {
          allTags.add(tag);
        }
      }
    }

    // Create merged memory
    const mergedMemoryParams: StoreMemoryParams = {
      content: combinedContent,
      metadata: {
        tags: Array.from(allTags),
        source: 'merged',
        memoryType: memories[0].memoryType, // Use first memory's type
      },
    };

    const mergeResult = await this.storeMemory(mergedMemoryParams);
    if (!mergeResult.success) {
      return mergeResult;
    }

    // Soft delete source memories
    for (const id of ids) {
      await this.deleteMemory(id);
    }

    return {
      success: true,
      value: mergeResult.value,
    };
  }

  async performGarbageCollection(): Promise<void> {
    // To be implemented in task 3.3
    throw new Error('Not implemented yet');
  }

  async optimizeStorage(): Promise<void> {
    // To be implemented in task 3.3
    throw new Error('Not implemented yet');
  }

  /**
   * Validate content before storage
   * Requirements: Data integrity check (1.6)
   */
  private validateContent(content: string): MemoryError | null {
    // Check if content is empty or only whitespace
    if (content.trim().length === 0) {
      return {
        type: 'INVALID_CONTENT',
        message: 'Content cannot be empty or contain only whitespace',
      };
    }

    return null;
  }

  /**
   * Generate a unique memory ID using UUID v4
   * Requirements: Unique identifier generation (Task 3.1)
   */
  private generateMemoryId(): MemoryId {
    return randomUUID();
  }

  /**
   * Process and validate metadata, applying defaults where needed
   * Requirements: Metadata processing (Task 3.1)
   */
  private processMetadata(metadata?: MemoryMetadata): MemoryMetadata {
    const processed: MemoryMetadata = {
      ...metadata,
    };

    // Set timestamp if not provided
    if (processed.timestamp === undefined) {
      processed.timestamp = new Date();
    }

    // Ensure tags is an array
    if (processed.tags !== undefined && !Array.isArray(processed.tags)) {
      processed.tags = [];
    }

    return processed;
  }

  /**
   * Create automatic timestamps for memory lifecycle events
   * Requirements: Automatic timestamp management (Task 3.1)
   */
  private createTimestamps(): {
    createdAt: Date;
    updatedAt: Date;
    lastAccessedAt: Date;
  } {
    const now = new Date();
    return {
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
    };
  }
}
