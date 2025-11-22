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

    // Verify chronological order (oldest first)
    expect(history[0].version).toBe(1);
    expect(history[0].content).toBe('Version 1 Content');
    
    expect(history[1].version).toBe(2);
    expect(history[1].content).toBe('Version 2 Content');
  });

  it('should increment version and record history even if content/metadata unchanged', async () => {
    // Any successful update call should increment version for consistency with `updatedAt`
    // and create a history record, even if the content appears identical.
    
    const memoryBefore = memoryManager.getMemoryForTest(memoryId);
    const historyBefore = await memoryManager.getMemoryHistory(memoryId);

    await memoryManager.updateMemory(memoryId, { content: 'Version 1 Content' }); // Same content
    
    const memoryAfter = memoryManager.getMemoryForTest(memoryId);
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
