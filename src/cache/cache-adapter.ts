/**
 * Cache Adapter Interface
 * Provides a unified interface for different cache implementations (Redis, In-Memory)
 */

/**
 * CacheAdapter interface
 * Defines the contract for cache implementations
 */
export interface CacheAdapter {
  /**
   * Get a value from the cache
   * @param key Cache key
   * @returns The cached value or null if not found or expired
   */
  get(key: string): Promise<any>;

  /**
   * Set a value in the cache
   * @param key Cache key
   * @param value Value to cache
   * @param ttl Time to live in seconds (optional)
   */
  set(key: string, value: any, ttl?: number): Promise<void>;

  /**
   * Delete a value from the cache
   * @param key Cache key
   * @returns true if the key was deleted, false if it didn't exist
   */
  delete(key: string): Promise<boolean>;

  /**
   * Clear all entries from the cache
   */
  clear(): Promise<void>;

  /**
   * Check if the cache adapter is available and ready
   * @returns true if the cache is available
   */
  isAvailable(): boolean;

  /**
   * Initialize the cache adapter
   */
  initialize(): Promise<void>;

  /**
   * Gracefully shutdown the cache adapter
   */
  shutdown(): Promise<void>;
}
