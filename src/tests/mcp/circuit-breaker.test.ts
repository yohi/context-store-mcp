import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { CircuitBreaker, CircuitBreakerConfig, CircuitState } from '../../mcp/circuit-breaker';
import { ServiceUnavailableError } from '../../mcp/errors';

describe('CircuitBreaker', () => {
  describe('Configuration Validation', () => {
    describe('Required Fields', () => {
      it('should throw error when failureThreshold is missing', () => {
        expect(() => {
          new CircuitBreaker({
            successThreshold: 2,
            timeout: 1000,
            windowSize: 10,
            failureRateThreshold: 0.5,
          } as any);
        }).toThrow('failureThreshold is required');
      });

      it('should throw error when successThreshold is missing', () => {
        expect(() => {
          new CircuitBreaker({
            failureThreshold: 5,
            timeout: 1000,
            windowSize: 10,
            failureRateThreshold: 0.5,
          } as any);
        }).toThrow('successThreshold is required');
      });

      it('should throw error when timeout is missing', () => {
        expect(() => {
          new CircuitBreaker({
            failureThreshold: 5,
            successThreshold: 2,
            windowSize: 10,
            failureRateThreshold: 0.5,
          } as any);
        }).toThrow('timeout is required');
      });

      it('should throw error when windowSize is missing', () => {
        expect(() => {
          new CircuitBreaker({
            failureThreshold: 5,
            successThreshold: 2,
            timeout: 1000,
            failureRateThreshold: 0.5,
          } as any);
        }).toThrow('windowSize is required');
      });

      it('should throw error when failureRateThreshold is missing', () => {
        expect(() => {
          new CircuitBreaker({
            failureThreshold: 5,
            successThreshold: 2,
            timeout: 1000,
            windowSize: 10,
          } as any);
        }).toThrow('failureRateThreshold is required');
      });
    });

    describe('Type Validation', () => {
      const baseConfig = {
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 1000,
        windowSize: 10,
        failureRateThreshold: 0.5,
      };

      it('should throw TypeError when failureThreshold is not a number', () => {
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            failureThreshold: '5' as any,
          });
        }).toThrow(TypeError);
      });

      it('should throw TypeError when successThreshold is not a number', () => {
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            successThreshold: '2' as any,
          });
        }).toThrow(TypeError);
      });

      it('should throw TypeError when timeout is not a number', () => {
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            timeout: '1000' as any,
          });
        }).toThrow(TypeError);
      });

      it('should throw TypeError when windowSize is not a number', () => {
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            windowSize: '10' as any,
          });
        }).toThrow(TypeError);
      });

      it('should throw TypeError when failureRateThreshold is not a number', () => {
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            failureRateThreshold: '0.5' as any,
          });
        }).toThrow(TypeError);
      });
    });

    describe('Range Validation - Negative Values', () => {
      const baseConfig: CircuitBreakerConfig = {
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 1000,
        windowSize: 10,
        failureRateThreshold: 0.5,
      };

      it('should throw RangeError when failureThreshold is negative', () => {
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            failureThreshold: -1,
          });
        }).toThrow(RangeError);
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            failureThreshold: -1,
          });
        }).toThrow('failureThreshold must be non-negative');
      });

      it('should throw RangeError when successThreshold is negative', () => {
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            successThreshold: -1,
          });
        }).toThrow(RangeError);
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            successThreshold: -1,
          });
        }).toThrow('successThreshold must be non-negative');
      });

      it('should throw RangeError when timeout is zero or negative', () => {
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            timeout: 0,
          });
        }).toThrow(RangeError);
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            timeout: -1000,
          });
        }).toThrow('timeout must be positive');
      });

      it('should throw RangeError when windowSize is zero or negative', () => {
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            windowSize: 0,
          });
        }).toThrow(RangeError);
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            windowSize: -10,
          });
        }).toThrow('windowSize must be positive');
      });
    });

    describe('Percentage Range Validation', () => {
      const baseConfig: CircuitBreakerConfig = {
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 1000,
        windowSize: 10,
        failureRateThreshold: 0.5,
      };

      it('should throw RangeError when failureRateThreshold is negative', () => {
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            failureRateThreshold: -0.1,
          });
        }).toThrow(RangeError);
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            failureRateThreshold: -0.1,
          });
        }).toThrow('failureRateThreshold must be between 0.0 and 1.0');
      });

      it('should throw RangeError when failureRateThreshold is greater than 1', () => {
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            failureRateThreshold: 1.1,
          });
        }).toThrow(RangeError);
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            failureRateThreshold: 2.0,
          });
        }).toThrow('failureRateThreshold must be between 0.0 and 1.0');
      });

      it('should accept failureRateThreshold of 0.0', () => {
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            failureRateThreshold: 0.0,
          });
        }).not.toThrow();
      });

      it('should accept failureRateThreshold of 1.0', () => {
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            failureRateThreshold: 1.0,
          });
        }).not.toThrow();
      });
    });

    describe('Finite Number Validation', () => {
      const baseConfig: CircuitBreakerConfig = {
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 1000,
        windowSize: 10,
        failureRateThreshold: 0.5,
      };

      it('should throw RangeError when failureThreshold is Infinity', () => {
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            failureThreshold: Infinity,
          });
        }).toThrow(RangeError);
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            failureThreshold: Infinity,
          });
        }).toThrow('failureThreshold must be a finite number');
      });

      it('should throw RangeError when failureThreshold is NaN', () => {
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            failureThreshold: NaN,
          });
        }).toThrow(RangeError);
      });

      it('should throw RangeError when timeout is Infinity', () => {
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            timeout: Infinity,
          });
        }).toThrow(RangeError);
      });

      it('should throw RangeError when failureRateThreshold is NaN', () => {
        expect(() => {
          new CircuitBreaker({
            ...baseConfig,
            failureRateThreshold: NaN,
          });
        }).toThrow(RangeError);
      });
    });

    describe('Logical Validation', () => {
      it('should throw error when both thresholds are zero', () => {
        expect(() => {
          new CircuitBreaker({
            failureThreshold: 0,
            successThreshold: 2,
            timeout: 1000,
            windowSize: 10,
            failureRateThreshold: 0,
          });
        }).toThrow(
          'At least one threshold (failureThreshold or failureRateThreshold) must be positive'
        );
      });

      it('should accept when only failureThreshold is positive', () => {
        expect(() => {
          new CircuitBreaker({
            failureThreshold: 5,
            successThreshold: 2,
            timeout: 1000,
            windowSize: 10,
            failureRateThreshold: 0,
          });
        }).not.toThrow();
      });

      it('should accept when only failureRateThreshold is positive', () => {
        expect(() => {
          new CircuitBreaker({
            failureThreshold: 0,
            successThreshold: 2,
            timeout: 1000,
            windowSize: 10,
            failureRateThreshold: 0.5,
          });
        }).not.toThrow();
      });
    });

    describe('Config Immutability', () => {
      it('should prevent external mutation of config', () => {
        const config: CircuitBreakerConfig = {
          failureThreshold: 5,
          successThreshold: 2,
          timeout: 1000,
          windowSize: 10,
          failureRateThreshold: 0.5,
        };

        const breaker = new CircuitBreaker(config);

        // Try to mutate the original config
        config.failureThreshold = 100;

        // The breaker should still have the original value
        expect(breaker.getState()).toBe(CircuitState.CLOSED);

        // Try to access the internal config (should fail at compile time, but test runtime)
        const internalConfig = (breaker as any).config;
        expect(() => {
          internalConfig.failureThreshold = 200;
        }).toThrow();
      });

      it('should create independent frozen copy of config', () => {
        const config: CircuitBreakerConfig = {
          failureThreshold: 5,
          successThreshold: 2,
          timeout: 1000,
          windowSize: 10,
          failureRateThreshold: 0.5,
        };

        const breaker = new CircuitBreaker(config);
        const internalConfig = (breaker as any).config;

        // Verify the config is frozen
        expect(Object.isFrozen(internalConfig)).toBe(true);

        // Verify it's a different object
        expect(internalConfig).not.toBe(config);
      });
    });
  });

  describe('Circuit Breaker Functionality', () => {
    let config: CircuitBreakerConfig;

    beforeEach(() => {
      config = {
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 100,
        windowSize: 10,
        failureRateThreshold: 0.5,
      };
    });

    it('should start in CLOSED state', () => {
      const breaker = new CircuitBreaker(config);
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should execute operation successfully in CLOSED state', async () => {
      const breaker = new CircuitBreaker(config);
      const operation = vi.fn().mockResolvedValue('success');

      const result = await breaker.execute(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should transition to OPEN after consecutive failures', async () => {
      const breaker = new CircuitBreaker(config);
      const operation = vi.fn().mockRejectedValue(new Error('fail'));

      // Trigger failures up to threshold
      for (let i = 0; i < config.failureThreshold; i++) {
        try {
          await breaker.execute(operation);
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should reject operations immediately in OPEN state', async () => {
      const breaker = new CircuitBreaker(config);
      const failOp = vi.fn().mockRejectedValue(new Error('fail'));

      // Trigger failures to open circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        try {
          await breaker.execute(failOp);
        } catch {
          // Expected
        }
      }

      const successOp = vi.fn().mockResolvedValue('success');

      // Should reject without calling operation
      await expect(breaker.execute(successOp)).rejects.toThrow(ServiceUnavailableError);
      expect(successOp).not.toHaveBeenCalled();
    });

    it('should transition to HALF_OPEN after timeout', async () => {
      vi.useFakeTimers();

      const breaker = new CircuitBreaker(config);
      const failOp = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        try {
          await breaker.execute(failOp);
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);

      // Wait for timeout
      vi.advanceTimersByTime(config.timeout);
      await Promise.resolve(); // Let timers resolve

      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      vi.useRealTimers();
      breaker.destroy();
    });

    it('should transition to CLOSED after successful operations in HALF_OPEN', async () => {
      vi.useFakeTimers();

      const breaker = new CircuitBreaker(config);
      const failOp = vi.fn().mockRejectedValue(new Error('fail'));
      const successOp = vi.fn().mockResolvedValue('success');

      // Open the circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        try {
          await breaker.execute(failOp);
        } catch {
          // Expected
        }
      }

      // Wait for timeout to enter HALF_OPEN
      vi.advanceTimersByTime(config.timeout);
      await Promise.resolve();

      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      // Succeed enough times
      for (let i = 0; i < config.successThreshold; i++) {
        await breaker.execute(successOp);
      }

      expect(breaker.getState()).toBe(CircuitState.CLOSED);

      vi.useRealTimers();
      breaker.destroy();
    });

    it('should reset counters and state', async () => {
      const breaker = new CircuitBreaker(config);
      const failOp = vi.fn().mockRejectedValue(new Error('fail'));

      // Trigger some failures
      for (let i = 0; i < config.failureThreshold; i++) {
        try {
          await breaker.execute(failOp);
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);

      breaker.reset();

      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      expect(breaker.getNextAttemptTime()).toBeNull();
    });

    it('should clean up timers on destroy', () => {
      vi.useFakeTimers();

      const breaker = new CircuitBreaker(config);
      breaker.destroy();

      // Should not throw or cause issues
      expect(() => {
        vi.advanceTimersByTime(config.timeout * 2);
      }).not.toThrow();

      vi.useRealTimers();
    });
  });

  describe('HALF_OPEN Probe Concurrency Control', () => {
    let config: CircuitBreakerConfig;

    beforeEach(() => {
      vi.useFakeTimers();
      config = {
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 100,
        windowSize: 10,
        failureRateThreshold: 0.5,
      };
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should allow single probe in HALF_OPEN state', async () => {
      const breaker = new CircuitBreaker(config);
      const failOp = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        try {
          await breaker.execute(failOp);
        } catch {
          // Expected
        }
      }

      // Wait for timeout to enter HALF_OPEN
      vi.advanceTimersByTime(config.timeout);
      await Promise.resolve();

      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      // First probe should succeed
      const successOp = vi.fn().mockResolvedValue('success');
      const probePromise = breaker.execute(successOp);

      // Should accept the first probe
      await expect(probePromise).resolves.toBe('success');

      breaker.destroy();
    });

    it('should reject concurrent probes in HALF_OPEN state', async () => {
      const breaker = new CircuitBreaker(config);
      const failOp = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        try {
          await breaker.execute(failOp);
        } catch {
          // Expected
        }
      }

      // Wait for timeout to enter HALF_OPEN
      vi.advanceTimersByTime(config.timeout);
      await Promise.resolve();

      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      // Create a slow operation to keep the probe in flight
      const slowOp = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve('success'), 100);
          })
      );

      // Start first probe
      const firstProbe = breaker.execute(slowOp);

      // Try to start second probe while first is in flight
      await expect(breaker.execute(vi.fn())).rejects.toThrow(ServiceUnavailableError);
      await expect(breaker.execute(vi.fn())).rejects.toThrow(
        'Circuit breaker is HALF_OPEN (probe in flight)'
      );

      // Complete first probe
      vi.advanceTimersByTime(100);
      await firstProbe;

      breaker.destroy();
    });

    it('should reset probe flag after successful operation', async () => {
      const breaker = new CircuitBreaker(config);
      const failOp = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        try {
          await breaker.execute(failOp);
        } catch {
          // Expected
        }
      }

      // Wait for timeout to enter HALF_OPEN
      vi.advanceTimersByTime(config.timeout);
      await Promise.resolve();

      const successOp = vi.fn().mockResolvedValue('success');

      // Execute first probe (should succeed)
      await breaker.execute(successOp);

      // Execute second probe (should succeed because first completed)
      await breaker.execute(successOp);

      expect(successOp).toHaveBeenCalledTimes(2);

      breaker.destroy();
    });

    it('should reset probe flag after failed operation', async () => {
      const breaker = new CircuitBreaker(config);
      const failOp = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        try {
          await breaker.execute(failOp);
        } catch {
          // Expected
        }
      }

      // Wait for timeout to enter HALF_OPEN
      vi.advanceTimersByTime(config.timeout);
      await Promise.resolve();

      // Execute probe that fails (should return to OPEN)
      try {
        await breaker.execute(failOp);
      } catch {
        // Expected
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);

      breaker.destroy();
    });

    it('should reset probe flag on reset', async () => {
      const breaker = new CircuitBreaker(config);
      const failOp = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        try {
          await breaker.execute(failOp);
        } catch {
          // Expected
        }
      }

      // Wait for timeout to enter HALF_OPEN
      vi.advanceTimersByTime(config.timeout);
      await Promise.resolve();

      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      // Reset should clear probe flag
      breaker.reset();

      expect(breaker.getState()).toBe(CircuitState.CLOSED);

      // Should be able to execute normally
      const successOp = vi.fn().mockResolvedValue('success');
      await expect(breaker.execute(successOp)).resolves.toBe('success');

      breaker.destroy();
    });

    it('should reset probe flag when transitioning to CLOSED', async () => {
      const breaker = new CircuitBreaker(config);
      const failOp = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      for (let i = 0; i < config.failureThreshold; i++) {
        try {
          await breaker.execute(failOp);
        } catch {
          // Expected
        }
      }

      // Wait for timeout to enter HALF_OPEN
      vi.advanceTimersByTime(config.timeout);
      await Promise.resolve();

      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      // Succeed enough times to return to CLOSED
      const successOp = vi.fn().mockResolvedValue('success');
      for (let i = 0; i < config.successThreshold; i++) {
        await breaker.execute(successOp);
      }

      expect(breaker.getState()).toBe(CircuitState.CLOSED);

      // Should be able to execute concurrently now
      await Promise.all([
        breaker.execute(successOp),
        breaker.execute(successOp),
        breaker.execute(successOp),
      ]);

      expect(successOp).toHaveBeenCalledTimes(config.successThreshold + 3);

      breaker.destroy();
    });
  });
});
