/**
 * Memory Flow Integration Test
 * 
 * Verifies the complete flow of memory management including:
 * - Automatic classification
 * - Storage via TransactionCoordinator (simulated)
 * - Updates and History
 * - Deletion
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryManager } from '../../memory/memory-manager';
import { MemoryClassifier } from '../../memory/memory-classifier';
import { TransactionCoordinator } from '../../storage/transaction-coordinator';
import type { VectorStoreAdapter } from '../../storage/vector-store-adapter';
import type { GraphStoreAdapter } from '../../storage/graph-store-adapter';

describe('Memory Flow Integration', () => {
  let memoryManager: MemoryManager;
  let classifier: MemoryClassifier;
  let transactionCoordinator: TransactionCoordinator;
  let mockVectorStore: VectorStoreAdapter;
  let mockGraphStore: GraphStoreAdapter;
  let mockPgPool: any;
  let mockNeo4jDriver: any;
  let mockNeo4jSession: any;

  beforeEach(() => {
    // 1. Instantiate Real Classifier
    classifier = new MemoryClassifier();

    // 2. Mock DB Drivers for TransactionCoordinator
    mockPgPool = {
      query: vi.fn().mockResolvedValue({ rowCount: 1 }),
    };

    mockNeo4jSession = {
      run: vi.fn().mockResolvedValue({ records: [] }),
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockNeo4jDriver = {
      session: vi.fn().mockReturnValue(mockNeo4jSession),
    };

    // 3. Instantiate Real TransactionCoordinator with mocked drivers
    transactionCoordinator = new TransactionCoordinator({
      postgresPool: mockPgPool,
      neo4jDriver: mockNeo4jDriver,
    });

    // 4. Mock Adapters (still needed for MemoryManager optional dependencies if any)
    mockVectorStore = {
      storeWithEmbedding: vi.fn().mockResolvedValue('vector-id'),
      deleteVector: vi.fn().mockResolvedValue(true),
      searchSimilar: vi.fn().mockResolvedValue([]),
    } as unknown as VectorStoreAdapter;

    mockGraphStore = {
      createNode: vi.fn().mockResolvedValue('node-id'),
      createRelationship: vi.fn().mockResolvedValue('edge-id'),
      deleteNode: vi.fn().mockResolvedValue(true),
      traverseGraph: vi.fn().mockResolvedValue([]),
    } as unknown as GraphStoreAdapter;

    // 5. Instantiate MemoryManager with real components
    memoryManager = new MemoryManager({
      classifier,
      transactionCoordinator,
      vectorStore: mockVectorStore,
      graphStore: mockGraphStore,
    });
  });

  it('should automatically classify and store episodic memory', async () => {
    // "昨日" is a keyword for episodic memory in our rule-based classifier
    const content = '昨日、チームミーティングで新しい仕様について議論した。';
    
    const result = await memoryManager.storeMemory({ content });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const memoryId = result.value;
    const memory = memoryManager.getMemoryForTest(memoryId);

    expect(memory).toBeDefined();
    expect(memory?.memoryType).toBe('episodic');
    
    // Verify TransactionCoordinator used PG Pool
    expect(mockPgPool.query).toHaveBeenCalled();
    // Verify it tried to insert into memories table
    expect(mockPgPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO memories'),
      expect.any(Array)
    );
  });

  it('should automatically classify and store procedural memory', async () => {
    // "手順" is a keyword for procedural memory
    const content = 'デプロイの手順は以下の通りです。1. ビルドする 2. アップロードする';
    
    const result = await memoryManager.storeMemory({ content });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const memoryId = result.value;
    const memory = memoryManager.getMemoryForTest(memoryId);

    expect(memory).toBeDefined();
    expect(memory?.memoryType).toBe('procedural');
    
    // Procedural memory triggers Neo4j node creation in TransactionCoordinator
    expect(mockNeo4jDriver.session).toHaveBeenCalled();
    expect(mockNeo4jSession.run).toHaveBeenCalledWith(
      expect.stringContaining('MERGE (m:Memory'),
      expect.objectContaining({ type: 'procedural' })
    );
  });

  it('should handle full lifecycle: Store -> Update -> Delete', async () => {
    // 1. Store
    const content = '初期コンテンツ';
    const storeResult = await memoryManager.storeMemory({ content, memoryType: 'semantic' });
    expect(storeResult.success).toBe(true);
    if (!storeResult.success) return;
    const memoryId = storeResult.value;

    // 2. Update
    const newContent = '更新されたコンテンツ';
    const updateResult = await memoryManager.updateMemory(memoryId, { content: newContent });
    expect(updateResult.success).toBe(true);

    const updatedMemory = memoryManager.getMemoryForTest(memoryId);
    expect(updatedMemory?.content).toBe(newContent);
    expect(updatedMemory?.version).toBe(2);

    // Verify History
    const history = await memoryManager.getMemoryHistory(memoryId);
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe('初期コンテンツ');
    expect(history[0].version).toBe(1);

    // 3. Delete
    const deleteResult = await memoryManager.deleteMemory(memoryId);
    expect(deleteResult.success).toBe(true);

    const deletedMemory = memoryManager.getMemoryForTest(memoryId);
    expect(deletedMemory?.isDeleted).toBe(true);
    expect(deletedMemory?.deletedAt).toBeDefined();

    // Verify TransactionCoordinator delete was called (PG update and Neo4j detach delete)
    expect(mockPgPool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE memories SET is_deleted = true'),
      expect.any(Array)
    );
    expect(mockNeo4jSession.run).toHaveBeenCalledWith(
      expect.stringContaining('MATCH (m:Memory {id: $id}) DETACH DELETE m'),
      expect.any(Object)
    );
  });
});
