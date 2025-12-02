/**
 * In-Memory Cache Adapter
 * Provides an in-memory cache implementation using LRU eviction policy
 * Used as a fallback when Redis is not available in Lite mode
 */

import { LRUCache } from '../mcp/lru-cache.js';
import type { CacheAdapter } from './cache-adapter.js';

/**
 * Configuration for InMemoryCacheAdapter
 */
export interface InMemoryCacheConfig {
  /** Maximum number of entries in the cache (default: 1000) */
  maxSize?: number;
  
  /** Default TTL in seconds (default: 3600 = 1 hour) */
  defaultTtl?: number;
}

/**
 * Cache entry with TTL support
 */
interface CacheEntry {
  value: any;
  expiresAt: number | null;
}

/**
 * InMemoryCacheAdapter class
 * Implements CacheAdapter interface using an in-memory LRU cache
 * 
 * Features:
 * - LRU eviction policy when max size is reached
 * - TTL (Time To Live) support for automatic expiration
 * - Maximum size limit of 1000 entries (configurable)
 * - O(1) read/write performance
 */
export class InMemoryCacheAdapter implements CacheAdapter {
  private cache: LRUCache<CacheEntry>;
  private readonly defaultTtl: number;
  private readonly maxSize: number;
  private available: boolean = false;

  /**
   * Constructor
   * @param config Configuration options
   */
  constructor(config: InMemoryCacheConfig = {}) {
    this.maxSize = config.maxSize ?? 1000;
    this.defaultTtl = config.defaultTtl ?? 3600; // 1 hour default

    // Initialize LRU cache with eviction callback
    this.cache = new LRUCache<CacheEntry>({
      maxSize: this.maxSize,
      onEvict: (_key: string, _entry: CacheEntry) => {
        // Optional: Log eviction for monitoring
        // console.debug(`Cache entry evicted: ${_key}`);
      },
    });
  }

  /**
   * Initialize the cache adapter
   */
  async initialize(): Promise<void> {
    this.available = true;
  }

  /**
   * Check if the cache adapter is available
   * @returns true if available
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Get a value from the cache
   * @param key Cache key
   * @returns The cached value or null if not found or expired
   */
  async get(key: string): Promise<any> {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if entry has expired
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      // Remove expired entry
      await this.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Set a value in the cache
   * @param key Cache key
   * @param value Value to cache
   * @param ttl Time to live in seconds (optional, uses default if not provided)
   */
  async set(key: string, value: any, ttl?: number): Promise<void> {
    const ttlSeconds = ttl ?? this.defaultTtl;
    const expiresAt = ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;

    const entry: CacheEntry = {
      value,
      expiresAt,
    };

    this.cache.set(key, entry);
  }

  /**
   * Delete a value from the cache
   * @param key Cache key
   * @returns true if the key was deleted, false if it didn't exist
   */
  async delete(key: string): Promise<boolean> {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache
   */
  async clear(): Promise<void> {
    this.cache.clear();
  }

  /**
   * Gracefully shutdown the cache adapter
   */
  async shutdown(): Promise<void> {
    this.cache.clear();
    this.available = false;
  }

  /**
   * Get cache statistics
   * @returns Cache statistics including size and max size
   */
  getStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    avgAccessCount: number;
  } {
    return this.cache.getStats();
  }

  /**
   * Purge expired entries from the cache
   * @returns Number of entries purged
   */
  async purgeExpired(): Promise<number> {
    let purgedCount = 0;
    const now = Date.now();
    const keysToDelete: string[] = [];

    // Collect keys of expired entries
    // Iterate over the internal cache map directly to avoid updating LRU access order
    for (const key of this.cache.keys()) {
      const entryNode = this.cache['cache'].get(key); // Get the ListNode
      if (entryNode) {
        const entry = entryNode.value; // Access the actual CacheEntry value
        if (entry.expiresAt !== null && now > entry.expiresAt) {
          keysToDelete.push(key);
        }
      }
    }

    // Delete expired entries
    for (const key of keysToDelete) {
      await this.delete(key);
      purgedCount++;
    }

    return purgedCount;
  }

  /**
   * Check if a key exists in the cache (without updating access time)
   * @param key Cache key
   * @returns true if the key exists and is not expired
   */
  async has(key: string): Promise<boolean> {
    // Directly access the internal map to check for existence without updating LRU order
    const entryNode = this.cache['cache'].get(key);
    
    if (!entryNode) {
      return false;
    }

    // Access the actual CacheEntry value from the node
    const entry = entryNode.value;

    // Check expiration
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      await this.delete(key);
      return false;
    }

    return true;
  }
}
