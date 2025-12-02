/**
 * Integration Test Helpers
 * テストデータベースのセットアップとクリーンアップユーティリティ
 */

import { Pool } from 'pg';
import { Driver } from 'neo4j-driver';
import neo4j from 'neo4j-driver';
import { MemoryManager } from '../../memory/memory-manager.js';
import { PostgresStorageAdapter } from '../../storage/postgres-store-adapter.js';
import { VectorStoreAdapter } from '../../storage/vector-store-adapter.js';
import { TransactionCoordinator } from '../../storage/transaction-coordinator.js';

/**
 * テスト用のPostgreSQLプールを作成
 */
export function createTestPool(): Pool {
    return new Pool({
        connectionString: process.env['DATABASE_URL'],
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    });
}

/**
 * テスト用のNeo4jドライバーを作成
 */
export function createTestDriver(): Driver | null {
    if (process.env['NEO4J_URI'] && process.env['NEO4J_USER'] && process.env['NEO4J_PASSWORD']) {
        return neo4j.driver(
            process.env['NEO4J_URI'],
            neo4j.auth.basic(process.env['NEO4J_USER'], process.env['NEO4J_PASSWORD'])
        );
    }
    return null;
}

/**
 * テストデータベースのクリーンアップ
 */
export async function cleanupDatabase(pool: Pool, driver?: Driver) {
    // PostgreSQLテーブルのクリーンアップ
    await pool.query('TRUNCATE TABLE memory_history CASCADE');
    await pool.query('TRUNCATE TABLE memory_vectors CASCADE');
    await pool.query('TRUNCATE TABLE memories CASCADE');

    // Neo4jのクリーンアップ（利用可能な場合）
    if (driver) {
        const session = driver.session();
        try {
            await session.run('MATCH (n) DETACH DELETE n');
        } finally {
            await session.close();
        }
    }
}

/**
 * テスト用MemoryManagerの作成
 */
export async function createTestMemoryManager(
    pool: Pool,
    driver?: Driver,
    options: {
        includeVectorStore?: boolean;
        includeTransactionCoordinator?: boolean;
    } = {}
): Promise<MemoryManager> {
    const { includeVectorStore = false, includeTransactionCoordinator = false } = options;

    // StorageAdapterの作成
    const storage = new PostgresStorageAdapter(pool);

    // VectorStoreAdapterの作成（オプション）
    let vectorStore: VectorStoreAdapter | undefined;
    if (includeVectorStore && process.env['OPENAI_API_KEY']) {
        vectorStore = new VectorStoreAdapter({
            pool,
            openaiApiKey: process.env['OPENAI_API_KEY'],
        });
    }

    // TransactionCoordinatorの作成（オプション）
    let transactionCoordinator: TransactionCoordinator | undefined;
    if (includeTransactionCoordinator && !driver) {
        throw new Error('TransactionCoordinator requested but Neo4j driver is not available.');
    }
    if (includeTransactionCoordinator && driver) {
        transactionCoordinator = new TransactionCoordinator({
            postgresPool: pool,
            neo4jDriver: driver,
        });
    }

    // 設定オブジェクトの構築
    const config: any = { storage };
    if (vectorStore) config.vectorStore = vectorStore;
    if (transactionCoordinator) config.transactionCoordinator = transactionCoordinator;

    return new MemoryManager(config);
}

/**
 * テストデータの待機
 * データベースの一貫性を確保するための遅延
 */
export async function waitForConsistency(ms: number = 100): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * メモリIDの検証
 */
export function isValidMemoryId(id: string): boolean {
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidV4Regex.test(id);
}
