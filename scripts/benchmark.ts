#!/usr/bin/env tsx

/**
 * Performance Benchmark Script
 * Tests system performance under various load conditions
 */

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
  operation: () => Promise<void>;
}

class PerformanceBenchmark {
  private results: BenchmarkResult[] = [];

  async runBenchmark(config: BenchmarkConfig): Promise<BenchmarkResult> {
    // Input validation to prevent infinite loops and invalid statistics
    if (config.concurrency <= 0) {
      throw new Error(
        `Invalid concurrency: ${config.concurrency}. Concurrency must be greater than 0.`
      );
    }
    if (config.totalRequests <= 0) {
      throw new Error(
        `Invalid totalRequests: ${config.totalRequests}. Total requests must be greater than 0.`
      );
    }

    console.log(`\n🔄 Running benchmark: ${config.name}`);
    console.log(`   Concurrency: ${config.concurrency}`);
    console.log(`   Total Requests: ${config.totalRequests}`);

    const latencies: number[] = [];
    let successCount = 0;
    let failCount = 0;
    const startTime = Date.now();

    // Run requests in batches
    const batchSize = config.concurrency;
    const batches = Math.ceil(config.totalRequests / batchSize);

    for (let batch = 0; batch < batches; batch++) {
      const batchRequests = Math.min(
        batchSize,
        config.totalRequests - batch * batchSize
      );

      const promises = Array.from({ length: batchRequests }, async () => {
        const reqStart = Date.now();
        try {
          await config.operation();
          const latency = Date.now() - reqStart;
          latencies.push(latency);
          successCount++;
        } catch (error) {
          failCount++;
          console.error(`Request failed: ${error}`);
        }
      });

      await Promise.all(promises);

      // Progress indicator
      const progress = ((batch + 1) / batches) * 100;
      process.stdout.write(`\r   Progress: ${progress.toFixed(1)}%`);
    }

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000; // seconds

    // Calculate statistics
    latencies.sort((a, b) => a - b);
    const avgLatency =
      latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];
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

    // Check against SLA (P95 < 2000ms)
    if (result.p95Latency < 2000) {
      console.log(`   ✅ SLA Met: P95 < 2000ms`);
    } else {
      console.log(`   ❌ SLA Failed: P95 >= 2000ms`);
    }
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

// Mock operations for benchmarking
async function mockMemoryStore(): Promise<void> {
  // Simulate memory storage operation
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 50 + 10));
}

async function mockMemorySearch(): Promise<void> {
  // Simulate memory search operation
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 100 + 50));
}

async function mockHybridSearch(): Promise<void> {
  // Simulate hybrid search operation
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 200 + 100));
}

async function main() {
  console.log('🚀 Context Store MCP Performance Benchmark');
  console.log('='.repeat(80));

  const benchmark = new PerformanceBenchmark();

  // Benchmark 1: Memory Storage
  await benchmark.runBenchmark({
    name: 'Memory Storage',
    concurrency: 10,
    totalRequests: 100,
    operation: mockMemoryStore,
  });

  // Benchmark 2: Vector Search
  await benchmark.runBenchmark({
    name: 'Vector Search',
    concurrency: 20,
    totalRequests: 200,
    operation: mockMemorySearch,
  });

  // Benchmark 3: Hybrid Search
  await benchmark.runBenchmark({
    name: 'Hybrid Search',
    concurrency: 10,
    totalRequests: 100,
    operation: mockHybridSearch,
  });

  // Benchmark 4: High Concurrency
  await benchmark.runBenchmark({
    name: 'High Concurrency Test',
    concurrency: 100,
    totalRequests: 1000,
    operation: mockMemorySearch,
  });

  // Print summary
  benchmark.printSummary();

  console.log('\n✅ All benchmarks completed!');
  console.log(
    '\n💡 Note: These are mock benchmarks. For real performance testing,'
  );
  console.log('   integrate with actual MCP server endpoints.\n');
}

// Run benchmarks
main().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
