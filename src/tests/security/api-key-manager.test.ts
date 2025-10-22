/**
 * API Key Manager Unit Tests
 *
 * テスト対象:
 * - APIキー生成
 * - APIキー検証
 * - キーの無効化とローテーション
 * - クリーンアップ処理
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ApiKeyManager } from '../../security/api-key-manager.js';

describe('ApiKeyManager', () => {
  let manager: ApiKeyManager;

  beforeEach(() => {
    manager = new ApiKeyManager();
  });

  describe('generateApiKey', () => {
    it('should generate a valid API key with correct format', () => {
      const { key, plainKey } = manager.generateApiKey('test-key');

      // フォーマット検証: csm_v1_<random>
      expect(plainKey).toMatch(/^csm_v1_[A-Za-z0-9]+$/);
      expect(key.keyPrefix).toMatch(/^csm_v1_[A-Za-z0-9]{8}$/);
      expect(key.name).toBe('test-key');
      expect(key.status).toBe('active');
      expect(key.scopes).toEqual(['read', 'write']);
    });

    it('should generate unique keys on each call', () => {
      const { plainKey: key1 } = manager.generateApiKey('key-1');
      const { plainKey: key2 } = manager.generateApiKey('key-2');

      expect(key1).not.toBe(key2);
    });

    it('should respect custom scopes', () => {
      const { key } = manager.generateApiKey('admin-key', ['read', 'write', 'delete']);

      expect(key.scopes).toEqual(['read', 'write', 'delete']);
    });

    it('should set expiration date when expiresIn is provided', () => {
      const expiresInMs = 60 * 60 * 1000; // 1時間
      const beforeGeneration = Date.now();
      const { key } = manager.generateApiKey('temp-key', ['read'], expiresInMs);
      const afterGeneration = Date.now();

      expect(key.expiresAt).toBeDefined();
      expect(key.expiresAt!.getTime()).toBeGreaterThanOrEqual(beforeGeneration + expiresInMs);
      expect(key.expiresAt!.getTime()).toBeLessThanOrEqual(afterGeneration + expiresInMs);
    });

    it('should not set expiration date when expiresIn is not provided', () => {
      const { key } = manager.generateApiKey('permanent-key');

      expect(key.expiresAt).toBeUndefined();
    });
  });

  describe('validateApiKey', () => {
    it('should validate a valid API key', async () => {
      const { plainKey } = manager.generateApiKey('valid-key');

      const result = await manager.validateApiKey(plainKey);

      expect(result.valid).toBe(true);
      expect(result.key).toBeDefined();
      expect(result.key!.name).toBe('valid-key');
      expect(result.key!.lastUsedAt).toBeDefined();
    });

    it('should reject API key with invalid format', async () => {
      const result = await manager.validateApiKey('invalid-format');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('invalid_format');
    });

    it('should reject non-existent API key', async () => {
      const result = await manager.validateApiKey('csm_v1_nonexistentkey123456');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('not_found');
    });

    it('should reject revoked API key', async () => {
      const { key, plainKey } = manager.generateApiKey('revoked-key');
      manager.revokeApiKey(key.id);

      const result = await manager.validateApiKey(plainKey);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('revoked');
      expect(result.key).toBeDefined();
      expect(result.key!.status).toBe('revoked');
    });

    it('should reject expired API key', async () => {
      const { plainKey } = manager.generateApiKey('expired-key', ['read'], 100); // 100ms

      // 有効期限が切れるまで待機
      await new Promise((resolve) => setTimeout(resolve, 150));

      const result = await manager.validateApiKey(plainKey);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('expired');
      expect(result.key!.status).toBe('expired');
    });

    it('should update lastUsedAt on successful validation', async () => {
      const { key, plainKey } = manager.generateApiKey('tracked-key');
      const initialLastUsedAt = key.lastUsedAt;

      await new Promise((resolve) => setTimeout(resolve, 10));

      await manager.validateApiKey(plainKey);

      expect(key.lastUsedAt).toBeDefined();
      expect(key.lastUsedAt!.getTime()).toBeGreaterThan(initialLastUsedAt?.getTime() || 0);
    });
  });

  describe('revokeApiKey', () => {
    it('should revoke an existing API key', () => {
      const { key } = manager.generateApiKey('to-revoke');

      const result = manager.revokeApiKey(key.id);

      expect(result).toBe(true);
      expect(key.status).toBe('revoked');
    });

    it('should return false for non-existent key ID', () => {
      const result = manager.revokeApiKey('non-existent-id');

      expect(result).toBe(false);
    });
  });

  describe('listApiKeys', () => {
    it('should list all API keys when no userId is provided', () => {
      manager.generateApiKey('key-1');
      manager.generateApiKey('key-2');
      manager.generateApiKey('key-3');

      const keys = manager.listApiKeys();

      expect(keys).toHaveLength(3);
    });

    it('should filter keys by userId when provided', () => {
      const { key: key1 } = manager.generateApiKey('user1-key1');
      key1.metadata = { userId: 'user-1' };

      const { key: key2 } = manager.generateApiKey('user1-key2');
      key2.metadata = { userId: 'user-1' };

      const { key: key3 } = manager.generateApiKey('user2-key');
      key3.metadata = { userId: 'user-2' };

      const user1Keys = manager.listApiKeys('user-1');

      expect(user1Keys).toHaveLength(2);
      expect(user1Keys.every((k) => k.metadata?.userId === 'user-1')).toBe(true);
    });

    it('should return empty array when no keys match userId', () => {
      manager.generateApiKey('key');

      const keys = manager.listApiKeys('non-existent-user');

      expect(keys).toHaveLength(0);
    });
  });

  describe('cleanupExpiredKeys', () => {
    it('should delete keys expired for more than 30 days', async () => {
      const { key } = manager.generateApiKey('old-expired', ['read'], 100);

      // 有効期限が切れるまで待機
      await new Promise((resolve) => setTimeout(resolve, 150));

      // 31日前に期限切れに設定
      key.expiresAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);

      const count = manager.cleanupExpiredKeys();

      expect(count).toBe(1);
      expect(manager.listApiKeys()).toHaveLength(0);
    });

    it('should not delete recently expired keys (grace period)', async () => {
      const { key } = manager.generateApiKey('recent-expired', ['read'], 100);

      // 有効期限が切れるまで待機
      await new Promise((resolve) => setTimeout(resolve, 150));

      const count = manager.cleanupExpiredKeys();

      expect(count).toBe(0);
      expect(key.status).toBe('expired');
      expect(manager.listApiKeys()).toHaveLength(1);
    });

    it('should not affect active keys', () => {
      manager.generateApiKey('active-key');

      const count = manager.cleanupExpiredKeys();

      expect(count).toBe(0);
      expect(manager.listApiKeys()).toHaveLength(1);
    });
  });

  describe('rotateApiKey', () => {
    it('should rotate an existing API key', () => {
      const { key: oldKey, plainKey: oldPlainKey } = manager.generateApiKey('rotate-test', ['read', 'write']);
      oldKey.metadata = { userId: 'test-user' };

      const result = manager.rotateApiKey(oldKey.id);

      expect(result).not.toBeNull();
      expect(result!.key.id).not.toBe(oldKey.id);
      expect(result!.plainKey).not.toBe(oldPlainKey);
      expect(result!.key.name).toBe('rotate-test');
      expect(result!.key.scopes).toEqual(['read', 'write']);
      expect(result!.key.metadata?.userId).toBe('test-user');
      expect(oldKey.expiresAt).toBeDefined();
    });

    it('should return null for non-existent key', () => {
      const result = manager.rotateApiKey('non-existent-id');

      expect(result).toBeNull();
    });

    it('should set grace period on old key', () => {
      const { key: oldKey } = manager.generateApiKey('grace-test');
      const beforeRotation = Date.now();

      manager.rotateApiKey(oldKey.id, 60 * 60 * 1000); // 1時間の猶予期間

      expect(oldKey.expiresAt).toBeDefined();
      expect(oldKey.expiresAt!.getTime()).toBeGreaterThanOrEqual(beforeRotation + 60 * 60 * 1000);
    });

    it('should not extend expiration if already within grace period', () => {
      const { key: oldKey } = manager.generateApiKey('short-grace', ['read'], 5 * 60 * 1000); // 5分
      const originalExpiration = oldKey.expiresAt!.getTime();

      manager.rotateApiKey(oldKey.id, 30 * 24 * 60 * 60 * 1000); // 30日の猶予期間（元の有効期限より長い）

      // 元の有効期限が保持される（5分）
      expect(oldKey.expiresAt!.getTime()).toBe(originalExpiration);
    });
  });

  describe('getStatistics', () => {
    it('should return correct statistics', async () => {
      manager.generateApiKey('active-1');
      manager.generateApiKey('active-2');

      const { key: revokedKey } = manager.generateApiKey('revoked');
      manager.revokeApiKey(revokedKey.id);

      manager.generateApiKey('expired', ['read'], 100);
      await new Promise((resolve) => setTimeout(resolve, 150));
      manager.cleanupExpiredKeys(); // 期限切れステータスに更新

      const stats = manager.getStatistics();

      expect(stats.total).toBe(4);
      expect(stats.active).toBe(2);
      expect(stats.revoked).toBe(1);
      expect(stats.expired).toBe(1);
    });

    it('should return zero statistics for empty manager', () => {
      const stats = manager.getStatistics();

      expect(stats.total).toBe(0);
      expect(stats.active).toBe(0);
      expect(stats.revoked).toBe(0);
      expect(stats.expired).toBe(0);
    });
  });

  describe('clearAll', () => {
    it('should clear all API keys', () => {
      manager.generateApiKey('key-1');
      manager.generateApiKey('key-2');

      manager.clearAll();

      expect(manager.listApiKeys()).toHaveLength(0);
      expect(manager.getStatistics().total).toBe(0);
    });
  });
});
