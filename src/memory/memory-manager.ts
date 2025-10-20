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
      deletedAt: null, // Not deleted initially
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

    // Create updated memory, filtering out protected fields
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, createdAt: _createdAt, isDeleted: _isDeleted, deletedAt: _deletedAt, ...allowedUpdates } = updates;

    // Update the memory (preserving protected fields)
    const updatedMemory: Memory = {
      ...existing,
      ...allowedUpdates,
      id: existing.id, // ID cannot be changed
      createdAt: existing.createdAt, // createdAt cannot be changed
      isDeleted: existing.isDeleted, // isDeleted cannot be changed via update
      deletedAt: existing.deletedAt ?? null, // deletedAt cannot be changed via update, normalize undefined to null
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

    // Soft delete: mark as deleted with timestamp (GDPR compliance)
    const deletedMemory: Memory = {
      ...existing,
      isDeleted: true,
      deletedAt: new Date(),
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

    // Check all memories exist and are mergeable
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

      // Check if memory is deleted
      if (memory.isDeleted) {
        return {
          success: false,
          error: {
            type: 'INVALID_CONTENT',
            message: `Cannot merge deleted memory: ${id}`,
          },
        };
      }

      // Check if memory is protected
      if (memory.isProtected) {
        return {
          success: false,
          error: {
            type: 'STORAGE_ERROR',
            message: `Cannot merge protected memory: ${id}`,
          },
        };
      }

      memories.push(memory);
    }

    // Combine content from all memories
    const combinedContent = memories
      .map((m, index) => `[Memory ${index + 1}]\n${m.content}`)
      .join('\n\n');

    // Merge tags from all memories (unique tags only, sorted for deterministic order)
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
        tags: Array.from(allTags).sort(), // Sorted for stable ordering
        source: 'merged',
        memoryType: memories[0]?.memoryType || 'semantic', // Use first memory's type
      },
    };

    const mergeResult = await this.storeMemory(mergedMemoryParams);
    if (!mergeResult.success) {
      return mergeResult;
    }

    // Soft delete source memories with rollback on failure
    for (const id of ids) {
      const deleteResult = await this.deleteMemory(id);
      if (!deleteResult.success) {
        // Rollback: delete the merged memory to avoid inconsistency
        this.memories.delete(mergeResult.value);
        return {
          success: false,
          error: {
            type: deleteResult.error.type,
            message: `Merge aborted: failed to delete source ${id} (${deleteResult.error.message})`,
          },
        };
      }
    }

    return {
      success: true,
      value: mergeResult.value,
    };
  }

  /**
   * Perform garbage collection on soft-deleted memories
   * Requirements: Task 3.3 - Storage auto-cleanup
   */
  async performGarbageCollection(): Promise<void> {
    const now = new Date();
    const threshold = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

    // Find soft-deleted memories that are old enough and not protected
    const toRemove: MemoryId[] = [];
    for (const [id, memory] of this.memories.entries()) {
      if (
        memory.isDeleted &&
        !memory.isProtected &&
        memory.deletedAt !== null &&
        memory.deletedAt !== undefined &&
        memory.deletedAt < threshold
      ) {
        toRemove.push(id);
      }
    }

    // Physically remove these memories
    for (const id of toRemove) {
      this.memories.delete(id);
    }
  }

  /**
   * Optimize storage by updating importance scores and compacting memory
   * Requirements: Task 3.3 - Storage optimization
   */
  async optimizeStorage(): Promise<void> {
    // Update importance scores for all non-deleted memories
    for (const [id, memory] of this.memories.entries()) {
      if (!memory.isDeleted) {
        // Simple importance score calculation based on access count
        // In real implementation, this would consider:
        // - Reference score (search result appearances)
        // - Graph centrality score
        const referenceScore = Math.min(memory.accessCount / 100, 1.0);
        const centralityScore = 0.5; // Placeholder (would come from Neo4j PageRank)

        const importanceScore = referenceScore * 0.6 + centralityScore * 0.4;

        // Update the memory with new importance score
        this.memories.set(id, {
          ...memory,
          importanceScore,
        });
      }
    }

    // Compact: Remove soft-deleted memories that have been deleted long enough
    // This is essentially a lightweight garbage collection
    await this.performGarbageCollection();
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
      ...(metadata ?? {}),
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

  /**
   * Test helper: Get a memory by ID (including soft-deleted ones)
   * Only for testing purposes - not part of public API
   * @internal
   */
  getMemoryForTest(id: MemoryId): Memory | undefined {
    return this.memories.get(id);
  }

  /**
   * Test helper: Get all memories (including soft-deleted ones)
   * Only for testing purposes - not part of public API
   * @internal
   */
  getAllMemoriesForTest(): Memory[] {
    return Array.from(this.memories.values());
  }

  /**
   * Test helper: Manually set deletedAt timestamp for testing GC
   * Only for testing purposes - allows simulating old deletions
   * @internal
   */
  setDeletedAtForTest(id: MemoryId, deletedAt: Date): void {
    const memory = this.memories.get(id);
    if (memory) {
      this.memories.set(id, {
        ...memory,
        deletedAt,
      });
    }
  }
}
