/**
 * Memory History Management Test Suite
 * TDD for Task 3.2: History Management (Version Recording)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryManager } from '../../memory/memory-manager.js';
import type { MemoryId } from '../../memory/types.js';
import { MockStorageAdapter, MockTransactionCoordinator } from '../mocks/index.js';

describe('MemoryManager - History Management (Task 3.2)', () => {
  let memoryManager: MemoryManager;
  let mockStorage: MockStorageAdapter;
  let mockTransactionCoordinator: MockTransactionCoordinator;
  let memoryId: MemoryId;

  beforeEach(async () => {
    mockStorage = new MockStorageAdapter();
    mockTransactionCoordinator = new MockTransactionCoordinator();
    
    // Link TC to Storage for updates
    mockTransactionCoordinator.storeMemoryWithSaga = vi.fn().mockImplementation(async (entity) => {
        // Mocking the effect of storage
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
            version: entity.version || 1, // Handle version
            deletedAt: null
        };
        mockStorage.memories.set(entity.id, memory);
        return { status: 'ok', memoryId: entity.id };
    });

    mockTransactionCoordinator.updateMemoryWithSaga = vi.fn().mockImplementation(async (entity) => {
        const existing = mockStorage.memories.get(entity.id);
        if (existing) {
            mockStorage.memories.set(entity.id, {
                ...existing,
                content: entity.content,
                metadata: entity.metadata,
                memoryType: entity.memoryType,
                version: entity.version || existing.version + 1, // Handle version if passed
                updatedAt: new Date()
            });
        }
        return { status: 'ok', memoryId: entity.id };
    });

    memoryManager = new MemoryManager({
        storage: mockStorage,
        transactionCoordinator: mockTransactionCoordinator as any
    });

    // Create a base memory
    const result = await memoryManager.storeMemory({
      content: 'Version 1 Content',
      metadata: { tags: ['v1'] },
    });
    if (!result.success) throw new Error('Failed to setup test memory');
    memoryId = result.value;
  });

  it('should initialize memory with version 1', async () => {
    const memory = mockStorage.getMemoryForTest(memoryId);
    expect(memory).toBeDefined();
    expect(memory?.version).toBe(1);
  });

  it('should increment version on update', async () => {
    await memoryManager.updateMemory(memoryId, {
      content: 'Version 2 Content',
    });

    const memory = mockStorage.getMemoryForTest(memoryId);
    expect(memory?.version).toBe(2);
    expect(memory?.content).toBe('Version 2 Content');
  });

  it('should record history when updating', async () => {
    // Update to V2
    await memoryManager.updateMemory(memoryId, {
      content: 'Version 2 Content',
      metadata: { tags: ['v2'] },
    });

    // Get history
    const history = await memoryManager.getMemoryHistory(memoryId);
    expect(history).toHaveLength(1);
    
    const entry = history[0];
    expect(entry.version).toBe(1);
    expect(entry.content).toBe('Version 1 Content');
    expect(entry.metadata.tags).toContain('v1');
    expect(entry.memoryId).toBe(memoryId);
  });

  it('should maintain chronological history order', async () => {
    // V1 -> V2
    await memoryManager.updateMemory(memoryId, { content: 'Version 2 Content' });
    // V2 -> V3
    await memoryManager.updateMemory(memoryId, { content: 'Version 3 Content' });

    const history = await memoryManager.getMemoryHistory(memoryId);
    expect(history).toHaveLength(2);

    // Verify chronological order (oldest first)
    expect(history[0].version).toBe(1);
    expect(history[0].content).toBe('Version 1 Content');
    
    expect(history[1].version).toBe(2);
    expect(history[1].content).toBe('Version 2 Content');
  });

  it('should increment version and record history even if content/metadata unchanged', async () => {
    // Any successful update call should increment version for consistency with `updatedAt`
    // and create a history record, even if the content appears identical.
    
    const memoryBefore = mockStorage.getMemoryForTest(memoryId);
    const historyBefore = await memoryManager.getMemoryHistory(memoryId);

    await memoryManager.updateMemory(memoryId, { content: 'Version 1 Content' }); // Same content
    
    const memoryAfter = mockStorage.getMemoryForTest(memoryId);
    expect(memoryAfter?.version).toBeGreaterThan(memoryBefore!.version);
    
    const historyAfter = await memoryManager.getMemoryHistory(memoryId);
    expect(historyAfter.length).toBeGreaterThan(historyBefore.length);
  });

  it('should return empty history for new memory', async () => {
    const history = await memoryManager.getMemoryHistory(memoryId);
    expect(history).toEqual([]);
  });
  
  it('should return empty history for non-existent memory', async () => {
      const history = await memoryManager.getMemoryHistory('non-existent');
      expect(history).toEqual([]);
  });
});
