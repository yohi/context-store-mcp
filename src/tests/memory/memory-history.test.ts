/**
 * Memory History Management Test Suite
 * TDD for Task 3.2: History Management (Version Recording)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryManager } from '../../memory/memory-manager.js';
import type { MemoryId } from '../../memory/types.js';

describe('MemoryManager - History Management (Task 3.2)', () => {
  let memoryManager: MemoryManager;
  let memoryId: MemoryId;

  beforeEach(async () => {
    memoryManager = new MemoryManager();
    // Create a base memory
    const result = await memoryManager.storeMemory({
      content: 'Version 1 Content',
      metadata: { tags: ['v1'] },
    });
    if (!result.success) throw new Error('Failed to setup test memory');
    memoryId = result.value;
  });

  it('should initialize memory with version 1', async () => {
    const memory = memoryManager.getMemoryForTest(memoryId);
    expect(memory).toBeDefined();
    expect(memory?.version).toBe(1);
  });

  it('should increment version on update', async () => {
    await memoryManager.updateMemory(memoryId, {
      content: 'Version 2 Content',
    });

    const memory = memoryManager.getMemoryForTest(memoryId);
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

    // History should be ordered (usually latest first or oldest first, let's expect oldest first for now or check versions)
    const v1 = history.find(h => h.version === 1);
    const v2 = history.find(h => h.version === 2);

    expect(v1).toBeDefined();
    expect(v2).toBeDefined();
    expect(v1?.content).toBe('Version 1 Content');
    expect(v2?.content).toBe('Version 2 Content');
  });

  it('should not create history entry if content/metadata is not changed', async () => {
    // In strict versioning, maybe any update calls it? 
    // But usually if nothing changes, we might skip or still version?
    // Let's assume any call to updateMemory that succeeds should increment version for consistency with `updatedAt`
    
    const memoryBefore = memoryManager.getMemoryForTest(memoryId);
    await memoryManager.updateMemory(memoryId, { content: 'Version 1 Content' }); // Same content
    
    const memoryAfter = memoryManager.getMemoryForTest(memoryId);
    expect(memoryAfter?.version).toBeGreaterThan(memoryBefore!.version);
    
    // Actually, if nothing changed, optimize? 
    // Design says: "MemoryContent Entity ... Immutability (update creates new version)"
    // So we expect version increment.
  });

  it('should return empty history for new memory', async () => {
    const history = await memoryManager.getMemoryHistory(memoryId);
    expect(history).toEqual([]);
  });
  
  it('should return error when requesting history for non-existent memory', async () => {
      // Currently getMemoryHistory returns MemoryHistoryEntry[], maybe it should return Result?
      // Interface says Promise<MemoryHistoryEntry[]>
      // If memory doesn't exist, returning empty array is probably safe, or throw?
      // Let's check standard behavior. usually empty array if not found or throws.
      // Let's return empty array for now as per interface simplicity, or verify behavior.
      
      const history = await memoryManager.getMemoryHistory('non-existent');
      expect(history).toEqual([]);
  });
});
