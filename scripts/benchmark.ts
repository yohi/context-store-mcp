#!/usr/bin/env tsx

/**
 * パフォーマンスベンチマークスクリプト
 * 実際のデータベース接続を使用してシステムパフォーマンスをテストします
 */

import { Pool } from 'pg';
import neo4j from 'neo4j-driver';
import { MemoryManager } from '../src/memory/memory-manager.js';
import { PostgresStorageAdapter } from '../src/storage/postgres-store-adapter.js';
import { VectorStoreAdapter } from '../src/storage/vector-store-adapter.js';
import { TransactionCoordinator } from '../src/storage/transaction-coordinator.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface BenchmarkResult {
  name: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  throughput: number;
  duration: number;
}

interface BenchmarkConfig {
  name: string;
  concurrency: number;
  totalRequests: number;
  operation: (index: number) => Promise<void>;
}

class PerformanceBenchmark {
  private results: BenchmarkResult[] = [];

  async runBenchmark(config: BenchmarkConfig): Promise<BenchmarkResult> {
    if (config.concurrency <= 0) throw new Error('Concurrency must be > 0');
    if (config.totalRequests <= 0) throw new Error('Total requests must be > 0');

    console.log(`\n🔄 Running benchmark: ${config.name}`);
    console.log(`   Concurrency: ${config.concurrency}`);
    console.log(`   Total Requests: ${config.totalRequests}`);

    const latencies: number[] = [];
    let successCount = 0;
    let failCount = 0;
    const startTime = Date.now();

    const batchSize = config.concurrency;
    const batches = Math.ceil(config.totalRequests / batchSize);

    let completedRequests = 0;

    for (let batch = 0; batch < batches; batch++) {
      const batchRequests = Math.min(
        batchSize,
        config.totalRequests - completedRequests
      );

      const promises = Array.from({ length: batchRequests }, async (_, i) => {
        const reqIndex = completedRequests + i;
        const reqStart = Date.now();
        try {
          await config.operation(reqIndex);
          const latency = Date.now() - reqStart;
          latencies.push(latency);
          successCount++;
        } catch (error) {
          failCount++;
          // console.error(`Request failed: ${error}`); // Reduce noise
        }
      });

      await Promise.all(promises);
      completedRequests += batchRequests;

      const progress = (completedRequests / config.totalRequests) * 100;
      process.stdout.write(`\r   Progress: ${progress.toFixed(1)}%`);
    }

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000; // seconds

    latencies.sort((a, b) => a - b);

    let avgLatency = 0;
    let p50 = 0;
    let p95 = 0;
    let p99 = 0;

    if (latencies.length > 0) {
      avgLatency = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
      p50 = latencies[Math.floor(latencies.length * 0.5)];
      p95 = latencies[Math.floor(latencies.length * 0.95)];
      p99 = latencies[Math.floor(latencies.length * 0.99)];
    }
    const throughput = successCount / duration;

    const result: BenchmarkResult = {
      name: config.name,
      totalRequests: config.totalRequests,
      successfulRequests: successCount,
      failedRequests: failCount,
      averageLatency: avgLatency,
      p50Latency: p50,
      p95Latency: p95,
      p99Latency: p99,
      throughput,
      duration,
    };

    this.results.push(result);
    this.printResult(result);

    return result;
  }

  private printResult(result: BenchmarkResult): void {
    console.log(`\n\n✅ Benchmark completed: ${result.name}`);
    console.log(`   Duration: ${result.duration.toFixed(2)}s`);
    console.log(
      `   Success Rate: ${((result.successfulRequests / result.totalRequests) * 100).toFixed(2)}%`
    );
    console.log(`   Throughput: ${result.throughput.toFixed(2)} req/s`);
    console.log(`   Average Latency: ${result.averageLatency.toFixed(2)}ms`);
    console.log(`   P50 Latency: ${result.p50Latency}ms`);
    console.log(`   P95 Latency: ${result.p95Latency}ms`);
    console.log(`   P99 Latency: ${result.p99Latency}ms`);
  }

  printSummary(): void {
    console.log('\n\n' + '='.repeat(80));
    console.log('📊 BENCHMARK SUMMARY');
    console.log('='.repeat(80));

    for (const result of this.results) {
      console.log(`\n${result.name}:`);
      console.log(
        `  Throughput: ${result.throughput.toFixed(2)} req/s | P95: ${result.p95Latency}ms | Success: ${((result.successfulRequests / result.totalRequests) * 100).toFixed(1)}%`
      );
    }
    console.log('\n' + '='.repeat(80));
  }
}

async function main() {
  console.log('🚀 Context Store MCP Performance Benchmark (Real DB)');
  console.log('='.repeat(80));

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set. Please check your .env file.');
    process.exit(1);
  }

  // Initialize DB connections
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  let neo4jDriver;
  if (process.env.NEO4J_URI && process.env.NEO4J_USER && process.env.NEO4J_PASSWORD) {
    neo4jDriver = neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
    );
  }

  const storage = new PostgresStorageAdapter(pool);

  let vectorStore;
  if (process.env.OPENAI_API_KEY) {
    vectorStore = new VectorStoreAdapter({
      pool,
      openaiApiKey: process.env.OPENAI_API_KEY,
    });
  } else {
    console.warn('⚠️ OPENAI_API_KEY not found. Vector search benchmarks will fail or be skipped.');
  }

  let transactionCoordinator;
  if (neo4jDriver) {
    transactionCoordinator = new TransactionCoordinator({
      postgresPool: pool,
      neo4jDriver: neo4jDriver,
    });
  }

  const config: any = { storage };
  if (vectorStore) config.vectorStore = vectorStore;
  if (transactionCoordinator) config.transactionCoordinator = transactionCoordinator;

  const memoryManager = new MemoryManager(config);

  const benchmark = new PerformanceBenchmark();
  const TEST_RUN_ID = `bench_${Date.now()}`;

  try {
    // 1. Memory Storage Benchmark
    await benchmark.runBenchmark({
      name: 'Memory Storage (Write)',
      concurrency: 5,
      totalRequests: 50,
      operation: async (i) => {
        await memoryManager.storeMemory({
          content: `Benchmark memory content ${i} for run ${TEST_RUN_ID}. This is a test memory to verify write performance.`,
          metadata: {
            source: 'benchmark',
            tags: ['benchmark', TEST_RUN_ID],
          },
        });
      },
    });

    // 2. Memory Search Benchmark (Metadata)
    await benchmark.runBenchmark({
      name: 'Memory Search (Metadata)',
      concurrency: 10,
      totalRequests: 100,
      operation: async () => {
        await memoryManager.searchMemories({
          tags: ['benchmark'],
          limit: 10,
        });
      },
    });

    // 3. Vector Search Benchmark (if available)
    if (vectorStore) {
      await benchmark.runBenchmark({
        name: 'Vector Search (Similarity)',
        concurrency: 5,
        totalRequests: 20, // Lower count due to API costs/limits
        operation: async () => {
          await memoryManager.findSimilarMemories(
            `Benchmark search query for run ${TEST_RUN_ID}`,
            5
          );
        },
      });
    }

  } catch (error) {
    console.error('Benchmark execution failed:', error);
  } finally {
    benchmark.printSummary();

    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await memoryManager.dispose();
    await pool.end();
    if (neo4jDriver) await neo4jDriver.close();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
