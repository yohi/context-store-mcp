import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { PerformanceMetrics } from '../../mcp/performance-metrics';

describe('PerformanceMetrics', () => {
  let metrics: PerformanceMetrics;

  beforeEach(() => {
    metrics = new PerformanceMetrics();
  });

  describe('recordLatency - Defensive Validation', () => {
    it('should ignore NaN latency values', () => {
      metrics.recordLatency('test-op', NaN);

      // Should not record the invalid value
      expect(metrics.getAverageLatency('test-op')).toBe(0);
      expect(metrics.getP50Latency('test-op')).toBe(0);
      expect(metrics.getP95Latency('test-op')).toBe(0);
      expect(metrics.getP99Latency('test-op')).toBe(0);
    });

    it('should ignore positive Infinity latency values', () => {
      metrics.recordLatency('test-op', Infinity);

      expect(metrics.getAverageLatency('test-op')).toBe(0);
      expect(metrics.getP50Latency('test-op')).toBe(0);
    });

    it('should ignore negative Infinity latency values', () => {
      metrics.recordLatency('test-op', -Infinity);

      expect(metrics.getAverageLatency('test-op')).toBe(0);
      expect(metrics.getP50Latency('test-op')).toBe(0);
    });

    it('should ignore negative latency values', () => {
      metrics.recordLatency('test-op', -100);
      metrics.recordLatency('test-op', -0.5);
      metrics.recordLatency('test-op', -1);

      expect(metrics.getAverageLatency('test-op')).toBe(0);
      expect(metrics.getP50Latency('test-op')).toBe(0);
    });

    it('should accept zero latency', () => {
      metrics.recordLatency('test-op', 0);

      expect(metrics.getAverageLatency('test-op')).toBe(0);
      expect(metrics.getP50Latency('test-op')).toBe(0);
    });

    it('should accept valid positive latency values', () => {
      metrics.recordLatency('test-op', 100);
      metrics.recordLatency('test-op', 200);
      metrics.recordLatency('test-op', 300);

      expect(metrics.getAverageLatency('test-op')).toBe(200);
      expect(metrics.getP50Latency('test-op')).toBe(200);
    });

    it('should not corrupt metrics when mixing valid and invalid values', () => {
      // Record some valid values
      metrics.recordLatency('test-op', 100);
      metrics.recordLatency('test-op', 200);

      // Try to record invalid values
      metrics.recordLatency('test-op', NaN);
      metrics.recordLatency('test-op', -50);
      metrics.recordLatency('test-op', Infinity);

      // Record more valid values
      metrics.recordLatency('test-op', 300);

      // Should only have the valid values
      expect(metrics.getAverageLatency('test-op')).toBe(200);
      expect(metrics.getP50Latency('test-op')).toBe(200);
      expect(metrics.getP95Latency('test-op')).toBeGreaterThan(0);
    });

    it('should handle very small positive values', () => {
      metrics.recordLatency('test-op', 0.001);
      metrics.recordLatency('test-op', 0.1);

      expect(metrics.getAverageLatency('test-op')).toBeCloseTo(0.0505, 3);
    });

    it('should handle very large positive values', () => {
      metrics.recordLatency('test-op', Number.MAX_SAFE_INTEGER);

      expect(metrics.getAverageLatency('test-op')).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('should ignore invalid values and maintain empty state', () => {
      metrics.recordLatency('test-op', NaN);
      metrics.recordLatency('test-op', -100);
      metrics.recordLatency('test-op', Infinity);

      // Metrics should still be empty
      const exported = metrics.exportMetrics();
      expect(exported['test-op']).toBeUndefined();
    });
  });

  describe('recordLatency - Array Trimming', () => {
    it('should trim old latencies when exceeding maxLatencies', () => {
      const smallMetrics = new PerformanceMetrics({ maxLatencies: 5 });

      // Record more than maxLatencies
      for (let i = 1; i <= 10; i++) {
        smallMetrics.recordLatency('test-op', i * 10);
      }

      // Average should only include the last 5 values: 60, 70, 80, 90, 100
      const avg = smallMetrics.getAverageLatency('test-op');
      expect(avg).toBe(80); // (60 + 70 + 80 + 90 + 100) / 5
    });

    it('should not trim when below maxLatencies', () => {
      const smallMetrics = new PerformanceMetrics({ maxLatencies: 100 });

      for (let i = 1; i <= 10; i++) {
        smallMetrics.recordLatency('test-op', i * 10);
      }

      const avg = smallMetrics.getAverageLatency('test-op');
      expect(avg).toBe(55); // (10 + 20 + ... + 100) / 10
    });
  });

  describe('getAverageLatency', () => {
    it('should return 0 for unknown operation', () => {
      expect(metrics.getAverageLatency('unknown')).toBe(0);
    });

    it('should return 0 for operation with no latencies', () => {
      metrics.recordSuccess('test-op');
      expect(metrics.getAverageLatency('test-op')).toBe(0);
    });

    it('should calculate correct average', () => {
      metrics.recordLatency('test-op', 100);
      metrics.recordLatency('test-op', 200);
      metrics.recordLatency('test-op', 300);

      expect(metrics.getAverageLatency('test-op')).toBe(200);
    });
  });

  describe('Percentile Latencies', () => {
    beforeEach(() => {
      // Record values: 10, 20, 30, ..., 100
      for (let i = 1; i <= 10; i++) {
        metrics.recordLatency('test-op', i * 10);
      }
    });

    it('should calculate P50 (median) correctly', () => {
      const p50 = metrics.getP50Latency('test-op');
      expect(p50).toBe(50);
    });

    it('should calculate P95 correctly', () => {
      const p95 = metrics.getP95Latency('test-op');
      expect(p95).toBe(100);
    });

    it('should calculate P99 correctly', () => {
      const p99 = metrics.getP99Latency('test-op');
      expect(p99).toBe(100);
    });

    it('should return 0 for unknown operation', () => {
      expect(metrics.getP50Latency('unknown')).toBe(0);
      expect(metrics.getP95Latency('unknown')).toBe(0);
      expect(metrics.getP99Latency('unknown')).toBe(0);
    });
  });

  describe('Success and Error Recording', () => {
    it('should record successes correctly', () => {
      metrics.recordSuccess('test-op');
      metrics.recordSuccess('test-op');
      metrics.recordSuccess('test-op');

      expect(metrics.getSuccessCount('test-op')).toBe(3);
      expect(metrics.getErrorCount('test-op')).toBe(0);
    });

    it('should record errors correctly', () => {
      metrics.recordError('test-op', new Error('test error 1'));
      metrics.recordError('test-op', new Error('test error 2'));

      expect(metrics.getSuccessCount('test-op')).toBe(0);
      expect(metrics.getErrorCount('test-op')).toBe(2);
    });

    it('should track error rate correctly', () => {
      metrics.recordSuccess('test-op');
      metrics.recordSuccess('test-op');
      metrics.recordError('test-op', new Error('test error'));

      const errorRate = metrics.getErrorRate('test-op');
      expect(errorRate).toBeCloseTo(1 / 3, 5);
    });

    it('should return 0 error rate when no operations', () => {
      expect(metrics.getErrorRate('test-op')).toBe(0);
    });

    it('should return 0 counts for unknown operation', () => {
      expect(metrics.getSuccessCount('unknown')).toBe(0);
      expect(metrics.getErrorCount('unknown')).toBe(0);
    });
  });

  describe('Throughput Calculation', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should calculate throughput correctly', () => {
      // Record 5 successes
      for (let i = 0; i < 5; i++) {
        metrics.recordSuccess('test-op');
      }

      // Throughput in 1 second window = 5 req/sec
      const throughput = metrics.getThroughput('test-op', 1000);
      expect(throughput).toBe(5);
    });

    it('should return 0 for unknown operation', () => {
      expect(metrics.getThroughput('unknown')).toBe(0);
    });

    it('should return 0 for invalid windowMs', () => {
      metrics.recordSuccess('test-op');

      expect(metrics.getThroughput('test-op', 0)).toBe(0);
      expect(metrics.getThroughput('test-op', -1000)).toBe(0);
      expect(metrics.getThroughput('test-op', NaN)).toBe(0);
      expect(metrics.getThroughput('test-op', Infinity)).toBe(0);
    });

    it('should filter out old timestamps', () => {
      // Record at t=0
      metrics.recordSuccess('test-op');
      metrics.recordSuccess('test-op');

      // Advance time by 2 seconds
      vi.advanceTimersByTime(2000);

      // Record more at t=2000
      metrics.recordSuccess('test-op');

      // With 1 second window, should only count the last request
      const throughput = metrics.getThroughput('test-op', 1000);
      expect(throughput).toBe(1);
    });
  });

  describe('peekThroughput - Non-destructive', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should calculate throughput without modifying timestamps', () => {
      metrics.recordSuccess('test-op');
      metrics.recordSuccess('test-op');

      const throughput1 = metrics.peekThroughput('test-op', 1000);
      const throughput2 = metrics.peekThroughput('test-op', 1000);

      expect(throughput1).toBe(2);
      expect(throughput2).toBe(2); // Should be the same
    });

    it('should return 0 for invalid windowMs', () => {
      metrics.recordSuccess('test-op');

      expect(metrics.peekThroughput('test-op', 0)).toBe(0);
      expect(metrics.peekThroughput('test-op', -1000)).toBe(0);
      expect(metrics.peekThroughput('test-op', NaN)).toBe(0);
    });
  });

  describe('Reset Operations', () => {
    beforeEach(() => {
      metrics.recordLatency('op1', 100);
      metrics.recordLatency('op2', 200);
      metrics.recordSuccess('op1');
      metrics.recordSuccess('op2');
    });

    it('should reset specific operation', () => {
      metrics.reset('op1');

      expect(metrics.getAverageLatency('op1')).toBe(0);
      expect(metrics.getSuccessCount('op1')).toBe(0);

      // op2 should remain
      expect(metrics.getAverageLatency('op2')).toBe(200);
      expect(metrics.getSuccessCount('op2')).toBe(1);
    });

    it('should reset all operations', () => {
      metrics.resetAll();

      expect(metrics.getAverageLatency('op1')).toBe(0);
      expect(metrics.getAverageLatency('op2')).toBe(0);
      expect(metrics.getSuccessCount('op1')).toBe(0);
      expect(metrics.getSuccessCount('op2')).toBe(0);
    });
  });

  describe('Export Metrics', () => {
    it('should export all metrics correctly', () => {
      metrics.recordLatency('test-op', 100);
      metrics.recordLatency('test-op', 200);
      metrics.recordLatency('test-op', 300);
      metrics.recordSuccess('test-op');
      metrics.recordSuccess('test-op');
      metrics.recordError('test-op', new Error('test'));

      const exported = metrics.exportMetrics();

      expect(exported['test-op']).toBeDefined();
      expect(exported['test-op'].successCount).toBe(2);
      expect(exported['test-op'].errorCount).toBe(1);
      expect(exported['test-op'].totalCount).toBe(3);
      expect(exported['test-op'].averageLatency).toBe(200);
      expect(exported['test-op'].p50Latency).toBe(200);
      expect(exported['test-op'].errorRate).toBeCloseTo(1 / 3, 5);
      expect(exported['test-op'].lastUpdated).toBeGreaterThan(0);
    });

    it('should return empty object when no operations recorded', () => {
      const exported = metrics.exportMetrics();
      expect(exported).toEqual({});
    });
  });

  describe('Error Trimming', () => {
    it('should trim old errors when exceeding maxErrors', () => {
      const smallMetrics = new PerformanceMetrics({ maxErrors: 3 });

      // Record more than maxErrors
      for (let i = 1; i <= 5; i++) {
        smallMetrics.recordError('test-op', new Error(`error ${i}`));
      }

      // Should only keep the last 3 errors
      expect(smallMetrics.getErrorCount('test-op')).toBe(5); // Count is cumulative
    });
  });

  describe('Configuration', () => {
    it('should use custom maxLatencies', () => {
      const customMetrics = new PerformanceMetrics({ maxLatencies: 3 });

      for (let i = 1; i <= 5; i++) {
        customMetrics.recordLatency('test-op', i * 10);
      }

      // Should only keep last 3: 30, 40, 50
      const avg = customMetrics.getAverageLatency('test-op');
      expect(avg).toBe(40); // (30 + 40 + 50) / 3
    });

    it('should use default values when not specified', () => {
      const defaultMetrics = new PerformanceMetrics();

      // Record many latencies (more than default max)
      for (let i = 1; i <= 1100; i++) {
        defaultMetrics.recordLatency('test-op', i);
      }

      // Should trim to DEFAULT_MAX_LATENCIES (1000)
      // Average of 101 to 1100 = 600.5
      const avg = defaultMetrics.getAverageLatency('test-op');
      expect(avg).toBe(600.5);
    });
  });
});
