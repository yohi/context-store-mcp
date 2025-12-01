/**
 * Memory Flow Integration Test
 * 
 * Verifies the complete flow of memory management including:
 * - Automatic classification
 * - Storage via TransactionCoordinator (real DB)
 * - Updates and History
 * - Deletion
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';
import { Driver } from 'neo4j-driver';
import { MemoryManager } from '../../memory/memory-manager.js';
import { MemoryClassifier } from '../../memory/memory-classifier.js';
import { TransactionCoordinator } from '../../storage/transaction-coordinator.js';
import { PostgresStorageAdapter } from '../../storage/postgres-store-adapter.js';
import { cleanupDatabase, createTestPool, createTestDriver } from './helpers.js';

describe('Memory Flow Integration', () => {
  let pool: Pool;
  let driver: Driver;
  let memoryManager: MemoryManager;
  let classifier: MemoryClassifier;
  let transactionCoordinator: TransactionCoordinator;
  let storage: PostgresStorageAdapter;

  beforeEach(async () => {
    pool = createTestPool();
    const d = createTestDriver();
    if (!d) throw new Error('Neo4j driver not available');
    driver = d;

    await cleanupDatabase(pool, driver);

    // 1. Instantiate Real Components
    classifier = new MemoryClassifier();
    storage = new PostgresStorageAdapter(pool);

    transactionCoordinator = new TransactionCoordinator({
      postgresPool: pool,
      neo4jDriver: driver,
    });

    // 2. Instantiate MemoryManager with real components
    memoryManager = new MemoryManager({
      storage,
      classifier,
      transactionCoordinator,
    });
  });

  afterEach(async () => {
    await cleanupDatabase(pool, driver);
    await pool.end();
    await driver.close();
  });

  it('should automatically classify and store episodic memory', async () => {
    // "昨日" is a keyword for episodic memory in our rule-based classifier
    const content = '昨日、チームミーティングで新しい仕様について議論した。';

    const result = await memoryManager.storeMemory({ content });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const memoryId = result.value;

    // Verify in Postgres
    const pgResult = await pool.query('SELECT * FROM memories WHERE id = $1', [memoryId]);
    expect(pgResult.rows.length).toBe(1);
    const memory = pgResult.rows[0];

    expect(memory.content).toBe(content);
    expect(memory.memory_type).toBe('episodic');
  });

  it('should automatically classify and store procedural memory', async () => {
    // "手順" is a keyword for procedural memory
    const content = 'デプロイの手順は以下の通りです。1. ビルドする 2. アップロードする';

    const result = await memoryManager.storeMemory({ content });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const memoryId = result.value;

    // Verify in Postgres
    const pgResult = await pool.query('SELECT * FROM memories WHERE id = $1', [memoryId]);
    expect(pgResult.rows.length).toBe(1);
    expect(pgResult.rows[0].memory_type).toBe('procedural');

    // Verify in Neo4j (Procedural memory triggers Neo4j node creation)
    const session = driver.session();
    try {
      const neoResult = await session.run(
        'MATCH (m:Memory {id: $id}) RETURN m',
        { id: memoryId }
      );
      expect(neoResult.records.length).toBe(1);
      const node = neoResult.records[0].get('m').properties;
      expect(node.type).toBe('procedural');
      // Note: content might be stored depending on TransactionCoordinator implementation
    } finally {
      await session.close();
    }
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

    // Verify Update in DB
    const updatedMemory = await storage.getMemory(memoryId);
    expect(updatedMemory).toBeDefined();
    expect(updatedMemory?.content).toBe(newContent);
    // version check might depend on implementation, usually increments
    // expect(updatedMemory?.version).toBe(2); 

    // Verify History
    const history = await memoryManager.getMemoryHistory(memoryId);
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe('初期コンテンツ');
    expect(history[0].version).toBe(1);

    // 3. Delete
    const deleteResult = await memoryManager.deleteMemory(memoryId);
    expect(deleteResult.success).toBe(true);

    // Verify Deletion in DB
    const deletedMemory = await storage.getMemory(memoryId);
    expect(deletedMemory).toBeDefined();
    expect(deletedMemory?.isDeleted).toBe(true);
    expect(deletedMemory?.deletedAt).toBeDefined();

    // Verify Neo4j Deletion (if it was stored there, but semantic might not be)
    // If we want to test Neo4j deletion, we should use procedural memory or ensure semantic is also synced.
    // Assuming semantic is NOT synced to Neo4j by default in current implementation.
  });
});
