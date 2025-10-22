/**
 * Data Encryption Module
 *
 * AES-256-GCM暗号化とエンベロープ暗号化パターンを実装
 *
 * 要件:
 * - AES-256-GCM暗号化アルゴリズム
 * - エンベロープ暗号化（DEK + CMK）
 * - キーローテーション対応
 * - 暗号化メタデータ管理
 */

import crypto from 'crypto';

/**
 * 暗号化アルゴリズムと設定
 */
export const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
export const IV_LENGTH = 12; // GCMモードでは12バイトが推奨
export const AUTH_TAG_LENGTH = 16; // 認証タグは16バイト
export const KEY_LENGTH = 32; // AES-256は32バイト（256ビット）

/**
 * 暗号化されたデータの構造
 */
export interface EncryptedData {
  /** 暗号化されたデータ（Base64エンコード） */
  ciphertext: string;
  /** 初期化ベクトル（Base64エンコード） */
  iv: string;
  /** 認証タグ（Base64エンコード） */
  authTag: string;
  /** データ暗号化キーID */
  keyId: string;
  /** 暗号化アルゴリズム */
  algorithm: string;
  /** 暗号化タイムスタンプ */
  encryptedAt: string;
}

/**
 * データ暗号化キー（DEK）の情報
 */
export interface DataEncryptionKey {
  /** キーID（UUID） */
  id: string;
  /** 暗号化されたDEK（CMKで暗号化、Base64エンコード） */
  encryptedKey: string;
  /** キー作成日時 */
  createdAt: Date;
  /** キーローテーション日時 */
  rotatedAt?: Date;
  /** キーの有効期限 */
  expiresAt: Date;
  /** キーのステータス */
  status: 'active' | 'rotated' | 'expired' | 'compromised';
}

/**
 * カスタマーマスターキー（CMK）プロバイダーインターフェース
 */
export interface MasterKeyProvider {
  /** CMKでDEKを暗号化 */
  encrypt(plaintext: Buffer): Promise<Buffer>;
  /** CMKでDEKを復号化 */
  decrypt(ciphertext: Buffer): Promise<Buffer>;
  /** 新しいDEKを生成 */
  generateDataKey(): Promise<{ plaintext: Buffer; encrypted: Buffer }>;
  /** CMKをローテーション */
  rotateKey(): Promise<void>;
}

/**
 * ローカル開発用のMasterKeyProvider実装
 * 本番環境ではAWS KMSやHashiCorp Vaultを使用
 */
export class LocalMasterKeyProvider implements MasterKeyProvider {
  private masterKey: Buffer;

  constructor(masterKeyHex?: string) {
    // 環境変数からマスターキーを取得、なければ生成（開発用）
    if (masterKeyHex) {
      this.masterKey = Buffer.from(masterKeyHex, 'hex');
    } else {
      this.masterKey = crypto.randomBytes(KEY_LENGTH);
      console.warn(
        'Warning: Using randomly generated master key. ' +
          'Set MASTER_KEY_HEX environment variable for persistent encryption.'
      );
    }

    if (this.masterKey.length !== KEY_LENGTH) {
      throw new Error(`Master key must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 8} bits)`);
    }
  }

  async encrypt(plaintext: Buffer): Promise<Buffer> {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, this.masterKey, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // IV + AuthTag + Ciphertext の形式で返す
    return Buffer.concat([iv, authTag, encrypted]);
  }

  async decrypt(ciphertext: Buffer): Promise<Buffer> {
    if (ciphertext.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('Invalid ciphertext: too short');
    }

    const iv = ciphertext.subarray(0, IV_LENGTH);
    const authTag = ciphertext.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = ciphertext.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, this.masterKey, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  async generateDataKey(): Promise<{ plaintext: Buffer; encrypted: Buffer }> {
    const plaintext = crypto.randomBytes(KEY_LENGTH);
    const encrypted = await this.encrypt(plaintext);
    return { plaintext, encrypted };
  }

  async rotateKey(): Promise<void> {
    // ローカル実装ではキーローテーションは手動で実施
    console.log('Master key rotation should be performed manually in local provider');
  }
}

/**
 * エンベロープ暗号化マネージャー
 */
export class EncryptionManager {
  private masterKeyProvider: MasterKeyProvider;
  private dataKeyCache: Map<string, Buffer> = new Map();

  constructor(masterKeyProvider: MasterKeyProvider) {
    this.masterKeyProvider = masterKeyProvider;
  }

  /**
   * 新しいDEKを生成
   */
  async generateDataKey(): Promise<DataEncryptionKey> {
    const { plaintext, encrypted } = await this.masterKeyProvider.generateDataKey();
    const keyId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 365日後

    // キーをキャッシュに保存
    this.dataKeyCache.set(keyId, plaintext);

    return {
      id: keyId,
      encryptedKey: encrypted.toString('base64'),
      createdAt: now,
      expiresAt,
      status: 'active',
    };
  }

  /**
   * DEKを復号化してキャッシュに保存
   */
  private async loadDataKey(dek: DataEncryptionKey): Promise<Buffer> {
    // キャッシュに存在する場合は再利用
    if (this.dataKeyCache.has(dek.id)) {
      return this.dataKeyCache.get(dek.id)!;
    }

    // CMKを使ってDEKを復号化
    const encryptedKeyBuffer = Buffer.from(dek.encryptedKey, 'base64');
    const plaintextKey = await this.masterKeyProvider.decrypt(encryptedKeyBuffer);

    // キャッシュに保存
    this.dataKeyCache.set(dek.id, plaintextKey);

    return plaintextKey;
  }

  /**
   * データを暗号化
   */
  async encrypt(plaintext: string | Buffer, dek: DataEncryptionKey): Promise<EncryptedData> {
    // DEKを取得（必要に応じて復号化）
    const dataKey = await this.loadDataKey(dek);

    // データをBufferに変換
    const plaintextBuffer = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;

    // IVを生成
    const iv = crypto.randomBytes(IV_LENGTH);

    // 暗号化
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, dataKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      keyId: dek.id,
      algorithm: ENCRYPTION_ALGORITHM,
      encryptedAt: new Date().toISOString(),
    };
  }

  /**
   * データを復号化
   */
  async decrypt(encryptedData: EncryptedData, dek: DataEncryptionKey): Promise<Buffer> {
    // キーIDの検証
    if (encryptedData.keyId !== dek.id) {
      throw new Error('Key ID mismatch');
    }

    // アルゴリズムの検証
    if (encryptedData.algorithm !== ENCRYPTION_ALGORITHM) {
      throw new Error(`Unsupported algorithm: ${encryptedData.algorithm}`);
    }

    // DEKを取得（必要に応じて復号化）
    const dataKey = await this.loadDataKey(dek);

    // Base64からBufferに変換
    const ciphertext = Buffer.from(encryptedData.ciphertext, 'base64');
    const iv = Buffer.from(encryptedData.iv, 'base64');
    const authTag = Buffer.from(encryptedData.authTag, 'base64');

    // 復号化
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, dataKey, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  /**
   * データキーキャッシュをクリア（セキュリティ対策）
   */
  clearKeyCache(): void {
    // メモリ上のキーをゼロクリア
    for (const key of this.dataKeyCache.values()) {
      key.fill(0);
    }
    this.dataKeyCache.clear();
  }

  /**
   * 特定のキーをキャッシュから削除
   */
  evictKey(keyId: string): void {
    const key = this.dataKeyCache.get(keyId);
    if (key) {
      key.fill(0); // ゼロクリア
      this.dataKeyCache.delete(keyId);
    }
  }
}

/**
 * キーローテーション管理
 */
export class KeyRotationManager {
  private encryptionManager: EncryptionManager;

  constructor(encryptionManager: EncryptionManager) {
    this.encryptionManager = encryptionManager;
  }

  /**
   * キーのローテーションが必要かチェック
   */
  shouldRotate(dek: DataEncryptionKey): boolean {
    const now = new Date();

    // ステータスチェック
    if (dek.status !== 'active') {
      return true;
    }

    // 有効期限チェック
    if (dek.expiresAt <= now) {
      return true;
    }

    // 365日の90%（約328日）経過でローテーション推奨
    const lifetimeMs = dek.expiresAt.getTime() - dek.createdAt.getTime();
    const elapsedMs = now.getTime() - dek.createdAt.getTime();
    const rotationThreshold = 0.9;

    return elapsedMs / lifetimeMs >= rotationThreshold;
  }

  /**
   * データキーをローテーション
   *
   * @param oldDek 古いDEK
   * @param encryptedData 暗号化されたデータ
   * @returns 新しいDEKと再暗号化されたデータ
   */
  async rotateDataKey(
    oldDek: DataEncryptionKey,
    encryptedData: EncryptedData
  ): Promise<{ newDek: DataEncryptionKey; newEncryptedData: EncryptedData }> {
    // 既存データを復号化
    const plaintext = await this.encryptionManager.decrypt(encryptedData, oldDek);

    // 新しいDEKを生成
    const newDek = await this.encryptionManager.generateDataKey();

    // 新しいDEKで再暗号化
    const newEncryptedData = await this.encryptionManager.encrypt(plaintext, newDek);

    // 復号化した平文をゼロクリア
    plaintext.fill(0);

    // 古いキーをキャッシュから削除
    this.encryptionManager.evictKey(oldDek.id);

    return { newDek, newEncryptedData };
  }
}
