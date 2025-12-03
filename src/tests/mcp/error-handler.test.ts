/**
 * ErrorHandlerのテスト
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ErrorHandler,
  Neo4jConnectionError,
  RedisConnectionError,
  EmbeddingServiceError,
  ErrorCategory,
} from '../../mcp/error-handler.js';

describe('ErrorHandler', () => {
  let errorHandler: ErrorHandler;
  let mockLogger: {
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockLogger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    };
    errorHandler = new ErrorHandler(mockLogger as any);
  });

  describe('Error Categorization', () => {
    it('should categorize Neo4j connection errors as recoverable', () => {
      const error = new Neo4jConnectionError('Failed to connect to Neo4j');
      const context = { operation: 'test', component: 'test' };

      const response = errorHandler.handleError(error, context);

      expect(response.success).toBe(false);
      expect(response.degraded).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Recoverable error, degrading functionality',
        expect.objectContaining({
          error: 'Failed to connect to Neo4j',
        })
      );
    });

    it('should categorize Redis connection errors as recoverable', () => {
      const error = new RedisConnectionError('Failed to connect to Redis');
      const context = { operation: 'test', component: 'test' };

      const response = errorHandler.handleError(error, context);

      expect(response.success).toBe(false);
      expect(response.degraded).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Recoverable error, degrading functionality',
        expect.objectContaining({
          error: 'Failed to connect to Redis',
        })
      );
    });

    it('should categorize embedding service errors as recoverable', () => {
      const error = new EmbeddingServiceError('Embedding service unavailable');
      const context = { operation: 'test', component: 'test' };

      const response = errorHandler.handleError(error, context);

      expect(response.success).toBe(false);
      expect(response.degraded).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Recoverable error, degrading functionality',
        expect.objectContaining({
          error: 'Embedding service unavailable',
        })
      );
    });

    it('should categorize timeout errors as retryable', () => {
      const error = new Error('ETIMEDOUT: connection timeout');
      const context = { operation: 'test', component: 'test' };

      const response = errorHandler.handleError(error, context);

      expect(response.success).toBe(false);
      expect(response.retryable).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Retryable error, scheduling retry',
        expect.objectContaining({
          error: 'ETIMEDOUT: connection timeout',
        })
      );
    });

    it('should categorize rate limit errors as retryable', () => {
      const error = new Error('Rate limit exceeded: 429');
      const context = { operation: 'test', component: 'test' };

      const response = errorHandler.handleError(error, context);

      expect(response.success).toBe(false);
      expect(response.retryable).toBe(true);
    });

    it('should categorize unknown errors appropriately', () => {
      const error = new Error('Some random error');
      const context = { operation: 'test', component: 'test' };

      const response = errorHandler.handleError(error, context);

      expect(response.success).toBe(false);
      expect(response.degraded).toBeUndefined();
      expect(response.retryable).toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unexpected error',
        expect.objectContaining({
          error: 'Some random error',
        })
      );
    });
  });

  describe('Graceful Degradation', () => {
    it('should disable graph store on Neo4j error', () => {
      const error = new Neo4jConnectionError('Neo4j unavailable');
      const context = { operation: 'test', component: 'test' };

      expect(errorHandler.isFeatureAvailable('graphStore')).toBe(true);

      errorHandler.handleError(error, context);

      expect(errorHandler.isFeatureAvailable('graphStore')).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Graph store disabled due to Neo4j connection failure',
        expect.objectContaining({
          feature: 'graph-relationships',
        })
      );
    });

    it('should switch to in-memory cache on Redis error', () => {
      const error = new RedisConnectionError('Redis unavailable');
      const context = { operation: 'test', component: 'test' };

      expect(errorHandler.isFeatureAvailable('redisCache')).toBe(true);

      errorHandler.handleError(error, context);

      expect(errorHandler.isFeatureAvailable('redisCache')).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Switched to in-memory cache due to Redis connection failure',
        expect.objectContaining({
          feature: 'caching',
        })
      );
    });

    it('should disable vector embedding on embedding service error', () => {
      const error = new EmbeddingServiceError('Embedding service failed');
      const context = { operation: 'test', component: 'test' };

      expect(errorHandler.isFeatureAvailable('vectorEmbedding')).toBe(true);

      errorHandler.handleError(error, context);

      expect(errorHandler.isFeatureAvailable('vectorEmbedding')).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Vector embedding disabled due to embedding service failure',
        expect.objectContaining({
          feature: 'vector-search',
        })
      );
    });

    it('should only log degradation warning once per feature', () => {
      const error1 = new Neo4jConnectionError('Neo4j unavailable');
      const error2 = new Neo4jConnectionError('Neo4j still unavailable');
      const context = { operation: 'test', component: 'test' };

      errorHandler.handleError(error1, context);
      const firstCallCount = mockLogger.warn.mock.calls.length;
      
      errorHandler.handleError(error2, context);
      const secondCallCount = mockLogger.warn.mock.calls.length;

      // Second error should only add one warning (recoverable), not the degradation warning
      expect(secondCallCount).toBe(firstCallCount + 1);
    });
  });

  describe('Degradation State', () => {
    it('should return current degradation state', () => {
      const state = errorHandler.getDegradationState();

      expect(state).toEqual({
        graphStoreDisabled: false,
        redisCacheDisabled: false,
        vectorEmbeddingDisabled: false,
      });
    });

    it('should update degradation state after errors', () => {
      errorHandler.handleError(
        new Neo4jConnectionError('Neo4j error'),
        { operation: 'test', component: 'test' }
      );

      const state = errorHandler.getDegradationState();

      expect(state.graphStoreDisabled).toBe(true);
      expect(state.redisCacheDisabled).toBe(false);
      expect(state.vectorEmbeddingDisabled).toBe(false);
    });
  });

  describe('Retry Scheduling', () => {
    it('should schedule retry with exponential backoff', () => {
      const error = new Error('Temporary error');
      const context = { operation: 'test', component: 'test' };

      const response = errorHandler.scheduleRetry(error, context, 0);

      expect(response.success).toBe(false);
      expect(response.retryable).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Scheduling retry',
        expect.objectContaining({
          retryCount: 0,
          backoffMs: 1000, // 2^0 * 1000
        })
      );
    });

    it('should increase backoff time with retry count', () => {
      const error = new Error('Temporary error');
      const context = { operation: 'test', component: 'test' };

      errorHandler.scheduleRetry(error, context, 2);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Scheduling retry',
        expect.objectContaining({
          retryCount: 2,
          backoffMs: 4000, // 2^2 * 1000
        })
      );
    });

    it('should fail after max retries', () => {
      const error = new Error('Persistent error');
      const context = { operation: 'test', component: 'test' };

      const response = errorHandler.scheduleRetry(error, context, 3);

      expect(response.success).toBe(false);
      expect(response.retryable).toBeUndefined();
      expect(response.error).toContain('Max retries exceeded');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Max retries exceeded',
        expect.objectContaining({
          retryCount: 3,
        })
      );
    });
  });

  describe('Feature Availability', () => {
    it('should report all features as available initially', () => {
      expect(errorHandler.isFeatureAvailable('graphStore')).toBe(true);
      expect(errorHandler.isFeatureAvailable('redisCache')).toBe(true);
      expect(errorHandler.isFeatureAvailable('vectorEmbedding')).toBe(true);
    });

    it('should report features as unavailable after degradation', () => {
      errorHandler.handleError(
        new Neo4jConnectionError('Neo4j error'),
        { operation: 'test', component: 'test' }
      );
      errorHandler.handleError(
        new RedisConnectionError('Redis error'),
        { operation: 'test', component: 'test' }
      );
      errorHandler.handleError(
        new EmbeddingServiceError('Embedding error'),
        { operation: 'test', component: 'test' }
      );

      expect(errorHandler.isFeatureAvailable('graphStore')).toBe(false);
      expect(errorHandler.isFeatureAvailable('redisCache')).toBe(false);
      expect(errorHandler.isFeatureAvailable('vectorEmbedding')).toBe(false);
    });
  });
});
