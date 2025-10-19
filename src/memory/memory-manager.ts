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
    const now = new Date();

    // For now, we're just validating and generating IDs
    // Actual storage will be implemented in later tasks when we integrate with PostgreSQL
    // This is the minimal implementation to make tests pass (GREEN step of TDD)

    return {
      success: true,
      value: memoryId,
    };
  }

  async updateMemory(
    id: MemoryId,
    updates: Partial<Memory>
  ): Promise<Result<boolean, MemoryError>> {
    // To be implemented in task 3.2
    throw new Error('Not implemented yet');
  }

  async deleteMemory(id: MemoryId): Promise<Result<boolean, MemoryError>> {
    // To be implemented in task 3.2
    throw new Error('Not implemented yet');
  }

  async mergeMemories(
    ids: MemoryId[]
  ): Promise<Result<MemoryId, MemoryError>> {
    // To be implemented in task 3.2
    throw new Error('Not implemented yet');
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
