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
  MemoryLink,
  MemoryLinkType,
  SearchParams,
  MemoryType,
} from './types.js';

export class MemoryManager implements MemoryManagerService {
  // In-memory storage for testing (will be replaced with PostgreSQL in later tasks)
  private memories: Map<MemoryId, Memory> = new Map();
  // In-memory storage for memory links (will be replaced with Neo4j in later tasks)
  private links: Map<string, MemoryLink> = new Map();

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

    // Normalize memoryType: prefer top-level, drop from metadata to avoid drift
    const { memoryType: metadataType, ...metadataWithoutType } = processedMetadata;

    // Create memory entity
    const memory: Memory = {
      id: memoryId,
      content: params.content,
      memoryType: metadataType || 'semantic', // Default to semantic
      metadata: metadataWithoutType,
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
        memoryType: memories[0]?.memoryType || 'semantic', // Use first memory's type (will be extracted to top-level)
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

    // Remove orphan links referencing deleted memories
    const toRemoveLinks: string[] = [];
    for (const [lid, link] of this.links.entries()) {
      if (toRemove.includes(link.fromMemoryId) || toRemove.includes(link.toMemoryId)) {
        toRemoveLinks.push(lid);
      }
    }
    for (const lid of toRemoveLinks) {
      this.links.delete(lid);
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
   * Create a link between two memories (Task 4.3)
   * Requirements: 3.5 (タイプ間リンクの生成と維持)
   */
  async createLink(
    from: MemoryId,
    to: MemoryId,
    linkType: MemoryLinkType,
    strength: number = 0.5,
    createdBy: 'user' | 'system' = 'system',
    reasoning?: string
  ): Promise<Result<string, MemoryError>> {
    // Prevent self-links
    if (from === to) {
      return {
        success: false,
        error: {
          type: 'INVALID_CONTENT',
          message: `Self-links are not allowed: cannot link memory ${from} to itself`,
        },
      };
    }

    // Validate that both memories exist
    const fromMemory = this.memories.get(from);
    const toMemory = this.memories.get(to);

    if (!fromMemory) {
      return {
        success: false,
        error: {
          type: 'MEMORY_NOT_FOUND',
          message: `Source memory with ID ${from} not found`,
        },
      };
    }

    if (!toMemory) {
      return {
        success: false,
        error: {
          type: 'MEMORY_NOT_FOUND',
          message: `Target memory with ID ${to} not found`,
        },
      };
    }

    // Validate strength range
    if (strength < 0 || strength > 1) {
      return {
        success: false,
        error: {
          type: 'INVALID_CONTENT',
          message: `Link strength must be between 0 and 1, got ${strength}`,
        },
      };
    }

    // Check for duplicate links (same fromMemoryId, toMemoryId, and linkType)
    for (const existingLink of this.links.values()) {
      if (
        existingLink.fromMemoryId === from &&
        existingLink.toMemoryId === to &&
        existingLink.linkType === linkType
      ) {
        // Return existing link ID instead of creating duplicate
        return {
          success: true,
          value: existingLink.linkId,
        };
      }
    }

    // Generate link ID
    const linkId = randomUUID();

    // Create link
    const link: MemoryLink = {
      linkId,
      fromMemoryId: from,
      toMemoryId: to,
      linkType,
      strength,
      metadata: {
        createdAt: new Date(),
        createdBy,
        ...(reasoning !== undefined && { reasoning }),
      },
    };

    // Store link
    this.links.set(linkId, link);

    return {
      success: true,
      value: linkId,
    };
  }

  /**
   * Get all links for a memory (bidirectional)
   * Requirements: 3.5 (相互参照の管理)
   */
  async getLinks(memoryId: MemoryId): Promise<MemoryLink[]> {
    const results: MemoryLink[] = [];

    // Find all links where this memory is either source or target
    for (const link of this.links.values()) {
      if (link.fromMemoryId === memoryId || link.toMemoryId === memoryId) {
        // Skip links where either endpoint is deleted or missing
        const fromMemory = this.memories.get(link.fromMemoryId);
        const toMemory = this.memories.get(link.toMemoryId);

        // Only include link if both endpoints exist and are not deleted
        if (fromMemory && !fromMemory.isDeleted && toMemory && !toMemory.isDeleted) {
          results.push(link);
        }
      }
    }

    return results;
  }

  /**
   * Delete a link
   * Requirements: 3.5 (リンク管理)
   */
  async deleteLink(linkId: string): Promise<Result<boolean, MemoryError>> {
    const link = this.links.get(linkId);

    if (!link) {
      return {
        success: false,
        error: {
          type: 'MEMORY_NOT_FOUND',
          message: `Link with ID ${linkId} not found`,
        },
      };
    }

    // Delete the link
    this.links.delete(linkId);

    return {
      success: true,
      value: true,
    };
  }

  /**
   * Search memories with type filtering
   * Requirements: 3.6 (タイプフィルタリング機能)
   */
  async searchMemories(params: SearchParams): Promise<Memory[]> {
    const results: Memory[] = [];

    // Iterate through all memories
    for (const memory of this.memories.values()) {
      // Skip deleted memories
      if (memory.isDeleted) {
        continue;
      }

      // Apply memoryType filter
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
        const hasMatchingTag = params.tags.some((tag) =>
          memoryTags.includes(tag)
        );
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

      // Add to results
      results.push(memory);
    }

    // Apply limit
    if (params.limit && params.limit > 0) {
      return results.slice(0, params.limit);
    }

    return results;
  }

  /**
   * Override memory type (user can manually change the auto-classified type)
   * Requirements: 3.4 design.md 決定2 (ユーザーによるタイプ上書き可能)
   */
  async overrideMemoryType(
    memoryId: MemoryId,
    newType: MemoryType
  ): Promise<Result<boolean, MemoryError>> {
    const memory = this.memories.get(memoryId);

    if (!memory) {
      return {
        success: false,
        error: {
          type: 'MEMORY_NOT_FOUND',
          message: `Memory with ID ${memoryId} not found`,
        },
      };
    }

    // Don't allow override on deleted memories
    if (memory.isDeleted) {
      return {
        success: false,
        error: {
          type: 'MEMORY_NOT_FOUND',
          message: `Cannot override type of deleted memory ${memoryId}`,
        },
      };
    }

    // Update memory type and ensure metadata is synchronized
    const updated: Memory = {
      ...memory,
      memoryType: newType,
      updatedAt: new Date(),
      metadata: {
        ...memory.metadata,
        memoryType: newType, // Synchronize metadata.memoryType with top-level memoryType
      },
    };

    this.memories.set(memoryId, updated);

    return {
      success: true,
      value: true,
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
