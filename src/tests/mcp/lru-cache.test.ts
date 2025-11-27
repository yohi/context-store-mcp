/**
 * LRU Cache Tests
 * LRUキャッシュの単体テスト
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LRUCache, LRUCacheConfig } from '../../mcp/lru-cache.js';

describe('LRUCache', () => {
  describe('Basic Operations', () => {
    it('should create a cache with specified max size', () => {
      const cache = new LRUCache({ maxSize: 3 });
      expect(cache.size()).toBe(0);
      expect(cache.getStats().maxSize).toBe(3);
    });

    it('should throw error for invalid max size', () => {
      expect(() => new LRUCache({ maxSize: 0 })).toThrow('maxSize must be greater than 0');
      expect(() => new LRUCache({ maxSize: -1 })).toThrow('maxSize must be greater than 0');
    });

    it('should set and get values correctly', () => {
      const cache = new LRUCache<string>({ maxSize: 3 });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key3')).toBe('value3');
      expect(cache.size()).toBe(3);
    });

    it('should return undefined for non-existent keys', () => {
      const cache = new LRUCache<string>({ maxSize: 3 });

      expect(cache.get('nonExistent')).toBeUndefined();
    });

    it('should update existing values', () => {
      const cache = new LRUCache<string>({ maxSize: 3 });

      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');

      cache.set('key1', 'updatedValue1');
      expect(cache.get('key1')).toBe('updatedValue1');
      expect(cache.size()).toBe(1);
    });

    it('should correctly report has() for existing and non-existing keys', () => {
      const cache = new LRUCache<string>({ maxSize: 3 });

      cache.set('key1', 'value1');

      expect(cache.has('key1')).toBe(true);
      expect(cache.has('nonExistent')).toBe(false);
    });

    it('should delete entries correctly', () => {
      const cache = new LRUCache<string>({ maxSize: 3 });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      expect(cache.delete('key1')).toBe(true);
      expect(cache.has('key1')).toBe(false);
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.size()).toBe(1);

      expect(cache.delete('nonExistent')).toBe(false);
    });

    it('should clear all entries', () => {
      const cache = new LRUCache<string>({ maxSize: 3 });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      cache.clear();

      expect(cache.size()).toBe(0);
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
      expect(cache.get('key3')).toBeUndefined();
    });
  });

  describe('LRU Eviction', () => {
    it('should evict the least recently used entry when capacity is exceeded', () => {
      const cache = new LRUCache<string>({ maxSize: 3 });

      cache.set('key1', 'value1'); // [key1]
      cache.set('key2', 'value2'); // [key1, key2]
      cache.set('key3', 'value3'); // [key1, key2, key3]

      // 容量を超えるとkey1が退避される
      cache.set('key4', 'value4'); // [key2, key3, key4]

      expect(cache.size()).toBe(3);
      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(true);
      expect(cache.has('key3')).toBe(true);
      expect(cache.has('key4')).toBe(true);
    });

    it('should update access order when getting an entry', () => {
      const cache = new LRUCache<string>({ maxSize: 3 });

      cache.set('key1', 'value1'); // [key1]
      cache.set('key2', 'value2'); // [key1, key2]
      cache.set('key3', 'value3'); // [key1, key2, key3]

      // key1をアクセスして最新にする
      cache.get('key1'); // [key2, key3, key1]

      // 容量を超えるとkey2が退避される（key1は最近アクセスされたため）
      cache.set('key4', 'value4'); // [key3, key1, key4]

      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(false);
      expect(cache.has('key3')).toBe(true);
      expect(cache.has('key4')).toBe(true);
    });

    it('should update access order when updating an entry', () => {
      const cache = new LRUCache<string>({ maxSize: 3 });

      cache.set('key1', 'value1'); // [key1]
      cache.set('key2', 'value2'); // [key1, key2]
      cache.set('key3', 'value3'); // [key1, key2, key3]

      // key1を更新して最新にする
      cache.set('key1', 'updatedValue1'); // [key2, key3, key1]

      // 容量を超えるとkey2が退避される
      cache.set('key4', 'value4'); // [key3, key1, key4]

      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(false);
      expect(cache.has('key3')).toBe(true);
      expect(cache.has('key4')).toBe(true);
    });

    it('should call onEvict callback when entries are evicted', () => {
      const onEvict = vi.fn();
      const cache = new LRUCache<string>({ maxSize: 2, onEvict });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      // 容量を超えてkey1が退避される
      cache.set('key3', 'value3');

      expect(onEvict).toHaveBeenCalledTimes(1);
      expect(onEvict).toHaveBeenCalledWith('key1', 'value1');
    });

    it('should call onEvict callback when entries are manually deleted', () => {
      const onEvict = vi.fn();
      const cache = new LRUCache<string>({ maxSize: 3, onEvict });

      cache.set('key1', 'value1');
      cache.delete('key1');

      expect(onEvict).toHaveBeenCalledTimes(1);
      expect(onEvict).toHaveBeenCalledWith('key1', 'value1');
    });

    it('should call onEvict callback for all entries when cleared', () => {
      const onEvict = vi.fn();
      const cache = new LRUCache<string>({ maxSize: 3, onEvict });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      cache.clear();

      expect(onEvict).toHaveBeenCalledTimes(3);
      expect(onEvict).toHaveBeenCalledWith('key1', 'value1');
      expect(onEvict).toHaveBeenCalledWith('key2', 'value2');
      expect(onEvict).toHaveBeenCalledWith('key3', 'value3');
    });
  });

  describe('Expiration', () => {
    it('should expire entries after maxAge', async () => {
      const cache = new LRUCache<string>({ maxSize: 3, maxAge: 100 });

      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);

      // 有効期限が切れるまで待機
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(cache.has('key1')).toBe(false);
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should purge expired entries', async () => {
      const cache = new LRUCache<string>({ maxSize: 5, maxAge: 100 });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // 一部のエントリーが期限切れになるまで待機
      await new Promise((resolve) => setTimeout(resolve, 150));

      cache.set('key4', 'value4'); // 新しいエントリー

      const purgedCount = cache.purgeExpired();

      expect(purgedCount).toBe(3); // key1, key2, key3が削除される
      expect(cache.size()).toBe(1); // key4のみ残る
      expect(cache.has('key4')).toBe(true);
    });

    it('should not purge entries when maxAge is not set', () => {
      const cache = new LRUCache<string>({ maxSize: 3 });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      const purgedCount = cache.purgeExpired();

      expect(purgedCount).toBe(0);
      expect(cache.size()).toBe(2);
    });
  });

  describe('Statistics and Helpers', () => {
    it('should return all keys', () => {
      const cache = new LRUCache<string>({ maxSize: 3 });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      const keys = cache.keys();
      expect(keys).toHaveLength(3);
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys).toContain('key3');
    });

    it('should return all values', () => {
      const cache = new LRUCache<string>({ maxSize: 3 });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      const values = cache.values();
      expect(values).toHaveLength(3);
      expect(values).toContain('value1');
      expect(values).toContain('value2');
      expect(values).toContain('value3');
    });

    it('should return correct statistics', () => {
      const cache = new LRUCache<string>({ maxSize: 5 });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // いくつかのエントリーにアクセス
      cache.get('key1');
      cache.get('key1');
      cache.get('key2');

      const stats = cache.getStats();

      expect(stats.size).toBe(3);
      expect(stats.maxSize).toBe(5);
      expect(stats.avgAccessCount).toBeGreaterThan(0);
    });

    it('should track access count correctly', () => {
      const cache = new LRUCache<string>({ maxSize: 3 });

      cache.set('key1', 'value1');

      // 複数回アクセス
      cache.get('key1');
      cache.get('key1');
      cache.get('key1');

      const stats = cache.getStats();
      expect(stats.avgAccessCount).toBe(3);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle mixed operations correctly', () => {
      const cache = new LRUCache<string>({ maxSize: 3 });

      cache.set('key1', 'value1'); // [key1]
      cache.set('key2', 'value2'); // [key1, key2]
      cache.get('key1'); // [key2, key1] - key1を最新に
      cache.set('key3', 'value3'); // [key2, key1, key3]
      cache.delete('key2'); // [key1, key3]
      cache.set('key4', 'value4'); // [key1, key3, key4]
      cache.set('key5', 'value5'); // [key3, key4, key5] - key1が退避

      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(false);
      expect(cache.has('key3')).toBe(true);
      expect(cache.has('key4')).toBe(true);
      expect(cache.has('key5')).toBe(true);
      expect(cache.size()).toBe(3);
    });

    it('should work with different value types', () => {
      interface TestObject {
        id: number;
        name: string;
      }

      const cache = new LRUCache<TestObject>({ maxSize: 2 });

      cache.set('obj1', { id: 1, name: 'Object 1' });
      cache.set('obj2', { id: 2, name: 'Object 2' });

      const obj1 = cache.get('obj1');
      expect(obj1).toEqual({ id: 1, name: 'Object 1' });

      cache.set('obj3', { id: 3, name: 'Object 3' });

      // obj2が退避される
      expect(cache.has('obj2')).toBe(false);
      expect(cache.has('obj1')).toBe(true);
      expect(cache.has('obj3')).toBe(true);
    });

    it('should handle high-frequency access patterns', () => {
      const cache = new LRUCache<number>({ maxSize: 100 });

      // 100個のエントリーを追加
      for (let i = 0; i < 100; i++) {
        cache.set(`key${i}`, i);
      }

      expect(cache.size()).toBe(100);

      // 最初の50個に頻繁にアクセス
      for (let i = 0; i < 50; i++) {
        for (let j = 0; j < 5; j++) {
          cache.get(`key${i}`);
        }
      }

      // 50個の新しいエントリーを追加
      for (let i = 100; i < 150; i++) {
        cache.set(`key${i}`, i);
      }

      // 頻繁にアクセスされたエントリー（key0-key49）は残るべき
      for (let i = 0; i < 50; i++) {
        expect(cache.has(`key${i}`)).toBe(true);
      }

      // アクセスされなかったエントリー（key50-key99）は退避されるべき
      for (let i = 50; i < 100; i++) {
        expect(cache.has(`key${i}`)).toBe(false);
      }
    });
  });

  describe('Zero TTL', () => {
    it('should treat maxAge: 0 as immediate expiration', async () => {
      const cache = new LRUCache<string>({ maxSize: 3, maxAge: 0 });

      cache.set('key1', 'value1');

      // Should be expired immediately
      await new Promise((resolve) => setTimeout(resolve, 1));

      expect(cache.has('key1')).toBe(false);
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should purge all entries when maxAge is 0', async () => {
      const cache = new LRUCache<string>({ maxSize: 3, maxAge: 0 });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      await new Promise((resolve) => setTimeout(resolve, 1));

      const purgedCount = cache.purgeExpired();
      expect(purgedCount).toBe(2);
      expect(cache.size()).toBe(0);
    });
  });
});
