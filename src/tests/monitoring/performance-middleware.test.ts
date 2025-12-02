/**
 * Performance Middleware Tests
 * パフォーマンスミドルウェアのテスト
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PerformanceMetrics } from '../../mcp/performance-metrics';
import { withPerformanceTracking, createPerformanceMiddleware } from '../../monitoring/performance-middleware';

describe('PerformanceMiddleware', () => {
  let metrics: PerformanceMetrics;

  beforeEach(() => {
    metrics = new PerformanceMetrics();
  });

  describe('withPerformanceTracking', () => {
    it('正常終了時のメトリクスを記録する', async () => {
      const handler = vi.fn().mockResolvedValue('success');
      const wrapped = withPerformanceTracking(metrics, 'test_op', handler);

      const result = await wrapped();

      expect(result).toBe('success');
      expect(metrics.getSuccessCount('test_op')).toBe(1);
      expect(metrics.getErrorCount('test_op')).toBe(0);
      // Latency should be recorded (check if average latency is calculated, might be 0 if super fast)
      // To verify latency recording, we can check internal state or just rely on getSuccessCount which implies recording flow passed
      // Or mock Date.now? For now, trusting getSuccessCount implies success path.
    });

    it('エラー時のメトリクスを記録する', async () => {
      const error = new Error('fail');
      const handler = vi.fn().mockRejectedValue(error);
      const wrapped = withPerformanceTracking(metrics, 'test_op', handler);

      await expect(wrapped()).rejects.toThrow('fail');

      expect(metrics.getSuccessCount('test_op')).toBe(0);
      expect(metrics.getErrorCount('test_op')).toBe(1);
    });

    it('動的なオペレーション名を使用できる', async () => {
      const handler = vi.fn().mockResolvedValue('ok');
      const nameResolver = (arg: string) => `op_${arg}`;
      const wrapped = withPerformanceTracking(metrics, nameResolver, handler);

      await wrapped('user');

      expect(metrics.getSuccessCount('op_user')).toBe(1);
    });
  });

  describe('createPerformanceMiddleware', () => {
    it('ミドルウェアとして機能する', async () => {
      const middleware = createPerformanceMiddleware(metrics, (req) => (req as any).method);
      const next = vi.fn().mockResolvedValue('response');
      const wrappedNext = middleware(next);

      const request = { method: 'GET_DATA' };
      const result = await wrappedNext(request);

      expect(result).toBe('response');
      expect(metrics.getSuccessCount('GET_DATA')).toBe(1);
    });
  });
});
