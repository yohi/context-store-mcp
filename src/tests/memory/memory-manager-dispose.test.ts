/**
 * MemoryManager dispose() メソッドのテスト
 */

import { describe, it, expect, vi } from 'vitest';
import { MemoryManager } from '../../memory/memory-manager.js';
import { PostgresStorageAdapter } from '../../storage/postgres-store-adapter.js';
import { Pool } from 'pg';

describe('MemoryManager Disposal', () => {
    describe('dispose() method', () => {
        it('should exist and be callable', async () => {
            // モックプールを作成
            const mockPool = {
                query: vi.fn(),
                end: vi.fn().mockResolvedValue(undefined),
            } as unknown as Pool;

            // 外部ストレージを作成
            const externalStorage = new PostgresStorageAdapter(mockPool);

            // MemoryManagerを作成
            const memoryManager = new MemoryManager({ storage: externalStorage });

            // dispose()メソッドが存在することを確認
            expect(memoryManager.dispose).toBeDefined();
            expect(typeof memoryManager.dispose).toBe('function');

            // dispose()を呼び出せることを確認
            await expect(memoryManager.dispose()).resolves.toBeUndefined();
        });

        it('should not close the pool when storage is provided externally', async () => {
            // モックプールを作成
            const mockPool = {
                query: vi.fn(),
                end: vi.fn().mockResolvedValue(undefined),
            } as unknown as Pool;

            // 外部ストレージを作成
            const externalStorage = new PostgresStorageAdapter(mockPool);

            // MemoryManagerを作成（外部ストレージを提供）
            const memoryManager = new MemoryManager({ storage: externalStorage });

            // dispose()を呼び出す
            await memoryManager.dispose();

            // pool.end()が呼ばれていないことを確認（外部管理のため）
            expect(mockPool.end).not.toHaveBeenCalled();
        });

        it('should be idempotent when storage is external', async () => {
            // モックプールを作成
            const mockPool = {
                query: vi.fn(),
                end: vi.fn().mockResolvedValue(undefined),
            } as unknown as Pool;

            // 外部ストレージを作成
            const externalStorage = new PostgresStorageAdapter(mockPool);

            // MemoryManagerを作成
            const memoryManager = new MemoryManager({ storage: externalStorage });

            // dispose()を複数回呼び出す
            await memoryManager.dispose();
            await memoryManager.dispose();
            await memoryManager.dispose();

            // エラーが発生しないことを確認（冪等性）
            expect(mockPool.end).not.toHaveBeenCalled();
        });
    });

    describe('PostgresStorageAdapter close() method', () => {
        it('should close the pool when called', async () => {
            // モックプールを作成
            const mockPool = {
                query: vi.fn(),
                end: vi.fn().mockResolvedValue(undefined),
            } as unknown as Pool;

            // PostgresStorageAdapterを作成
            const adapter = new PostgresStorageAdapter(mockPool);

            // close()を呼び出す
            await adapter.close();

            // pool.end()が呼ばれたことを確認
            expect(mockPool.end).toHaveBeenCalledTimes(1);
        });

        it('should propagate errors from pool.end()', async () => {
            // モックプールを作成（エラーを投げる）
            const mockError = new Error('Failed to close pool');
            const mockPool = {
                query: vi.fn(),
                end: vi.fn().mockRejectedValue(mockError),
            } as unknown as Pool;

            // PostgresStorageAdapterを作成
            const adapter = new PostgresStorageAdapter(mockPool);

            // close()がエラーを投げることを確認
            await expect(adapter.close()).rejects.toThrow('Failed to close pool');
        });
    });
});
