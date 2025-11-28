#!/usr/bin/env tsx

/**
 * パフォーマンスベンチマークスクリプト
 * 様々な負荷条件下でのシステムパフォーマンスをテストします
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
    // 無限ループと無効な統計を防ぐための入力検証
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

    // リクエストをバッチで実行
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

      // 進捗インジケーター
      const progress = ((batch + 1) / batches) * 100;
      process.stdout.write(`\r   Progress: ${progress.toFixed(1)}%`);
    }

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000; // seconds

    // 統計の計算
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

    // SLAチェック (P95 < 2000ms)
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

// ベンチマーク用のモック操作
async function mockMemoryStore(): Promise<void> {
  // 記憶保存操作をシミュレート
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 50 + 10));
}

async function mockMemorySearch(): Promise<void> {
  // 記憶検索操作をシミュレート
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 100 + 50));
}

async function mockHybridSearch(): Promise<void> {
  // ハイブリッド検索操作をシミュレート
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 200 + 100));
}

async function main() {
  console.log('🚀 Context Store MCP Performance Benchmark');
  console.log('='.repeat(80));

  const benchmark = new PerformanceBenchmark();

  // ベンチマーク 1: 記憶保存
  await benchmark.runBenchmark({
    name: 'Memory Storage',
    concurrency: 10,
    totalRequests: 100,
    operation: mockMemoryStore,
  });

  // ベンチマーク 2: ベクトル検索
  await benchmark.runBenchmark({
    name: 'Vector Search',
    concurrency: 20,
    totalRequests: 200,
    operation: mockMemorySearch,
  });

  // ベンチマーク 3: ハイブリッド検索
  await benchmark.runBenchmark({
    name: 'Hybrid Search',
    concurrency: 10,
    totalRequests: 100,
    operation: mockHybridSearch,
  });

  // ベンチマーク 4: 高並行性テスト
  await benchmark.runBenchmark({
    name: 'High Concurrency Test',
    concurrency: 100,
    totalRequests: 1000,
    operation: mockMemorySearch,
  });

  // サマリーの表示
  benchmark.printSummary();

  console.log('\n✅ All benchmarks completed!');
  console.log(
    '\n💡 Note: These are mock benchmarks. For real performance testing,'
  );
  console.log('   integrate with actual MCP server endpoints.\n');
}

// ベンチマークの実行
main().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
