/**
 * Memory Persistence Integration Test
 * 実データベースを使用した基本的な永続化機能のテスト
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';
import { Driver } from 'neo4j-driver';
import { MemoryManager } from '../../memory/memory-manager.js';
import {
    cleanupDatabase,
    createTestMemoryManager,
    isValidMemoryId,
    createTestPool,
    createTestDriver,
} from './helpers.js';
import type { StoreMemoryParams, MemoryId } from '../../memory/types.js';

describe('Memory Persistence Integration Tests', () => {
    let pool: Pool;
    let driver: Driver | null;
    let memoryManager: MemoryManager;

    beforeEach(async () => {
        pool = createTestPool();
        driver = createTestDriver();

        // データベースをクリーンアップ
        await cleanupDatabase(pool, driver || undefined);

        // MemoryManagerを作成（TransactionCoordinatorあり）
        memoryManager = await createTestMemoryManager(pool, driver || undefined, {
            includeVectorStore: false,
            includeTransactionCoordinator: true,
        });
    });

    afterEach(async () => {
        // テスト後のクリーンアップ
        await cleanupDatabase(pool, driver || undefined);
        await pool.end();
        if (driver) {
            await driver.close();
        }
    });

    describe('Basic CRUD Operations', () => {
        it('should store a memory and retrieve it', async () => {
            const params: StoreMemoryParams = {
                content: 'Test memory content for persistence',
                memoryType: 'semantic',
                metadata: {
                    tags: ['test', 'integration'],
                    source: 'integration-test',
                },
            };

            // メモリを保存
            const storeResult = await memoryManager.storeMemory(params);
            expect(storeResult.success).toBe(true);

            if (!storeResult.success) return;

            const memoryId = storeResult.value;
            expect(isValidMemoryId(memoryId)).toBe(true);

            // データベースから直接取得して確認
            const result = await pool.query(
                'SELECT * FROM memories WHERE id = $1',
                [memoryId]
            );

            expect(result.rows.length).toBe(1);
            const memory = result.rows[0];
            expect(memory.content).toBe(params.content);
            expect(memory.memory_type).toBe(params.memoryType);
            expect(memory.metadata.tags).toEqual(params.metadata?.tags);
            expect(memory.metadata.source).toBe(params.metadata?.source);
            expect(memory.is_deleted).toBe(false);
        });

        it('should update a memory', async () => {
            // メモリを作成
            const storeResult = await memoryManager.storeMemory({
                content: 'Original content',
                metadata: { tags: ['original'] },
            });

            expect(storeResult.success).toBe(true);
            if (!storeResult.success) return;

            const memoryId = storeResult.value;

            // メモリを更新
            const updateResult = await memoryManager.updateMemory(memoryId, {
                content: 'Updated content',
                metadata: { tags: ['updated'] },
            });

            expect(updateResult.success).toBe(true);

            // データベースから確認
            const result = await pool.query(
                'SELECT * FROM memories WHERE id = $1',
                [memoryId]
            );

            expect(result.rows.length).toBe(1);
            const memory = result.rows[0];
            expect(memory.content).toBe('Updated content');
            expect(memory.metadata.tags).toEqual(['updated']);
            expect(memory.updated_at).not.toEqual(memory.created_at);
        });

        it('should soft delete a memory', async () => {
            // メモリを作成
            const storeResult = await memoryManager.storeMemory({
                content: 'Memory to delete',
            });

            expect(storeResult.success).toBe(true);
            if (!storeResult.success) return;

            const memoryId = storeResult.value;

            // メモリを削除
            const deleteResult = await memoryManager.deleteMemory(memoryId);
            expect(deleteResult.success).toBe(true);

            // データベースから確認
            const result = await pool.query(
                'SELECT * FROM memories WHERE id = $1',
                [memoryId]
            );

            expect(result.rows.length).toBe(1);
            const memory = result.rows[0];
            expect(memory.is_deleted).toBe(true);
            expect(memory.deleted_at).not.toBeNull();
        });

        it('should not retrieve deleted memories in search', async () => {
            // 複数のメモリを作成
            const memory1 = await memoryManager.storeMemory({
                content: 'Active memory',
                metadata: { tags: ['test'] },
            });
            const memory2 = await memoryManager.storeMemory({
                content: 'Memory to delete',
                metadata: { tags: ['test'] },
            });

            expect(memory1.success && memory2.success).toBe(true);
            if (!memory1.success || !memory2.success) return;

            // 2つ目を削除
            await memoryManager.deleteMemory(memory2.value);

            // 検索
            const searchResult = await memoryManager.searchMemories({
                tags: ['test'],
            });

            // アクティブなメモリのみが返される
            expect(searchResult.length).toBe(1);
            expect(searchResult[0].id).toBe(memory1.value);
        });
    });

    describe('Metadata Handling', () => {
        it('should preserve metadata structure', async () => {
            const complexMetadata = {
                tags: ['tag1', 'tag2', 'tag3'],
                source: 'test-source',
                userId: 'user-123',
                projectId: 'project-456',
                customField: 'custom-value',
            };

            const storeResult = await memoryManager.storeMemory({
                content: 'Memory with complex metadata',
                metadata: complexMetadata,
            });

            expect(storeResult.success).toBe(true);
            if (!storeResult.success) return;

            // データベースから確認
            const result = await pool.query(
                'SELECT metadata FROM memories WHERE id = $1',
                [storeResult.value]
            );

            const savedMetadata = result.rows[0].metadata;
            expect(savedMetadata.tags).toEqual(complexMetadata.tags);
            expect(savedMetadata.source).toBe(complexMetadata.source);
            expect(savedMetadata.userId).toBe(complexMetadata.userId);
            expect(savedMetadata.projectId).toBe(complexMetadata.projectId);
            expect(savedMetadata.customField).toBe(complexMetadata.customField);
        });

        it('should handle empty metadata', async () => {
            const storeResult = await memoryManager.storeMemory({
                content: 'Memory without metadata',
            });

            expect(storeResult.success).toBe(true);
            if (!storeResult.success) return;

            const result = await pool.query(
                'SELECT metadata FROM memories WHERE id = $1',
                [storeResult.value]
            );

            const metadata = result.rows[0].metadata;
            expect(metadata).toBeDefined();
            expect(typeof metadata).toBe('object');
        });
    });

    describe('Timestamp Management', () => {
        it('should automatically set timestamps on creation', async () => {
            const beforeCreate = new Date();

            const storeResult = await memoryManager.storeMemory({
                content: 'Test timestamp creation',
            });

            const afterCreate = new Date();

            expect(storeResult.success).toBe(true);
            if (!storeResult.success) return;

            const result = await pool.query(
                'SELECT created_at, updated_at FROM memories WHERE id = $1',
                [storeResult.value]
            );

            const memory = result.rows[0];
            const createdAt = new Date(memory.created_at);
            const updatedAt = new Date(memory.updated_at);

            expect(createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
            expect(createdAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
            expect(updatedAt.getTime()).toBe(createdAt.getTime());
        });

        it('should update updatedAt on modification', async () => {
            const storeResult = await memoryManager.storeMemory({
                content: 'Original content',
            });

            expect(storeResult.success).toBe(true);
            if (!storeResult.success) return;

            // 少し待機
            await new Promise((resolve) => setTimeout(resolve, 100));

            await memoryManager.updateMemory(storeResult.value, {
                content: 'Updated content',
            });

            const result = await pool.query(
                'SELECT created_at, updated_at FROM memories WHERE id = $1',
                [storeResult.value]
            );

            const memory = result.rows[0];
            const createdAt = new Date(memory.created_at);
            const updatedAt = new Date(memory.updated_at);

            expect(updatedAt.getTime()).toBeGreaterThan(createdAt.getTime());
        });

        it('should set deletedAt on soft delete', async () => {
            const storeResult = await memoryManager.storeMemory({
                content: 'Memory to delete',
            });

            expect(storeResult.success).toBe(true);
            if (!storeResult.success) return;

            const beforeDelete = new Date();
            await memoryManager.deleteMemory(storeResult.value);
            const afterDelete = new Date();

            const result = await pool.query(
                'SELECT deleted_at FROM memories WHERE id = $1',
                [storeResult.value]
            );

            const deletedAt = new Date(result.rows[0].deleted_at);
            expect(deletedAt.getTime()).toBeGreaterThanOrEqual(beforeDelete.getTime());
            expect(deletedAt.getTime()).toBeLessThanOrEqual(afterDelete.getTime());
        });
    });

    describe('Error Handling', () => {
        it('should return error for non-existent memory', async () => {
            const fakeId = '00000000-0000-4000-8000-000000000000';

            const updateResult = await memoryManager.updateMemory(fakeId, {
                content: 'Should fail',
            });

            expect(updateResult.success).toBe(false);
            if (updateResult.success) return;

            expect(updateResult.error.type).toBe('MEMORY_NOT_FOUND');
        });

        it('should reject empty content', async () => {
            const storeResult = await memoryManager.storeMemory({
                content: '',
            });

            expect(storeResult.success).toBe(false);
            if (storeResult.success) return;

            expect(storeResult.error.type).toBe('INVALID_CONTENT');
        });
    });
});
