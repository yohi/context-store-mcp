/**
 * Global Setup for Integration Tests
 * Vitest globalSetup - runs once before all tests
 */

import { Pool } from 'pg';
import neo4j, { Driver } from 'neo4j-driver';
import dotenv from 'dotenv';
import path from 'path';

// テスト環境変数をロード
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

export async function setup() {
    console.log('🔧 Setting up integration test environment...');

    // PostgreSQL接続テスト
    const pool = new Pool({
        connectionString: process.env['DATABASE_URL'],
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    });

    try {
        await pool.query('SELECT 1');
        console.log('✅ PostgreSQL connection established');
    } catch (error) {
        console.error('❌ Failed to connect to PostgreSQL:', error);
        throw error;
    } finally {
        await pool.end();
    }

    // Neo4j接続テスト
    if (process.env['NEO4J_URI'] && process.env['NEO4J_USER'] && process.env['NEO4J_PASSWORD']) {
        const driver = neo4j.driver(
            process.env['NEO4J_URI'],
            neo4j.auth.basic(process.env['NEO4J_USER'], process.env['NEO4J_PASSWORD'])
        );

        try {
            const session = driver.session();
            await session.run('RETURN 1');
            await session.close();
            console.log('✅ Neo4j connection established');
        } catch (error) {
            console.error('❌ Failed to connect to Neo4j:', error);
            throw error;
        } finally {
            await driver.close();
        }
    }

    console.log('✅ Integration test environment ready');
}

export async function teardown() {
    console.log('✅ Integration test environment cleaned up');
}
