#!/usr/bin/env tsx

/**
 * HNSWインデックス最適化スクリプト
 * 
 * Usage:
 *   tsx scripts/optimize-index.ts --m <number> --ef <number>
 * 
 * Example:
 *   tsx scripts/optimize-index.ts --m 24 --ef 128
 */

import { Pool } from 'pg';
import { IndexOptimizer } from '../src/performance/index-optimizer.js';
import dotenv from 'dotenv';

dotenv.config();

function parseArgs() {
    const args = process.argv.slice(2);
    const config: { m?: number; ef?: number } = {};

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--m' && args[i + 1]) {
            config.m = parseInt(args[i + 1]!, 10);
            i++;
        } else if (args[i] === '--ef' && args[i + 1]) {
            config.ef = parseInt(args[i + 1]!, 10);
            i++;
        }
    }
    return config;
}

async function main() {
    console.log('🚀 HNSW Index Optimizer');
    console.log('='.repeat(50));

    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL is not set.');
        process.exit(1);
    }

    const config = parseArgs();
    console.log(`Configuration: m=${config.m ?? 'default(16)'}, ef_construction=${config.ef ?? 'default(64)'}`);

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    });

    const optimizer = new IndexOptimizer({
        pgPool: pool,
    });

    try {
        console.log('\nOptimizing index "memories_embedding_hnsw_idx"...');

        // Note: Table name and column name are hardcoded based on schema
        // Table: memory_vectors, Column: embedding
        await optimizer.optimizeHNSWIndex('memory_vectors', 'embedding', {
            m: config.m,
            efConstruction: config.ef,
        });

        console.log('\n✅ Optimization completed successfully!');
        console.log('You can now run benchmarks to verify performance improvements.');

    } catch (error) {
        console.error('\n❌ Optimization failed:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main().catch(console.error);
