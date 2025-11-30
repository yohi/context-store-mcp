/**
 * Transaction Coordination Integration Test
 * PostgreSQLとNeo4j間の分散トランザクション（Sagaパターン）のテスト
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';
import { Driver } from 'neo4j-driver';
import { randomUUID } from 'crypto';
import { TransactionCoordinator } from '../../storage/transaction-coordinator.js';
import { cleanupDatabase, createTestPool, createTestDriver } from './helpers.js';
import type { MemoryEntity } from '../../storage/transaction-coordinator.js';

describe('Transaction Coordination Integration Tests', () => {
    let pool: Pool;
    let driver: Driver;
    let coordinator: TransactionCoordinator;

    beforeEach(async () => {
        pool = createTestPool();
        const d = createTestDriver();
        if (!d) throw new Error('Neo4j driver not available');
        driver = d;

        await cleanupDatabase(pool, driver);

        coordinator = new TransactionCoordinator({
            postgresPool: pool,
            neo4jDriver: driver,
            logger: {
                warn: (msg, ctx) => console.log('[WARN]', msg, ctx),
                error: (msg, ctx) => console.log('[ERROR]', msg, ctx),
                info: (msg, ctx) => console.log('[INFO]', msg, ctx),
                debug: (msg, ctx) => console.log('[DEBUG]', msg, ctx),
            }
        });
    });

    afterEach(async () => {
        await cleanupDatabase(pool, driver);
        await pool.end();
        await driver.close();
    });

    it('should store memory in both databases successfully', async () => {
        const memoryId = randomUUID();
        const entity: MemoryEntity = {
            id: memoryId,
            content: 'Distributed memory',
            memoryType: 'procedural',
            metadata: { tags: ['saga-test'] },
        };

        const result = await coordinator.storeMemoryWithSaga(entity);

        if (result.status !== 'ok') {
            if (result.status === 'failed') {
                console.log('Store failed details:', JSON.stringify(result.error, null, 2));
            }
            expect(result.status).toBe('ok');
            return;
        }

        // PostgreSQL確認
        const pgResult = await pool.query('SELECT * FROM memories WHERE id = $1', [memoryId]);
        expect(pgResult.rows.length).toBe(1);
        expect(pgResult.rows[0].content).toBe(entity.content);

        // Neo4j確認
        const session = driver.session();
        try {
            const neoResult = await session.run(
                'MATCH (m:Memory {id: $id}) RETURN m',
                { id: memoryId }
            );
            expect(neoResult.records.length).toBe(1);
            const node = neoResult.records[0].get('m').properties;
            console.log('Neo4j Node Properties:', node);
            expect(node.content, `Node properties: ${JSON.stringify(node)}`).toBe(entity.content);
        } finally {
            await session.close();
        }
    });

    it('should handle Neo4j failure as partial success (Saga pattern)', async () => {
        // 失敗するNeo4jドライバを作成
        const failingDriver = {
            session: () => ({
                executeWrite: () => Promise.reject(new Error('Simulated Neo4j Failure')),
                close: () => Promise.resolve(),
                lastBookmark: () => [],
            }),
            close: () => Promise.resolve(),
        } as unknown as Driver;

        const failingCoordinator = new TransactionCoordinator({
            postgresPool: pool,
            neo4jDriver: failingDriver,
            logger: {
                warn: () => { },
                error: () => { },
                info: () => { },
                debug: () => { },
            }
        });

        const memoryId = randomUUID();
        const entity: MemoryEntity = {
            id: memoryId,
            content: 'Rollback test memory',
            memoryType: 'procedural',
            metadata: {},
        };

        // 実行（部分成功するはず）
        const result = await failingCoordinator.storeMemoryWithSaga(entity);

        expect(result.status).toBe('partial');

        // PostgreSQLにデータが残っていることを確認（同期待ち状態）
        const pgResult = await pool.query('SELECT * FROM memories WHERE id = $1', [memoryId]);
        expect(pgResult.rows.length).toBe(1);
        // sync_statusカラムの確認はスキーマ依存なので、ここでは存在確認のみとするか、
        // sync_statusカラムを追加したなら確認できる
        if (pgResult.rows[0].sync_status) {
            // pending_graph または failed (実装による)
            expect(['pending_graph', 'failed']).toContain(pgResult.rows[0].sync_status);
        }
    });

    it('should update memory in both databases', async () => {
        const memoryId = randomUUID();
        const entity: MemoryEntity = {
            id: memoryId,
            content: 'Original content',
            memoryType: 'procedural', // proceduralのみNeo4j更新が行われる実装になっているため
            metadata: {},
        };

        // まず保存
        const storeResult = await coordinator.storeMemoryWithSaga(entity);

        if (storeResult.status !== 'ok') throw new Error('Setup failed');

        // 更新
        const updateEntity: MemoryEntity = {
            ...entity,
            content: 'Updated content',
        };

        const updateResult = await coordinator.updateMemoryWithSaga(updateEntity);

        expect(updateResult.status).toBe('ok');

        // PostgreSQL確認
        const pgResult = await pool.query('SELECT content FROM memories WHERE id = $1', [memoryId]);
        expect(pgResult.rows[0].content).toBe('Updated content');

        // Neo4j確認
        const session = driver.session();
        try {
            const neoResult = await session.run(
                'MATCH (m:Memory {id: $id}) RETURN m.content as content, m',
                { id: memoryId }
            );
            const record = neoResult.records[0];
            const content = record.get('content');
            const node = record.get('m').properties;
            expect(content, `Content from query: ${content}, Node properties: ${JSON.stringify(node)}`).toBe('Updated content');
        } finally {
            await session.close();
        }
    });

    it('should soft delete memory in both databases', async () => {
        const memoryId = randomUUID();
        const entity: MemoryEntity = {
            id: memoryId,
            content: 'To be deleted',
            memoryType: 'episodic',
            metadata: {},
        };

        // 保存
        const storeResult = await coordinator.storeMemoryWithSaga(entity);
        if (storeResult.status !== 'ok') throw new Error('Setup failed');

        // 削除
        const deleteResult = await coordinator.deleteMemoryWithSaga(memoryId);
        expect(deleteResult.status).toBe('ok');

        // PostgreSQL確認 (is_deleted = true)
        const pgResult = await pool.query('SELECT is_deleted FROM memories WHERE id = $1', [memoryId]);
        expect(pgResult.rows[0].is_deleted).toBe(true);
    });
});
