/**
 * Integration Test Setup
 * グローバルセットアップとティアダウン
 */

import { Pool } from 'pg';
import neo4j, { Driver } from 'neo4j-driver';
import dotenv from 'dotenv';
import path from 'path';

// テスト環境変数をロード
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

let globalPool: Pool | null = null;
let globalDriver: Driver | null = null;

/**
 * グローバルセットアップ
 * テストスイート全体の前に一度だけ実行
 */
export async function setup() {
    console.log('🔧 Setting up integration test environment...');

    // PostgreSQL接続プールの作成
    globalPool = new Pool({
        connectionString: process.env['DATABASE_URL'],
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    });

    // 接続テスト
    try {
        await globalPool.query('SELECT 1');
        console.log('✅ PostgreSQL connection established');
    } catch (error) {
        console.error('❌ Failed to connect to PostgreSQL:', error);
        throw error;
    }

    // Neo4j接続の作成
    if (process.env['NEO4J_URI'] && process.env['NEO4J_USER'] && process.env['NEO4J_PASSWORD']) {
        globalDriver = neo4j.driver(
            process.env['NEO4J_URI'],
            neo4j.auth.basic(process.env['NEO4J_USER'], process.env['NEO4J_PASSWORD'])
        );

        // 接続テスト
        try {
            const session = globalDriver.session();
            await session.run('RETURN 1');
            await session.close();
            console.log('✅ Neo4j connection established');
        } catch (error) {
            console.error('❌ Failed to connect to Neo4j:', error);
            throw error;
        }
    }

    console.log('✅ Integration test environment ready');
}

/**
 * グローバルティアダウン
 * テストスイート全体の後に一度だけ実行
 */
export async function teardown() {
    console.log('🧹 Cleaning up integration test environment...');

    if (globalPool) {
        await globalPool.end();
        console.log('✅ PostgreSQL connection closed');
    }

    if (globalDriver) {
        await globalDriver.close();
        console.log('✅ Neo4j connection closed');
    }

    console.log('✅ Integration test environment cleaned up');
}

export function getGlobalPool(): Pool {
    if (!globalPool) {
        throw new Error('Global pool not initialized. Did you forget to call setup()?');
    }
    return globalPool;
}

export function getGlobalDriver(): Driver | null {
    return globalDriver;
}
