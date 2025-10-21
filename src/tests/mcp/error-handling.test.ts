/**
 * MCP Error Handling and SLA Compliance Tests
 * タスク 2.2: 包括的なエラーハンドリングとSLA準拠のレスポンス処理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpError, ErrorCode } from '../../mcp/errors';
import { TimeoutController } from '../../mcp/timeout-controller';
import { RateLimiter } from '../../mcp/rate-limiter';
import { CircuitBreaker, CircuitState } from '../../mcp/circuit-breaker';
import { PerformanceMetrics } from '../../mcp/performance-metrics';

describe('MCP Error Handling', () => {
  describe('McpError - MCP標準エラーコード', () => {
    it('should create an error with INVALID_PARAMS code', () => {
      const error = new McpError(ErrorCode.INVALID_PARAMS, 'Missing required parameter: content');

      expect(error.code).toBe(ErrorCode.INVALID_PARAMS);
      expect(error.message).toBe('Missing required parameter: content');
      expect(error.name).toBe('McpError');
    });

    it('should create an error with INTERNAL_ERROR code', () => {
      const error = new McpError(ErrorCode.INTERNAL_ERROR, 'Database connection failed');

      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(error.message).toBe('Database connection failed');
    });

    it('should create an error with METHOD_NOT_FOUND code', () => {
      const error = new McpError(ErrorCode.METHOD_NOT_FOUND, 'Unknown tool: unknown_tool');

      expect(error.code).toBe(ErrorCode.METHOD_NOT_FOUND);
      expect(error.message).toBe('Unknown tool: unknown_tool');
    });

    it('should include additional data in error', () => {
      const error = new McpError(ErrorCode.INVALID_PARAMS, 'Validation failed', {
        field: 'content',
        reason: 'Too long',
      });

      expect(error.data).toEqual({ field: 'content', reason: 'Too long' });
    });
  });

  describe('TimeoutController - タイムアウト制御', () => {
    let timeoutController: TimeoutController;

    beforeEach(() => {
      timeoutController = new TimeoutController({
        defaultTimeout: 1000, // 1秒
      });
    });

    it('should execute operation within timeout', async () => {
      const operation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'success';
      };

      const result = await timeoutController.execute(operation);
      expect(result).toBe('success');
    });

    it('should throw timeout error when operation exceeds timeout', async () => {
      const operation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return 'success';
      };

      await expect(timeoutController.execute(operation)).rejects.toThrow('Operation timeout');
    });

    it('should allow custom timeout per operation', async () => {
      const operation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return 'success';
      };

      const result = await timeoutController.execute(operation, 2000);
      expect(result).toBe('success');
    });

    it('should cleanup timeout on successful completion', async () => {
      const operation = async () => 'success';

      await timeoutController.execute(operation);

      // タイムアウトがクリーンアップされていることを確認
      expect(timeoutController.getActiveTimeouts()).toBe(0);
    });
  });

  describe('RateLimiter - レート制限', () => {
    let rateLimiter: RateLimiter;

    beforeEach(() => {
      rateLimiter = new RateLimiter({
        maxRequests: 10,
        windowMs: 1000, // 1秒
      });
    });

    afterEach(() => {
      vi.clearAllTimers();
    });

    it('should allow requests within rate limit', async () => {
      const clientId = 'client1';

      for (let i = 0; i < 10; i++) {
        const allowed = await rateLimiter.checkLimit(clientId);
        expect(allowed).toBe(true);
      }
    });

    it('should block requests exceeding rate limit', async () => {
      const clientId = 'client1';

      // 制限まで実行
      for (let i = 0; i < 10; i++) {
        await rateLimiter.checkLimit(clientId);
      }

      // 11回目は拒否される
      const allowed = await rateLimiter.checkLimit(clientId);
      expect(allowed).toBe(false);
    });

    it('should reset limit after window expires', async () => {
      vi.useFakeTimers();
      const clientId = 'client1';

      // 制限まで実行
      for (let i = 0; i < 10; i++) {
        await rateLimiter.checkLimit(clientId);
      }

      // ウィンドウ期間が経過
      vi.advanceTimersByTime(1100);

      // 再度実行可能
      const allowed = await rateLimiter.checkLimit(clientId);
      expect(allowed).toBe(true);

      vi.useRealTimers();
    });

    it('should track different clients independently', async () => {
      const client1 = 'client1';
      const client2 = 'client2';

      // client1の制限まで実行
      for (let i = 0; i < 10; i++) {
        await rateLimiter.checkLimit(client1);
      }

      // client1は拒否される
      expect(await rateLimiter.checkLimit(client1)).toBe(false);

      // client2は実行可能
      expect(await rateLimiter.checkLimit(client2)).toBe(true);
    });

    it('should return remaining requests count', async () => {
      const clientId = 'client1';

      await rateLimiter.checkLimit(clientId);
      const remaining = rateLimiter.getRemaining(clientId);

      expect(remaining).toBe(9);
    });
  });

  describe('CircuitBreaker - サーキットブレーカーパターン', () => {
    let circuitBreaker: CircuitBreaker;
    let mockOperation: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      circuitBreaker = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 1000,
        windowSize: 10,
        failureRateThreshold: 0.5,
      });

      mockOperation = vi.fn();
    });

    it('should start in CLOSED state', () => {
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should execute operation in CLOSED state', async () => {
      mockOperation.mockResolvedValue('success');

      const result = await circuitBreaker.execute(mockOperation);

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should transition to OPEN after threshold failures', async () => {
      mockOperation.mockRejectedValue(new Error('Service unavailable'));

      // 5回失敗させる
      for (let i = 0; i < 5; i++) {
        await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow();
      }

      // 状態がOPENに遷移
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should reject immediately in OPEN state', async () => {
      mockOperation.mockRejectedValue(new Error('Service unavailable'));

      // 失敗させてOPEN状態に遷移
      for (let i = 0; i < 5; i++) {
        await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow();
      }

      // OPEN状態では即座に拒否
      mockOperation.mockClear();
      await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow(
        'Circuit breaker is OPEN'
      );
      expect(mockOperation).not.toHaveBeenCalled();
    });

    it('should transition to HALF_OPEN after timeout', async () => {
      vi.useFakeTimers();
      mockOperation.mockRejectedValue(new Error('Service unavailable'));

      // OPEN状態に遷移
      for (let i = 0; i < 5; i++) {
        await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow();
      }

      // タイムアウト期間経過
      vi.advanceTimersByTime(1100);

      // 状態がHALF_OPENに遷移
      expect(circuitBreaker.getState()).toBe(CircuitState.HALF_OPEN);

      vi.useRealTimers();
    });

    it('should transition to CLOSED after success threshold in HALF_OPEN', async () => {
      vi.useFakeTimers();

      // 失敗用のモックを作成
      const failingOperation = vi.fn().mockRejectedValue(new Error('Fail'));
      const successOperation = vi.fn().mockResolvedValue('success');

      // OPEN状態に遷移（5回失敗）
      for (let i = 0; i < 5; i++) {
        await expect(circuitBreaker.execute(failingOperation)).rejects.toThrow();
      }

      // HALF_OPENに遷移
      vi.advanceTimersByTime(1100);

      // 2回成功させる
      await circuitBreaker.execute(successOperation);
      await circuitBreaker.execute(successOperation);

      // CLOSED状態に復帰
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);

      vi.useRealTimers();
    });

    it('should calculate failure rate correctly', async () => {
      const successOp = vi.fn().mockResolvedValue('success');
      const failOp = vi.fn().mockRejectedValue(new Error('Fail'));

      // 5回実行（成功2回、失敗3回）
      await circuitBreaker.execute(successOp);
      await circuitBreaker.execute(successOp);
      await expect(circuitBreaker.execute(failOp)).rejects.toThrow();
      await expect(circuitBreaker.execute(failOp)).rejects.toThrow();
      await expect(circuitBreaker.execute(failOp)).rejects.toThrow();

      // 失敗率は60%（3/5）で閾値50%を超えているため、OPEN状態に遷移する
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    });
  });

  describe('PerformanceMetrics - パフォーマンスメトリクス記録', () => {
    let metrics: PerformanceMetrics;

    beforeEach(() => {
      metrics = new PerformanceMetrics();
    });

    it('should record operation latency', () => {
      metrics.recordLatency('store_memory', 150);
      metrics.recordLatency('store_memory', 200);
      metrics.recordLatency('store_memory', 100);

      const avg = metrics.getAverageLatency('store_memory');
      expect(avg).toBe(150); // (150 + 200 + 100) / 3
    });

    it('should record operation success', () => {
      metrics.recordSuccess('store_memory');
      metrics.recordSuccess('store_memory');

      const count = metrics.getSuccessCount('store_memory');
      expect(count).toBe(2);
    });

    it('should record operation error', () => {
      metrics.recordError('store_memory', new Error('Database error'));
      metrics.recordError('store_memory', new Error('Timeout'));

      const count = metrics.getErrorCount('store_memory');
      expect(count).toBe(2);
    });

    it('should calculate error rate', () => {
      metrics.recordSuccess('store_memory');
      metrics.recordSuccess('store_memory');
      metrics.recordSuccess('store_memory');
      metrics.recordError('store_memory', new Error('Error'));

      const errorRate = metrics.getErrorRate('store_memory');
      expect(errorRate).toBe(0.25); // 1 error / 4 total = 25%
    });

    it('should return P95 latency', () => {
      // 100個のサンプルを記録
      for (let i = 0; i < 100; i++) {
        metrics.recordLatency('store_memory', i * 10);
      }

      const p95 = metrics.getP95Latency('store_memory');
      // P95 = ceil(100 * 0.95) - 1 = 94番目（0-indexed）のインデックス = 940
      expect(p95).toBe(940);
    });

    it('should track throughput (requests per second)', () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      // 1秒間に10リクエスト
      for (let i = 0; i < 10; i++) {
        metrics.recordSuccess('store_memory');
      }

      vi.advanceTimersByTime(1000);

      const throughput = metrics.getThroughput('store_memory');
      expect(throughput).toBe(10); // 10 req/sec

      vi.useRealTimers();
    });

    it('should reset metrics for an operation', () => {
      metrics.recordSuccess('store_memory');
      metrics.recordLatency('store_memory', 100);
      metrics.recordError('store_memory', new Error('Error'));

      metrics.reset('store_memory');

      expect(metrics.getSuccessCount('store_memory')).toBe(0);
      expect(metrics.getErrorCount('store_memory')).toBe(0);
      expect(metrics.getAverageLatency('store_memory')).toBe(0);
    });

    it('should export all metrics as JSON', () => {
      metrics.recordSuccess('store_memory');
      metrics.recordLatency('store_memory', 150);
      metrics.recordError('search_memory', new Error('Not found'));

      const exported = metrics.exportMetrics();

      expect(exported).toHaveProperty('store_memory');
      expect(exported).toHaveProperty('search_memory');
      expect(exported.store_memory.successCount).toBe(1);
      expect(exported.search_memory.errorCount).toBe(1);
    });
  });

  describe('Integration - エラーハンドリング統合テスト', () => {
    it('should handle timeout with circuit breaker', async () => {
      const timeoutController = new TimeoutController({
        defaultTimeout: 500,
      });

      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 1000,
        windowSize: 10,
        failureRateThreshold: 0.5,
      });

      const slowOperation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return 'success';
      };

      const wrappedOperation = () => timeoutController.execute(slowOperation);

      // タイムアウトで3回失敗
      await expect(circuitBreaker.execute(wrappedOperation)).rejects.toThrow();
      await expect(circuitBreaker.execute(wrappedOperation)).rejects.toThrow();
      await expect(circuitBreaker.execute(wrappedOperation)).rejects.toThrow();

      // サーキットブレーカーがOPENに遷移
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should enforce rate limit before circuit breaker', async () => {
      const rateLimiter = new RateLimiter({
        maxRequests: 2,
        windowMs: 1000,
      });

      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 1000,
        windowSize: 10,
        failureRateThreshold: 0.5,
      });

      const clientId = 'client1';
      const operation = vi.fn().mockResolvedValue('success');

      // レート制限内の2リクエストは成功
      expect(await rateLimiter.checkLimit(clientId)).toBe(true);
      await circuitBreaker.execute(operation);

      expect(await rateLimiter.checkLimit(clientId)).toBe(true);
      await circuitBreaker.execute(operation);

      // 3回目はレート制限で拒否
      expect(await rateLimiter.checkLimit(clientId)).toBe(false);

      // サーキットブレーカーは実行されない
      expect(operation).toHaveBeenCalledTimes(2);
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should record metrics for all operations', async () => {
      const metrics = new PerformanceMetrics();
      const timeoutController = new TimeoutController({
        defaultTimeout: 1000,
      });

      const operation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'success';
      };

      const start = Date.now();
      const result = await timeoutController.execute(operation);
      const duration = Date.now() - start;

      metrics.recordSuccess('test_operation');
      metrics.recordLatency('test_operation', duration);

      expect(result).toBe('success');
      expect(metrics.getSuccessCount('test_operation')).toBe(1);
      expect(metrics.getAverageLatency('test_operation')).toBeGreaterThan(90);
      expect(metrics.getErrorRate('test_operation')).toBe(0);
    });
  });
});
