/**
 * Cache Manager
 * Manages cache adapter selection based on configuration
 * Provides fallback from Redis to in-memory cache in Lite mode
 */

import type { CacheAdapter } from './cache-adapter.js';
import { InMemoryCacheAdapter } from './in-memory-cache-adapter.js';
import type { LiteModeConfig } from '../config/types.js';

/**
 * CacheManager class
 * Selects and manages the appropriate cache adapter based on configuration
 * 
 * Behavior:
 * - When Redis is enabled: Uses Redis cache adapter (to be implemented)
 * - When Redis is disabled: Uses in-memory cache adapter
 * - Provides graceful degradation if Redis connection fails
 */
export class CacheManager {
  private adapter: CacheAdapter;
  private readonly config: LiteModeConfig;

  /**
   * Constructor
   * @param config Lite mode configuration
   */
  constructor(config: LiteModeConfig) {
    this.config = config;
    this.adapter = this.selectAdapter();
  }

  /**
   * Initialize the cache manager and underlying adapter
   */
  async initialize(): Promise<void> {
    try {
      await this.adapter.initialize();
      
      if (!this.adapter.isAvailable()) {
        console.warn('Cache adapter initialization succeeded but is not available');
        
        // If Redis was attempted but failed, fallback to in-memory
        if (this.config.enableRedisCache) {
          console.warn('Falling back to in-memory cache');
          this.adapter = new InMemoryCacheAdapter();
          await this.adapter.initialize();
        }
      }
    } catch (error) {
      console.error('Failed to initialize cache adapter:', error);
      
      // Fallback to in-memory cache if Redis initialization fails
      if (this.config.enableRedisCache) {
        console.warn('Redis cache initialization failed, falling back to in-memory cache');
        this.adapter = new InMemoryCacheAdapter();
        await this.adapter.initialize();
      } else {
        throw error;
      }
    }
  }

  /**
   * Get a value from the cache
   * @param key Cache key
   * @returns The cached value or null if not found
   */
  async get(key: string): Promise<any> {
    try {
      return await this.adapter.get(key);
    } catch (error) {
      console.error(`Cache get error for key "${key}":`, error);
      return null;
    }
  }

  /**
   * Set a value in the cache
   * @param key Cache key
   * @param value Value to cache
   * @param ttl Time to live in seconds (optional)
   */
  async set(key: string, value: any, ttl?: number): Promise<void> {
    try {
      await this.adapter.set(key, value, ttl);
    } catch (error) {
      console.error(`Cache set error for key "${key}":`, error);
      // Don't throw - cache failures should not break the application
    }
  }

  /**
   * Delete a value from the cache
   * @param key Cache key
   * @returns true if the key was deleted, false if it didn't exist
   */
  async delete(key: string): Promise<boolean> {
    try {
      return await this.adapter.delete(key);
    } catch (error) {
      console.error(`Cache delete error for key "${key}":`, error);
      return false;
    }
  }

  /**
   * Clear all entries from the cache
   */
  async clear(): Promise<void> {
    try {
      await this.adapter.clear();
    } catch (error) {
      console.error('Cache clear error:', error);
      // Don't throw - cache failures should not break the application
    }
  }

  /**
   * Check if the cache is available
   * @returns true if the cache adapter is available
   */
  isAvailable(): boolean {
    return this.adapter.isAvailable();
  }

  /**
   * Get the current cache adapter type
   * @returns 'redis' or 'in-memory'
   */
  getAdapterType(): 'redis' | 'in-memory' {
    if (this.adapter instanceof InMemoryCacheAdapter) {
      return 'in-memory';
    }
    return 'redis';
  }

  /**
   * Gracefully shutdown the cache manager
   */
  async shutdown(): Promise<void> {
    try {
      await this.adapter.shutdown();
    } catch (error) {
      console.error('Cache shutdown error:', error);
    }
  }

  /**
   * Select the appropriate cache adapter based on configuration
   * @returns The selected cache adapter
   */
  private selectAdapter(): CacheAdapter {
    if (this.config.enableRedisCache) {
      // TODO: Implement Redis cache adapter
      // For now, log a warning and fallback to in-memory
      console.warn(
        'Redis cache is enabled but Redis adapter is not yet implemented. ' +
        'Using in-memory cache as fallback.'
      );
      return new InMemoryCacheAdapter();
    }

    // Use in-memory cache for Lite mode
    console.info('Using in-memory cache adapter');
    return new InMemoryCacheAdapter();
  }

  /**
   * Get cache statistics (if supported by the adapter)
   * @returns Cache statistics or null if not supported
   */
  getStats(): any {
    if (this.adapter instanceof InMemoryCacheAdapter) {
      return this.adapter.getStats();
    }
    return null;
  }

  /**
   * Purge expired entries (if supported by the adapter)
   * @returns Number of entries purged or 0 if not supported
   */
  async purgeExpired(): Promise<number> {
    if (this.adapter instanceof InMemoryCacheAdapter) {
      return await this.adapter.purgeExpired();
    }
    return 0;
  }
}
