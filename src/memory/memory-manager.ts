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
  MemoryHistoryEntry,
  MemoryClassifierService,
} from './types.js';

import type { VectorStoreAdapter } from '../storage/vector-store-adapter.js';
import type { GraphStoreAdapter } from '../storage/graph-store-adapter.js';
import type { TransactionCoordinator } from '../storage/transaction-coordinator.js';

export interface MemoryManagerConfig {
  vectorStore?: VectorStoreAdapter;
  graphStore?: GraphStoreAdapter;
  transactionCoordinator?: TransactionCoordinator;
  classifier?: MemoryClassifierService;
}

export class MemoryManager implements MemoryManagerService {
  // In-memory storage for testing (will be replaced with PostgreSQL in later tasks)
  private memories: Map<MemoryId, Memory> = new Map();
  // In-memory storage for memory links (will be replaced with Neo4j in later tasks)
  private links: Map<string, MemoryLink> = new Map();
  // In-memory storage for memory history
  private history: Map<MemoryId, MemoryHistoryEntry[]> = new Map();

  private vectorStore?: VectorStoreAdapter;
  private graphStore?: GraphStoreAdapter;
  private transactionCoordinator?: TransactionCoordinator;
  private classifier?: MemoryClassifierService;

  constructor(config?: MemoryManagerConfig) {
    if (config) {
      if (config.vectorStore) this.vectorStore = config.vectorStore;
      if (config.graphStore) this.graphStore = config.graphStore;
      if (config.transactionCoordinator) this.transactionCoordinator = config.transactionCoordinator;
      if (config.classifier) this.classifier = config.classifier;
    }
  }

  /**
   * Store a new memory with automatic ID generation and timestamp management
   * Requirements: 1.1 (永続的保存), 1.2 (セッション間アクセス), 1.6 (整合性維持)
   */
  async storeMemory(params: StoreMemoryParams): Promise<Result<MemoryId, MemoryError>> {
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

    // Normalize memoryType: prefer top-level params.memoryType, then metadata.memoryType
    const { memoryType: metadataType, ...metadataWithoutType } =
      processedMetadata as MemoryMetadata & { memoryType?: MemoryType };

    // Determine memory type: explicit > classifier > default
    let memoryType = params.memoryType || metadataType;

    if (!memoryType && this.classifier) {
      try {
        const classification = await this.classifier.classifyContent(params.content);
        memoryType = classification.primaryType;
      } catch (error) {
        console.error('Automatic classification failed:', error);
        // Fallback to semantic if classification fails
        memoryType = 'semantic';
      }
    }

    const finalMemoryType = memoryType || 'semantic';

    // Create memory entity
    // memoryType is now exclusively managed at top-level (single source of truth)
    const memory: Memory = {
      id: memoryId,
      content: params.content,
      memoryType: finalMemoryType,
      metadata: metadataWithoutType,
      ...timestamps,
      accessCount: 0,
      importanceScore: 0.0,
      isDeleted: false,
      isProtected: false,
      deletedAt: null, // Not deleted initially
      version: 1, // Initial version
    };

    // Store in memory (will be replaced with PostgreSQL later)
    this.memories.set(memoryId, memory);

    // Use Transaction Coordinator if available
    if (this.transactionCoordinator) {
      const entity = {
        id: memoryId,
        content: memory.content,
        memoryType: memory.memoryType,
        metadata: memory.metadata,
      };

      const result = await this.transactionCoordinator.storeMemoryWithSaga(entity);

      if (result.status === 'failed') {
        // Rollback in-memory storage
        this.memories.delete(memoryId);
        return {
          success: false,
          error: {
            type: 'STORAGE_ERROR',
            message: result.error.message,
          },
        };
      }
      // Note: We ignore partial success warnings for now as the Saga handles eventual consistency
    }

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

    // Normalize metadata if being updated, removing memoryType to maintain single source of truth
    let normalizedMetadata: MemoryMetadata | undefined = undefined;
    if (updates.metadata !== undefined) {
      const processed = this.processMetadata(updates.metadata);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { memoryType: _ignore, ...withoutType } = processed as MemoryMetadata & {
        memoryType?: MemoryType;
      };
      normalizedMetadata = withoutType;
    }

    // Save current state to history before update
    this.saveHistory(existing);

    // Create updated memory, filtering out protected fields
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {
      id: _id,
      createdAt: _createdAt,
      isDeleted: _isDeleted,
      deletedAt: _deletedAt,
      metadata: _metadata,
      version: _version, // Exclude version from updates
      ...allowedUpdates
    } = updates;

    // Update the memory (preserving protected fields and maintaining data integrity)
    const updatedMemory: Memory = {
      ...existing,
      ...allowedUpdates,
      // Apply normalized metadata if provided, otherwise keep existing
      ...(normalizedMetadata !== undefined ? { metadata: normalizedMetadata } : {}),
      id: existing.id, // ID cannot be changed
      createdAt: existing.createdAt, // createdAt cannot be changed
      isDeleted: existing.isDeleted, // isDeleted cannot be changed via update
      deletedAt: existing.deletedAt ?? null, // deletedAt cannot be changed via update, normalize undefined to null
      updatedAt: new Date(), // Always update updatedAt
      version: existing.version + 1, // Increment version
    };

    this.memories.set(id, updatedMemory);

    // Use Transaction Coordinator if available
    if (this.transactionCoordinator) {
      // Save current version to history before update
      const entityToArchive = {
        id: existing.id,
        content: existing.content,
        memoryType: existing.memoryType,
        metadata: existing.metadata,
      };
      await this.transactionCoordinator.saveMemoryVersion(entityToArchive, existing.version);

      // Update the memory
      const entity = {
        id: updatedMemory.id,
        content: updatedMemory.content,
        memoryType: updatedMemory.memoryType,
        metadata: updatedMemory.metadata,
      };

      const result = await this.transactionCoordinator.updateMemoryWithSaga(entity);

      if (result.status === 'failed') {
        // Rollback in-memory storage
        this.memories.set(id, existing);
        return {
          success: false,
          error: {
            type: 'STORAGE_ERROR',
            message: result.error.message,
          },
        };
      }
    }

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

    // Save current state to history before deletion (optional but good practice)
    this.saveHistory(existing);

    // Soft delete: mark as deleted with timestamp (GDPR compliance)
    const deletedMemory: Memory = {
      ...existing,
      isDeleted: true,
      deletedAt: new Date(),
      updatedAt: new Date(),
      version: existing.version + 1, // Increment version for deletion event? Usually deletion is a status change.
    };

    this.memories.set(id, deletedMemory);

    // Use Transaction Coordinator if available
    if (this.transactionCoordinator) {
      const result = await this.transactionCoordinator.deleteMemoryWithSaga(id);

      if (result.status === 'failed') {
        // Rollback in-memory storage (restore original)
        this.memories.set(id, existing);
        return {
          success: false,
          error: {
            type: 'STORAGE_ERROR',
            message: result.error.message,
          },
        };
      }
    }

    return {
      success: true,
      value: true,
    };
  }

  /**
   * Get history of a memory
   * Requirements: Task 3.2
   */
  async getMemoryHistory(id: MemoryId): Promise<MemoryHistoryEntry[]> {
    if (this.transactionCoordinator) {
      try {
        const versions = await this.transactionCoordinator.getMemoryVersions(id);
        return versions.map((v: any) => ({
          id: v.id, // History entry ID (not memory ID)
          memoryId: v.memoryId,
          version: v.version,
          content: v.content,
          metadata: v.metadata,
          timestamp: v.createdAt,
        }));
      } catch (error) {
        console.error('Failed to fetch history from DB, falling back to in-memory:', error);
      }
    }
    return this.history.get(id) || [];
  }

  /**
   * Revert memory to a specific version
   * Requirements: Task 3.2 Issue #1
   */
  async revertToVersion(memoryId: MemoryId, version: number): Promise<Result<boolean, MemoryError>> {
    // 1. Get the target version data
    let targetContent: string | undefined;
    let targetMetadata: MemoryMetadata | undefined;

    if (this.transactionCoordinator) {
      try {
        const historicalMemory = await this.transactionCoordinator.getMemoryVersion(memoryId, version);
        if (historicalMemory) {
          targetContent = historicalMemory.content;
          targetMetadata = historicalMemory.metadata;
        }
      } catch (error) {
        return {
          success: false,
          error: {
            type: 'STORAGE_ERROR',
            message: `Failed to retrieve version ${version}: ${error instanceof Error ? error.message : String(error)}`,
          },
        };
      }
    } else {
      // Fallback to in-memory history
      const history = this.history.get(memoryId) || [];
      const entry = history.find((h) => h.version === version);
      if (entry) {
        targetContent = entry.content;
        targetMetadata = entry.metadata;
      }
    }

    if (targetContent === undefined) {
      return {
        success: false,
        error: {
          type: 'MEMORY_NOT_FOUND',
          message: `Version ${version} not found for memory ${memoryId}`,
        },
      };
    }

    // 2. Update the memory with the old content (creating a new version)
    const updates: Partial<Memory> = {
      content: targetContent,
    };
    if (targetMetadata) {
      updates.metadata = targetMetadata;
    }

    return this.updateMemory(memoryId, updates);
  }

  /**
   * Find similar memories using vector search
   * Requirements: 1.3 (類似記憶の自動検出), Task 3.2
   * Note: This is a placeholder for in-memory implementation.
   * Full implementation will require VectorStoreAdapter (Task 5.1) and PostgreSQL.
   */
  async findSimilarMemories(content: string, limit: number = 5): Promise<Memory[]> {
    if (this.vectorStore) {
      try {
        const results = await this.vectorStore.searchSimilar(content, limit);
        const memories: Memory[] = [];

        for (const r of results) {
          try {
            // Process metadata through the same validation/normalization pipeline as storeMemory
            const processedMetadata = this.processMetadata(r.metadata as MemoryMetadata);

            // Extract and remove memoryType from metadata to maintain single source of truth
            const { memoryType: metadataType, ...metadataWithoutType } =
              processedMetadata as MemoryMetadata & { memoryType?: MemoryType };

            // Determine memory type: prefer metadata.memoryType, fallback to 'semantic'
            const memoryType = metadataType || (r.metadata?.memoryType as MemoryType) || 'semantic';

            memories.push({
              id: r.id,
              content: r.content,
              memoryType,
              metadata: metadataWithoutType,
              createdAt: r.createdAt,
              updatedAt: r.updatedAt,
              lastAccessedAt: r.lastAccessedAt || new Date(),
              accessCount: r.accessCount || 0,
              importanceScore: r.importanceScore || 0,
              isDeleted: false,
              isProtected: false,
              version: r.version || 1,
              deletedAt: null,
            });
          } catch (error) {
            // Skip invalid results and log the error
            console.warn(`Skipping invalid search result for memory ${r.id}:`, error);
            continue;
          }
        }

        return memories;
      } catch (error) {
        console.error('Vector search failed:', error);
        return [];
      }
    }
    return [];
  }

  /**
   * Suggest memories that could be merged with the given memory
   * Requirements: Task 3.2 Issue #2
   */
  async suggestMerges(memoryId: MemoryId): Promise<Memory[]> {
    const memory = this.memories.get(memoryId);
    if (!memory) {
      return [];
    }

    // Find similar memories with high threshold
    // Note: In a real implementation, we might want to expose threshold in findSimilarMemories
    // For now, we rely on the default or what vectorStore provides, but ideally we'd filter here.
    const similar = await this.findSimilarMemories(memory.content, 10);

    // Filter candidates:
    // 1. Exclude self
    // 2. Exclude deleted
    // 3. Require high similarity (if we had scores, here we assume vector store returns sorted)
    // 4. (Optional) Check for tag overlap or time proximity

    return similar.filter(m => {
      if (m.id === memoryId) return false;

      // Check current state in memory manager if available (to handle stale vector index)
      const current = this.memories.get(m.id);
      if (current && current.isDeleted) return false;

      return !m.isDeleted;
    });
  }

  /**
   * Save a memory snapshot to history
   */
  private saveHistory(memory: Memory): void {
    const entry: MemoryHistoryEntry = {
      id: randomUUID(),
      memoryId: memory.id,
      version: memory.version,
      content: memory.content,
      metadata: { ...memory.metadata }, // Deep copy metadata
      timestamp: memory.updatedAt,
    };

    const currentHistory = this.history.get(memory.id) || [];
    currentHistory.push(entry);
    this.history.set(memory.id, currentHistory);
  }

  /**
   * Merge multiple memories into a single memory
   * Requirements: 1.3 (統合), Task 3.2
   */
  async mergeMemories(ids: MemoryId[]): Promise<Result<MemoryId, MemoryError>> {
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
      // Ensure tags is an array before iterating (defensive check)
      if (memory.metadata.tags && Array.isArray(memory.metadata.tags)) {
        for (const tag of memory.metadata.tags) {
          allTags.add(tag);
        }
      }
    }

    // Create merged memory
    // Use first memory's type as the merged type (single source of truth)
    const mergedMemoryParams: StoreMemoryParams = {
      content: combinedContent,
      memoryType: memories[0]?.memoryType || 'semantic', // Use first memory's type
      metadata: {
        tags: Array.from(allTags).sort(), // Sorted for stable ordering
        source: 'merged',
        // Note: memoryType is managed at top-level only (single source of truth)
      },
    };

    const mergeResult = await this.storeMemory(mergedMemoryParams);
    if (!mergeResult.success) {
      return mergeResult;
    }

    // Capture snapshot of source memories before modification
    const snapshot = new Map<MemoryId, Memory>();
    for (const id of ids) {
      const memory = this.memories.get(id);
      if (memory) {
        // Deep copy to preserve original state
        snapshot.set(id, { ...memory });
      }
    }

    // Soft delete source memories with rollback on failure
    const deletedIds: MemoryId[] = [];
    for (const id of ids) {
      const deleteResult = await this.deleteMemory(id);
      if (!deleteResult.success) {
        // Rollback: restore all modified source memories
        for (const deletedId of deletedIds) {
          const original = snapshot.get(deletedId);
          if (original) {
            this.memories.set(deletedId, original);
          }
        }

        // Remove the merged memory to avoid inconsistency
        this.memories.delete(mergeResult.value);

        return {
          success: false,
          error: {
            type: deleteResult.error.type,
            message: `Merge aborted: failed to delete source ${id} (${deleteResult.error.message})`,
          },
        };
      }
      deletedIds.push(id);
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
    const threshold = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

    // 1. DB Garbage Collection via TransactionCoordinator
    if (this.transactionCoordinator) {
      try {
        const toRemove = await this.transactionCoordinator.findSoftDeletedMemories(threshold);
        console.log(`[GC] Found ${toRemove.length} memories to delete physically.`);

        for (const id of toRemove) {
          const result = await this.transactionCoordinator.hardDeleteMemory(id);
          if (result.status === 'failed') {
            console.error(`[GC] Failed to delete memory ${id}:`, result.error);
          } else if (result.status === 'partial') {
            console.warn(`[GC] Partial deletion for memory ${id}:`, result.warning);
          }
        }
      } catch (error) {
        console.error('[GC] Failed to perform DB garbage collection:', error);
      }
    }

    // 2. In-memory Garbage Collection (Legacy/Cache cleanup)
    // Find soft-deleted memories that are old enough and not protected
    const toRemoveInMemory: MemoryId[] = [];
    for (const [id, memory] of this.memories.entries()) {
      if (
        memory.isDeleted &&
        !memory.isProtected &&
        memory.deletedAt !== null &&
        memory.deletedAt !== undefined &&
        memory.deletedAt < threshold
      ) {
        toRemoveInMemory.push(id);
      }
    }

    // Physically remove these memories from memory cache
    for (const id of toRemoveInMemory) {
      this.memories.delete(id);
    }

    // Remove orphan links referencing deleted memories
    const toRemoveLinks: string[] = [];
    for (const [lid, link] of this.links.entries()) {
      // Check if endpoints are missing (deleted)
      if (!this.memories.has(link.fromMemoryId) || !this.memories.has(link.toMemoryId)) {
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

    // Check if either memory is deleted
    if (fromMemory.isDeleted) {
      return {
        success: false,
        error: {
          type: 'MEMORY_NOT_FOUND',
          message: `Cannot create link: source memory ${from} is deleted`,
        },
      };
    }

    if (toMemory.isDeleted) {
      return {
        success: false,
        error: {
          type: 'MEMORY_NOT_FOUND',
          message: `Cannot create link: target memory ${to} is deleted`,
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

    // Update memory type (single source of truth: top-level memoryType only)
    // Remove memoryType from metadata to maintain single source of truth
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { memoryType: _ignore, ...metadataWithoutType } = memory.metadata as MemoryMetadata & {
      memoryType?: MemoryType;
    };

    const updated: Memory = {
      ...memory,
      memoryType: newType,
      metadata: metadataWithoutType, // Ensure metadata.memoryType is removed
      updatedAt: new Date(),
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

  /**
   * Get all memory IDs (for reconciliation)
   * Requirements: 5.4 (整合性監視)
   */
  async getAllMemoryIds(): Promise<MemoryId[]> {
    const ids: MemoryId[] = [];

    for (const [id, memory] of this.memories.entries()) {
      // Only include non-deleted memories
      if (!memory.isDeleted) {
        ids.push(id);
      }
    }

    return ids;
  }
}
