/**
 * Encryption Module Unit Tests
 *
 * テスト対象:
 * - AES-256-GCM暗号化/復号化
 * - エンベロープ暗号化パターン
 * - キーローテーション
 * - エラーハンドリング
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LocalMasterKeyProvider,
  EncryptionManager,
  KeyRotationManager,
  KEY_LENGTH,
  ENCRYPTION_ALGORITHM,
  type DataEncryptionKey,
} from '../../security/encryption.js';

describe('LocalMasterKeyProvider', () => {
  let provider: LocalMasterKeyProvider;

  beforeEach(() => {
    // 固定のマスターキーを使用（テスト用）
    const masterKeyHex = '0'.repeat(KEY_LENGTH * 2);
    provider = new LocalMasterKeyProvider(masterKeyHex);
  });

  describe('generateDataKey', () => {
    it('should generate a 32-byte data key', async () => {
      const { plaintext, encrypted } = await provider.generateDataKey();

      expect(plaintext).toBeInstanceOf(Buffer);
      expect(plaintext.length).toBe(KEY_LENGTH);
      expect(encrypted).toBeInstanceOf(Buffer);
      expect(encrypted.length).toBeGreaterThan(plaintext.length); // IV + AuthTag + Ciphertext
    });

    it('should generate different keys on each call', async () => {
      const key1 = await provider.generateDataKey();
      const key2 = await provider.generateDataKey();

      expect(key1.plaintext.equals(key2.plaintext)).toBe(false);
      expect(key1.encrypted.equals(key2.encrypted)).toBe(false);
    });
  });

  describe('encrypt and decrypt', () => {
    it('should encrypt and decrypt data correctly', async () => {
      const plaintext = Buffer.from('Hello, World!', 'utf8');
      const encrypted = await provider.encrypt(plaintext);
      const decrypted = await provider.decrypt(encrypted);

      expect(decrypted.toString('utf8')).toBe('Hello, World!');
    });

    it('should produce different ciphertexts for the same plaintext', async () => {
      const plaintext = Buffer.from('Same content', 'utf8');
      const encrypted1 = await provider.encrypt(plaintext);
      const encrypted2 = await provider.encrypt(plaintext);

      // IVが異なるため、暗号文も異なるはず
      expect(encrypted1.equals(encrypted2)).toBe(false);
    });

    it('should fail to decrypt with tampered ciphertext', async () => {
      const plaintext = Buffer.from('Secure data', 'utf8');
      const encrypted = await provider.encrypt(plaintext);

      // データを改ざん
      encrypted[encrypted.length - 1] ^= 0xff;

      await expect(provider.decrypt(encrypted)).rejects.toThrow();
    });

    it('should fail to decrypt with invalid ciphertext length', async () => {
      const shortCiphertext = Buffer.from('short');

      await expect(provider.decrypt(shortCiphertext)).rejects.toThrow('Invalid ciphertext: too short');
    });
  });
});

describe('EncryptionManager', () => {
  let provider: LocalMasterKeyProvider;
  let manager: EncryptionManager;

  beforeEach(() => {
    const masterKeyHex = '1'.repeat(KEY_LENGTH * 2);
    provider = new LocalMasterKeyProvider(masterKeyHex);
    manager = new EncryptionManager(provider);
  });

  describe('generateDataKey', () => {
    it('should generate a DEK with valid properties', async () => {
      const dek = await manager.generateDataKey();

      expect(dek.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(dek.encryptedKey).toBeTruthy();
      expect(dek.createdAt).toBeInstanceOf(Date);
      expect(dek.expiresAt).toBeInstanceOf(Date);
      expect(dek.status).toBe('active');
      expect(dek.expiresAt.getTime()).toBeGreaterThan(dek.createdAt.getTime());
    });

    it('should cache the generated DEK', async () => {
      const dek = await manager.generateDataKey();

      // キャッシュに存在することを確認（間接的に）
      const plaintext = 'Test data';
      const encrypted = await manager.encrypt(plaintext, dek);
      const decrypted = await manager.decrypt(encrypted, dek);

      expect(decrypted.toString('utf8')).toBe(plaintext);
    });
  });

  describe('encrypt and decrypt', () => {
    it('should encrypt and decrypt string data', async () => {
      const dek = await manager.generateDataKey();
      const plaintext = 'Sensitive information';

      const encrypted = await manager.encrypt(plaintext, dek);
      expect(encrypted.ciphertext).toBeTruthy();
      expect(encrypted.iv).toBeTruthy();
      expect(encrypted.authTag).toBeTruthy();
      expect(encrypted.keyId).toBe(dek.id);
      expect(encrypted.algorithm).toBe(ENCRYPTION_ALGORITHM);

      const decrypted = await manager.decrypt(encrypted, dek);
      expect(decrypted.toString('utf8')).toBe(plaintext);
    });

    it('should encrypt and decrypt Buffer data', async () => {
      const dek = await manager.generateDataKey();
      const plaintext = Buffer.from([0x01, 0x02, 0x03, 0x04]);

      const encrypted = await manager.encrypt(plaintext, dek);
      const decrypted = await manager.decrypt(encrypted, dek);

      expect(decrypted.equals(plaintext)).toBe(true);
    });

    it('should fail to decrypt with mismatched key ID', async () => {
      const dek1 = await manager.generateDataKey();
      const dek2 = await manager.generateDataKey();
      const plaintext = 'Secret';

      const encrypted = await manager.encrypt(plaintext, dek1);

      await expect(manager.decrypt(encrypted, dek2)).rejects.toThrow('Key ID mismatch');
    });

    it('should fail to decrypt with unsupported algorithm', async () => {
      const dek = await manager.generateDataKey();
      const plaintext = 'Data';

      const encrypted = await manager.encrypt(plaintext, dek);
      encrypted.algorithm = 'aes-128-cbc'; // 未サポートのアルゴリズム

      await expect(manager.decrypt(encrypted, dek)).rejects.toThrow('Unsupported algorithm');
    });

    it('should fail to decrypt with tampered ciphertext', async () => {
      const dek = await manager.generateDataKey();
      const plaintext = 'Important data';

      const encrypted = await manager.encrypt(plaintext, dek);

      // 暗号文を改ざん
      const tamperedCiphertext = Buffer.from(encrypted.ciphertext, 'base64');
      tamperedCiphertext[0] ^= 0xff;
      encrypted.ciphertext = tamperedCiphertext.toString('base64');

      await expect(manager.decrypt(encrypted, dek)).rejects.toThrow();
    });
  });

  describe('clearKeyCache', () => {
    it('should clear all cached keys', async () => {
      const dek1 = await manager.generateDataKey();
      const dek2 = await manager.generateDataKey();

      manager.clearKeyCache();

      // キャッシュがクリアされても、復号化は成功する（DEKから再読み込み）
      const plaintext = 'Test';
      const encrypted = await manager.encrypt(plaintext, dek1);
      const decrypted = await manager.decrypt(encrypted, dek1);

      expect(decrypted.toString('utf8')).toBe(plaintext);
    });
  });

  describe('evictKey', () => {
    it('should evict a specific key from cache', async () => {
      const dek = await manager.generateDataKey();
      const plaintext = 'Data';

      const encrypted = await manager.encrypt(plaintext, dek);

      manager.evictKey(dek.id);

      // キャッシュから削除されても、復号化は成功する
      const decrypted = await manager.decrypt(encrypted, dek);
      expect(decrypted.toString('utf8')).toBe(plaintext);
    });
  });
});

describe('KeyRotationManager', () => {
  let provider: LocalMasterKeyProvider;
  let encryptionManager: EncryptionManager;
  let rotationManager: KeyRotationManager;

  beforeEach(() => {
    const masterKeyHex = '2'.repeat(KEY_LENGTH * 2);
    provider = new LocalMasterKeyProvider(masterKeyHex);
    encryptionManager = new EncryptionManager(provider);
    rotationManager = new KeyRotationManager(encryptionManager);
  });

  describe('shouldRotate', () => {
    it('should return false for newly created active key', async () => {
      const dek = await encryptionManager.generateDataKey();
      expect(rotationManager.shouldRotate(dek)).toBe(false);
    });

    it('should return true for non-active key', async () => {
      const dek = await encryptionManager.generateDataKey();
      dek.status = 'rotated';
      expect(rotationManager.shouldRotate(dek)).toBe(true);
    });

    it('should return true for expired key', async () => {
      const dek = await encryptionManager.generateDataKey();
      dek.expiresAt = new Date(Date.now() - 1000); // 1秒前に期限切れ
      expect(rotationManager.shouldRotate(dek)).toBe(true);
    });

    it('should return true for key approaching expiration (>90%)', async () => {
      const now = new Date();
      const dek = await encryptionManager.generateDataKey();
      const lifetimeMs = dek.expiresAt.getTime() - dek.createdAt.getTime();

      // 作成日時を95%経過した時点に設定（現在時刻から逆算）
      dek.createdAt = new Date(now.getTime() - lifetimeMs * 0.95);
      // 有効期限も調整（経過時間の5%分先）
      dek.expiresAt = new Date(now.getTime() + lifetimeMs * 0.05);

      expect(rotationManager.shouldRotate(dek)).toBe(true);
    });

    it('should return false for key at 80% of lifetime', async () => {
      const now = new Date();
      const dek = await encryptionManager.generateDataKey();
      const lifetimeMs = dek.expiresAt.getTime() - dek.createdAt.getTime();

      // 作成日時を80%経過した時点に設定（現在時刻から逆算）
      dek.createdAt = new Date(now.getTime() - lifetimeMs * 0.8);
      // 有効期限も調整（経過時間の20%分先）
      dek.expiresAt = new Date(now.getTime() + lifetimeMs * 0.2);

      expect(rotationManager.shouldRotate(dek)).toBe(false);
    });
  });

  describe('rotateDataKey', () => {
    it('should successfully rotate a data key', async () => {
      const oldDek = await encryptionManager.generateDataKey();
      const plaintext = 'Confidential data';
      const oldEncrypted = await encryptionManager.encrypt(plaintext, oldDek);

      const { newDek, newEncryptedData } = await rotationManager.rotateDataKey(oldDek, oldEncrypted);

      // 新しいキーが生成されていることを確認
      expect(newDek.id).not.toBe(oldDek.id);
      expect(newDek.status).toBe('active');

      // 新しいキーでデータが復号化できることを確認
      const decrypted = await encryptionManager.decrypt(newEncryptedData, newDek);
      expect(decrypted.toString('utf8')).toBe(plaintext);

      // 古いキーはキャッシュから削除されている
      // （直接確認はできないが、内部的に削除されている）
    });

    it('should preserve data integrity during rotation', async () => {
      const oldDek = await encryptionManager.generateDataKey();
      const plaintext = 'Important information';
      const oldEncrypted = await encryptionManager.encrypt(plaintext, oldDek);

      // 元のデータを復号化して確認
      const originalDecrypted = await encryptionManager.decrypt(oldEncrypted, oldDek);
      expect(originalDecrypted.toString('utf8')).toBe(plaintext);

      // ローテーション実行
      const { newDek, newEncryptedData } = await rotationManager.rotateDataKey(oldDek, oldEncrypted);

      // ローテーション後のデータを復号化して確認
      const rotatedDecrypted = await encryptionManager.decrypt(newEncryptedData, newDek);
      expect(rotatedDecrypted.toString('utf8')).toBe(plaintext);

      // 元のデータと同じであることを確認
      expect(rotatedDecrypted.equals(originalDecrypted)).toBe(true);
    });

    it('should handle binary data during rotation', async () => {
      const oldDek = await encryptionManager.generateDataKey();
      const plaintext = Buffer.from([0xff, 0x00, 0xaa, 0x55]);
      const oldEncrypted = await encryptionManager.encrypt(plaintext, oldDek);

      const { newDek, newEncryptedData } = await rotationManager.rotateDataKey(oldDek, oldEncrypted);

      const decrypted = await encryptionManager.decrypt(newEncryptedData, newDek);
      expect(decrypted.equals(plaintext)).toBe(true);
    });
  });
});

describe('Integration: Full encryption workflow', () => {
  it('should complete full encryption lifecycle', async () => {
    // 1. マスターキープロバイダーを初期化
    const masterKeyHex = '3'.repeat(KEY_LENGTH * 2);
    const provider = new LocalMasterKeyProvider(masterKeyHex);

    // 2. 暗号化マネージャーを作成
    const encryptionManager = new EncryptionManager(provider);

    // 3. データ暗号化キーを生成
    const dek = await encryptionManager.generateDataKey();

    // 4. データを暗号化
    const sensitiveData = 'User private information';
    const encrypted = await encryptionManager.encrypt(sensitiveData, dek);

    // 5. データを復号化
    const decrypted = await encryptionManager.decrypt(encrypted, dek);
    expect(decrypted.toString('utf8')).toBe(sensitiveData);

    // 6. キーローテーションマネージャーを作成
    const rotationManager = new KeyRotationManager(encryptionManager);

    // 7. キーをローテーション
    const { newDek, newEncryptedData } = await rotationManager.rotateDataKey(dek, encrypted);

    // 8. 新しいキーでデータを復号化
    const finalDecrypted = await encryptionManager.decrypt(newEncryptedData, newDek);
    expect(finalDecrypted.toString('utf8')).toBe(sensitiveData);

    // 9. キャッシュをクリア
    encryptionManager.clearKeyCache();
  });
});
