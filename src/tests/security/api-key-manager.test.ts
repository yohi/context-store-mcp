/**
 * API Key Manager Unit Tests
 *
 * テスト対象:
 * - APIキー生成
 * - APIキー検証
 * - キーの無効化とローテーション
 * - クリーンアップ処理
 * - HMAC-SHA256への移行
 * - 永続化（InMemoryアダプターでテスト）
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { ApiKeyManager } from '../../security/api-key-manager.js';
import { InMemoryApiKeyStoreAdapter } from '../../storage/api-key-store-adapter.js';
import crypto from 'crypto';

describe('ApiKeyManager', () => {
  let manager: ApiKeyManager;
  let store: InMemoryApiKeyStoreAdapter;

  // テスト用のペッパーを設定
  beforeAll(() => {
    process.env['API_KEY_PEPPER'] = 'test-pepper-secret-for-hmac-sha256-hashing-1234567890';
  });

  beforeEach(() => {
    store = new InMemoryApiKeyStoreAdapter();
    manager = new ApiKeyManager(store);
  });

  describe('generateApiKey', () => {
    it('should generate a valid API key with correct format', async () => {
      const { key, plainKey } = await manager.generateApiKey('test-key');

      // フォーマット検証: csm_v1_<random>
      expect(plainKey).toMatch(/^csm_v1_[A-Za-z0-9]+$/);
      expect(key.keyPrefix).toMatch(/^csm_v1_[A-Za-z0-9]{8}$/);
      expect(key.name).toBe('test-key');
      expect(key.status).toBe('active');
      expect(key.scopes).toEqual(['read', 'write']);
    });

    it('should generate unique keys on each call', async () => {
      const { plainKey: key1 } = await manager.generateApiKey('key-1');
      const { plainKey: key2 } = await manager.generateApiKey('key-2');

      expect(key1).not.toBe(key2);
    });

    it('should respect custom scopes', async () => {
      const { key } = await manager.generateApiKey('admin-key', ['read', 'write', 'delete']);

      expect(key.scopes).toEqual(['read', 'write', 'delete']);
    });

    it('should set expiration date when expiresIn is provided', async () => {
      const expiresInMs = 60 * 60 * 1000; // 1時間
      const beforeGeneration = Date.now();
      const { key } = await manager.generateApiKey('temp-key', ['read'], expiresInMs);
      const afterGeneration = Date.now();

      expect(key.expiresAt).toBeDefined();
      expect(key.expiresAt!.getTime()).toBeGreaterThanOrEqual(beforeGeneration + expiresInMs);
      expect(key.expiresAt!.getTime()).toBeLessThanOrEqual(afterGeneration + expiresInMs);
    });

    it('should not set expiration date when expiresIn is not provided', async () => {
      const { key } = await manager.generateApiKey('permanent-key');

      expect(key.expiresAt).toBeUndefined();
    });
  });

  describe('validateApiKey', () => {
    it('should validate a valid API key', async () => {
      const { plainKey } = await manager.generateApiKey('valid-key');

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
      const { key, plainKey } = await manager.generateApiKey('revoked-key');
      manager.revokeApiKey(key.id);

      const result = await manager.validateApiKey(plainKey);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('revoked');
      expect(result.key).toBeDefined();
      expect(result.key!.status).toBe('revoked');
    });

    it('should reject expired API key', async () => {
      const { plainKey } = await manager.generateApiKey('expired-key', ['read'], 100); // 100ms

      // 有効期限が切れるまで待機
      await new Promise((resolve) => setTimeout(resolve, 150));

      const result = await manager.validateApiKey(plainKey);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('expired');
      expect(result.key!.status).toBe('expired');
    });

    it('should update lastUsedAt on successful validation', async () => {
      const { key, plainKey } = await manager.generateApiKey('tracked-key');
      const initialLastUsedAt = key.lastUsedAt;

      await new Promise((resolve) => setTimeout(resolve, 10));

      await manager.validateApiKey(plainKey);

      expect(key.lastUsedAt).toBeDefined();
      expect(key.lastUsedAt!.getTime()).toBeGreaterThan(initialLastUsedAt?.getTime() || 0);
    });
  });

  describe('revokeApiKey', () => {
    it('should revoke an existing API key', async () => {
      const { key } = await manager.generateApiKey('to-revoke');

      const result = await manager.revokeApiKey(key.id);

      expect(result).toBe(true);
      expect(key.status).toBe('revoked');
    });

    it('should return false for non-existent key ID', async () => {
      const result = await manager.revokeApiKey('non-existent-id');

      expect(result).toBe(false);
    });
  });

  describe('listApiKeys', () => {
    it('should list all API keys when no userId is provided', async () => {
      await manager.generateApiKey('key-1');
      await manager.generateApiKey('key-2');
      await manager.generateApiKey('key-3');

      const keys = await manager.listApiKeys();

      expect(keys).toHaveLength(3);
    });

    it('should filter keys by userId when provided', async () => {
      const { key: key1 } = await manager.generateApiKey('user1-key1');
      key1.metadata = { userId: 'user-1' };

      const { key: key2 } = await manager.generateApiKey('user1-key2');
      key2.metadata = { userId: 'user-1' };

      const { key: key3 } = await manager.generateApiKey('user2-key');
      key3.metadata = { userId: 'user-2' };

      const user1Keys = await manager.listApiKeys('user-1');

      expect(user1Keys).toHaveLength(2);
      expect(user1Keys.every((k) => k.metadata?.userId === 'user-1')).toBe(true);
    });

    it('should return empty array when no keys match userId', async () => {
      await manager.generateApiKey('key');

      const keys = await manager.listApiKeys('non-existent-user');

      expect(keys).toHaveLength(0);
    });
  });

  describe('cleanupExpiredKeys', () => {
    it('should delete keys expired for more than 30 days', async () => {
      const { key } = await manager.generateApiKey('old-expired', ['read'], 100);

      // 有効期限が切れるまで待機
      await new Promise((resolve) => setTimeout(resolve, 150));

      // 31日前に期限切れに設定してストレージに保存
      key.expiresAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      key.status = 'expired';
      await store.update(key);

      const count = await manager.cleanupExpiredKeys();

      expect(count).toBe(1);
      expect(await manager.listApiKeys()).toHaveLength(0);
    });

    it('should not delete recently expired keys (grace period)', async () => {
      const { key } = await manager.generateApiKey('recent-expired', ['read'], 100);

      // 有効期限が切れるまで待機
      await new Promise((resolve) => setTimeout(resolve, 150));

      const count = await manager.cleanupExpiredKeys();

      expect(count).toBe(0);
      expect(key.status).toBe('expired');
      expect(await manager.listApiKeys()).toHaveLength(1);
    });

    it('should not affect active keys', async () => {
      await manager.generateApiKey('active-key');

      const count = await manager.cleanupExpiredKeys();

      expect(count).toBe(0);
      expect(await manager.listApiKeys()).toHaveLength(1);
    });
  });

  describe('rotateApiKey', () => {
    it('should rotate an existing API key', async () => {
      const { key: oldKey, plainKey: oldPlainKey } = await manager.generateApiKey('rotate-test', ['read', 'write']);
      oldKey.metadata = { userId: 'test-user' };

      const result = await await manager.rotateApiKey(oldKey.id);

      expect(result).not.toBeNull();
      expect(result!.key.id).not.toBe(oldKey.id);
      expect(result!.plainKey).not.toBe(oldPlainKey);
      expect(result!.key.name).toBe('rotate-test');
      expect(result!.key.scopes).toEqual(['read', 'write']);
      expect(result!.key.metadata?.userId).toBe('test-user');
      expect(oldKey.expiresAt).toBeDefined();
    });

    it('should return null for non-existent key', async () => {
      const result = await await manager.rotateApiKey('non-existent-id');

      expect(result).toBeNull();
    });

    it('should set grace period on old key', async () => {
      const { key: oldKey } = await manager.generateApiKey('grace-test');
      const beforeRotation = Date.now();

      await manager.rotateApiKey(oldKey.id, 60 * 60 * 1000); // 1時間の猶予期間

      expect(oldKey.expiresAt).toBeDefined();
      expect(oldKey.expiresAt!.getTime()).toBeGreaterThanOrEqual(beforeRotation + 60 * 60 * 1000);
    });

    it('should not extend expiration if already within grace period', async () => {
      const { key: oldKey } = await manager.generateApiKey('short-grace', ['read'], 5 * 60 * 1000); // 5分
      const originalExpiration = oldKey.expiresAt!.getTime();

      await manager.rotateApiKey(oldKey.id, 30 * 24 * 60 * 60 * 1000); // 30日の猶予期間（元の有効期限より長い）

      // 元の有効期限が保持される（5分）
      expect(oldKey.expiresAt!.getTime()).toBe(originalExpiration);
    });
  });

  describe('getStatistics', () => {
    it('should return correct statistics', async () => {
      await manager.generateApiKey('active-1');
      await manager.generateApiKey('active-2');

      const { key: revokedKey } = await manager.generateApiKey('revoked');
      await manager.revokeApiKey(revokedKey.id);

      await manager.generateApiKey('expired', ['read'], 100);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await manager.cleanupExpiredKeys(); // 期限切れステータスに更新

      const stats = await manager.getStatistics();

      expect(stats.total).toBe(4);
      expect(stats.active).toBe(2);
      expect(stats.revoked).toBe(1);
      expect(stats.expired).toBe(1);
    });

    it('should return zero statistics for empty manager', async () => {
      const stats = await manager.getStatistics();

      expect(stats.total).toBe(0);
      expect(stats.active).toBe(0);
      expect(stats.revoked).toBe(0);
      expect(stats.expired).toBe(0);
    });
  });

  describe('clearAll', () => {
    it('should clear all API keys', async () => {
      await manager.generateApiKey('key-1');
      await manager.generateApiKey('key-2');

      store.clear();

      expect(await manager.listApiKeys()).toHaveLength(0);
      expect((await manager.getStatistics()).total).toBe(0);
    });
  });

  describe('HMAC-SHA256 migration', () => {
    it('should generate new keys with HMAC-SHA256', async () => {
      const { key, plainKey } = await manager.generateApiKey('hmac-key');

      // HMAC-SHA256でハッシュ化されていることを確認
      const pepper = process.env['API_KEY_PEPPER']!;
      const expectedHash = crypto.createHmac('sha256', pepper).update(plainKey).digest('hex');

      expect(key.hashedKey).toBe(expectedHash);
    });

    it('should validate new HMAC-based keys successfully', async () => {
      const { plainKey } = await manager.generateApiKey('new-hmac-key');

      const result = await manager.validateApiKey(plainKey);

      expect(result.valid).toBe(true);
      expect(result.key).toBeDefined();
    });

    it('should migrate legacy SHA-256 keys to HMAC-SHA256 on validation', async () => {
      // レガシーSHA-256キーを手動で作成
      const plainKey = 'csm_v1_testlegacykey123456';
      const legacyHash = crypto.createHash('sha256').update(plainKey).digest('hex');

      const legacyKey = {
        id: crypto.randomUUID(),
        keyPrefix: 'csm_v1_testlega',
        hashedKey: legacyHash,
        name: 'legacy-key',
        createdAt: new Date(),
        status: 'active' as const,
        scopes: ['read', 'write'],
      };

      // レガシーハッシュでキーを登録（内部APIを使用）
      await store.store(legacyKey);

      // 検証を実行（自動移行が発生する）
      const result = await manager.validateApiKey(plainKey);

      expect(result.valid).toBe(true);
      expect(result.key).toBeDefined();

      // hashedKeyは公開ビューに含まれないことを確認（セキュリティ保護）
      expect((result.key as any).hashedKey).toBeUndefined();

      // 新しいHMACハッシュが使用されていることを確認（内部状態で検証）
      const pepper = process.env['API_KEY_PEPPER']!;
      const newHash = crypto.createHmac('sha256', pepper).update(plainKey).digest('hex');

      // レガシーハッシュが削除されていることを確認
      const legacyEntry = await store.findByHashedKey(legacyHash);
      expect(legacyEntry).toBeNull();

      // 新しいハッシュでアクセス可能であることを確認（内部状態で検証）
      const newEntry = await store.findByHashedKey(newHash);
      expect(newEntry).toBeDefined();
      expect(newEntry.id).toBe(legacyKey.id);
      expect(newEntry.hashedKey).toBe(newHash); // 内部ではhashedKeyを持つ
    });

    it('should successfully validate migrated keys on subsequent attempts', async () => {
      // レガシーキーを作成して移行
      const plainKey = 'csm_v1_migratedkey987654';
      const legacyHash = crypto.createHash('sha256').update(plainKey).digest('hex');

      const legacyKey = {
        id: crypto.randomUUID(),
        keyPrefix: 'csm_v1_migrated',
        hashedKey: legacyHash,
        name: 'to-migrate',
        createdAt: new Date(),
        status: 'active' as const,
        scopes: ['read'],
      };

      await store.store(legacyKey);

      // 1回目の検証（移行実行）
      const firstResult = await manager.validateApiKey(plainKey);
      expect(firstResult.valid).toBe(true);

      // 2回目の検証（HMAC-SHA256で直接検証）
      const secondResult = await manager.validateApiKey(plainKey);
      expect(secondResult.valid).toBe(true);
      expect(secondResult.key!.id).toBe(legacyKey.id);
    });

    it('should not migrate revoked legacy keys', async () => {
      const plainKey = 'csm_v1_revokedlegacy123';
      const legacyHash = crypto.createHash('sha256').update(plainKey).digest('hex');

      const legacyKey = {
        id: crypto.randomUUID(),
        keyPrefix: 'csm_v1_revoked',
        hashedKey: legacyHash,
        name: 'revoked-legacy',
        createdAt: new Date(),
        status: 'revoked' as const,
        scopes: ['read'],
      };

      await store.store(legacyKey);

      // 無効なキーは移行されない
      const result = await manager.validateApiKey(plainKey);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('revoked');

      // レガシーハッシュがまだ存在することを確認（移行されていない）
      const legacyEntry = await store.findByHashedKey(legacyHash);
      expect(legacyEntry).toBeDefined();
    });

    it('should not migrate expired legacy keys', async () => {
      const plainKey = 'csm_v1_expiredlegacy456';
      const legacyHash = crypto.createHash('sha256').update(plainKey).digest('hex');

      const legacyKey = {
        id: crypto.randomUUID(),
        keyPrefix: 'csm_v1_expired',
        hashedKey: legacyHash,
        name: 'expired-legacy',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() - 1000), // 1秒前に期限切れ
        status: 'active' as const,
        scopes: ['read'],
      };

      await store.store(legacyKey);

      // 期限切れのキーは移行されない
      const result = await manager.validateApiKey(plainKey);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('expired');

      // レガシーハッシュがまだ存在することを確認（移行されていない）
      const legacyEntry = await store.findByHashedKey(legacyHash);
      expect(legacyEntry).toBeDefined();
    });
  });

  describe('pepper validation', () => {
    it('should throw error when pepper is not set', async () => {
      const originalPepper = process.env['API_KEY_PEPPER'];
      delete process.env['API_KEY_PEPPER'];

      try {
        // コンストラクタで検証されるため、インスタンス作成時に例外がスローされる
        expect(() => new ApiKeyManager()).toThrow(
          'API_KEY_PEPPER environment variable is required'
        );
      } finally {
        // テスト後に復元
        if (originalPepper) {
          process.env['API_KEY_PEPPER'] = originalPepper;
        }
      }
    });

    it('should warn when pepper is too short', async () => {
      const originalPepper = process.env['API_KEY_PEPPER'];
      process.env['API_KEY_PEPPER'] = 'short'; // 16文字未満

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        // コンストラクタで検証されるため、インスタンス作成時に警告が出力される
        new ApiKeyManager();
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('WARNING: API_KEY_PEPPER is shorter than recommended')
        );
      } finally {
        consoleWarnSpy.mockRestore();
        if (originalPepper) {
          process.env['API_KEY_PEPPER'] = originalPepper;
        }
      }
    });
  });
});
