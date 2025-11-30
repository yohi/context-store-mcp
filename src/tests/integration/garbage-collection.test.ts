/**
 * Garbage Collection Integration Test
 * 不要な記憶の自動削除機能のテスト
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';
import { Driver } from 'neo4j-driver';
import { randomUUID } from 'crypto';
import { MemoryManager } from '../../memory/memory-manager.js';
import { cleanupDatabase, createTestPool, createTestDriver } from './helpers.js';
import { PostgresStorageAdapter } from '../../storage/postgres-store-adapter.js';
import { TransactionCoordinator } from '../../storage/transaction-coordinator.js';

describe('Garbage Collection Integration Tests', () => {
    let pool: Pool;
    let driver: Driver;
    let memoryManager: MemoryManager;

    beforeEach(async () => {
        pool = createTestPool();
        const d = createTestDriver();
        if (!d) throw new Error('Neo4j driver not available');
        driver = d;

        await cleanupDatabase(pool, driver);

        // MemoryManagerのセットアップ
        // 依存関係を手動で構築して注入
        const storage = new PostgresStorageAdapter(pool);
        const coordinator = new TransactionCoordinator({
            postgresPool: pool,
            neo4jDriver: driver,
        });

        memoryManager = new MemoryManager({
            storage,
            transactionCoordinator: coordinator
        });
    });

    afterEach(async () => {
        await cleanupDatabase(pool, driver);
        await pool.end();
        await driver.close();
    });

    it('should permanently delete old soft-deleted memories', async () => {
        const oldId = randomUUID();

        // 31日前に削除されたメモリを直接挿入
        await pool.query(`
      INSERT INTO memories (id, content, memory_type, metadata, created_at, updated_at, is_deleted, deleted_at, is_protected)
      VALUES ($1, 'Old deleted memory', 'episodic', '{}', NOW() - INTERVAL '90 days', NOW() - INTERVAL '60 days', true, NOW() - INTERVAL '60 days', false)
    `, [oldId]);

        // GC実行
        // @ts-ignore
        const coordinator = memoryManager.transactionCoordinator;
        if (coordinator) {
            const threshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const toRemove = await coordinator.findSoftDeletedMemories(threshold);
            console.log('Memories to remove:', toRemove);
            console.log('Threshold:', threshold.toISOString());
        }

        await memoryManager.performGarbageCollection();

        // 確認: 物理削除されているはず
        const result = await pool.query('SELECT * FROM memories WHERE id = $1', [oldId]);
        expect(result.rows.length).toBe(0);
    });

    it('should keep recent soft-deleted memories', async () => {
        const recentId = randomUUID();

        // 1日前に削除されたメモリ
        await pool.query(`
      INSERT INTO memories (id, content, memory_type, metadata, created_at, updated_at, is_deleted, deleted_at, is_protected)
      VALUES ($1, 'Recent deleted memory', 'episodic', '{}', NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day', true, NOW() - INTERVAL '1 day', false)
    `, [recentId]);

        // GC実行
        await memoryManager.performGarbageCollection();

        // 確認: まだ存在するはず
        const result = await pool.query('SELECT * FROM memories WHERE id = $1', [recentId]);
        expect(result.rows.length).toBe(1);
        expect(result.rows[0].is_deleted).toBe(true);
    });

    it('should keep protected memories even if old', async () => {
        const protectedId = randomUUID();

        // 31日前に削除されたが保護されているメモリ
        await pool.query(`
      INSERT INTO memories (id, content, memory_type, metadata, created_at, updated_at, is_deleted, deleted_at, is_protected)
      VALUES ($1, 'Protected old memory', 'episodic', '{}', NOW() - INTERVAL '60 days', NOW() - INTERVAL '31 days', true, NOW() - INTERVAL '31 days', true)
    `, [protectedId]);

        // GC実行
        await memoryManager.performGarbageCollection();

        // 確認: 保護されているので削除されないはず
        const result = await pool.query('SELECT * FROM memories WHERE id = $1', [protectedId]);
        expect(result.rows.length).toBe(1);
    });

    it('should not delete active memories', async () => {
        const activeId = randomUUID();

        // 古いが削除されていないメモリ
        await pool.query(`
      INSERT INTO memories (id, content, memory_type, metadata, created_at, updated_at, is_deleted, deleted_at, is_protected)
      VALUES ($1, 'Active old memory', 'episodic', '{}', NOW() - INTERVAL '60 days', NOW() - INTERVAL '60 days', false, NULL, false)
    `, [activeId]);

        // GC実行
        await memoryManager.performGarbageCollection();

        // 確認: 削除されていないはず
        const result = await pool.query('SELECT * FROM memories WHERE id = $1', [activeId]);
        expect(result.rows.length).toBe(1);
        expect(result.rows[0].is_deleted).toBe(false);
    });
});
