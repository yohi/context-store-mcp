/**
 * データ暗号化モジュール
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
import { LRUCache } from '../mcp/lru-cache.js';

/**
 * 暗号化アルゴリズムと設定
 */
export const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
export const IV_LENGTH = 12; // GCMモードでは12バイトが推奨
export const AUTH_TAG_LENGTH = 16; // 認証タグは16バイト
export const KEY_LENGTH = 32; // AES-256は32バイト（256ビット）

/**
 * AAD（Additional Authenticated Data）のメタデータ
 */
export interface AADMetadata {
  /** データ暗号化キーID */
  keyId: string;
  /** 暗号化アルゴリズム */
  algorithm: string;
  /** データ作成タイムスタンプ */
  createdAt: string;
  /** キーバージョン */
  keyVersion: number;
  /** オプション: レコードID（追加コンテキスト） */
  recordId?: string;
}

/**
 * AAD用の決定論的ハッシュを生成
 *
 * メタデータの完全性を保護するためにSHA-256ハッシュを使用します。
 * これにより、keyId、algorithm、createdAt、keyVersion、recordIdの
 * いずれかが改ざんされた場合に復号化が失敗します。
 *
 * @param metadata AADメタデータ
 * @returns 決定論的なハッシュ（Buffer）
 */
export function generateAAD(metadata: AADMetadata): Buffer {
  // メタデータを決定論的な順序でシリアライズ
  // JSONキーの順序を保証するため、明示的に構築
  const data = {
    algorithm: metadata.algorithm,
    createdAt: metadata.createdAt,
    keyId: metadata.keyId,
    keyVersion: metadata.keyVersion,
    ...(metadata.recordId !== undefined && { recordId: metadata.recordId }),
  };

  // JSON文字列化（キーはアルファベット順にソート済み）
  const serialized = JSON.stringify(data);

  // SHA-256ハッシュで決定論的な表現を作成
  return crypto.createHash('sha256').update(serialized, 'utf8').digest();
}

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
  /** キーバージョン（ローテーション追跡用） */
  keyVersion: number;
  /** データ作成タイムスタンプ（AAD用） */
  createdAt: string;
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
  /** キーバージョン（ローテーション追跡用） */
  version: number;
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
  private keyVersion: number = 1;

  constructor(masterKeyHex?: string) {
    // 本番環境でのLocalMasterKeyProvider使用を禁止
    // 本番環境ではAWS KMS、HashiCorp Vault、Azure Key Vaultなどを使用すること
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error(
        'LocalMasterKeyProvider is not allowed in production environment. ' +
        'Use a proper key management service (AWS KMS, HashiCorp Vault, Azure Key Vault, etc.) instead.'
      );
    }

    // 環境変数からマスターキーを取得、なければ生成（開発用）
    if (masterKeyHex) {
      // 厳密な形式検証: 正確に64文字の16進数文字列であることを確認
      const hexPattern = /^[0-9a-fA-F]{64}$/;
      if (!hexPattern.test(masterKeyHex)) {
        throw new Error(
          'Master key must be exactly 64 hexadecimal characters (0-9, a-f, A-F). ' +
          `Received ${masterKeyHex.length} characters.`
        );
      }
      this.masterKey = Buffer.from(masterKeyHex, 'hex');
    } else {
      this.masterKey = crypto.randomBytes(KEY_LENGTH);
      console.warn(
        'Warning: Using randomly generated master key. ' +
        'Set MASTER_KEY_HEX environment variable for persistent encryption.'
      );
    }

    // 防御的深層チェック: Buffer長を最終確認
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

    // IVとAuthTagの長さを明示的に検証
    if (iv.length !== IV_LENGTH) {
      throw new Error(`Invalid ciphertext: bad IV length (expected ${IV_LENGTH}, got ${iv.length})`);
    }
    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error(`Invalid ciphertext: bad auth tag length (expected ${AUTH_TAG_LENGTH}, got ${authTag.length})`);
    }

    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, this.masterKey, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  async generateDataKey(): Promise<{ plaintext: Buffer; encrypted: Buffer }> {
    const plaintext = crypto.randomBytes(KEY_LENGTH);
    const encrypted = await this.encrypt(plaintext);
    return { plaintext, encrypted };
  }

  /**
   * CMKローテーション
   *
   * ## キーローテーション戦略
   *
   * ### 概要
   * CMK（カスタマーマスターキー）のローテーションは、セキュリティベストプラクティスとして
   * 定期的に実施すべきです。ローテーションプロセスには以下のステップが含まれます。
   *
   * ### ローテーション手順
   *
   * 1. **新しいCMKの生成**
   *    - 新しい256ビットAESキーを暗号学的に安全な乱数生成器で作成
   *    - キーバージョンをインクリメント（例: v1 → v2）
   *
   * 2. **既存DEKの再暗号化**
   *    - すべての既存DEK（データ暗号化キー）を列挙
   *    - 各DEKを以下の手順で処理:
   *      a. 古いCMKで暗号化されたDEKを復号化して平文DEKを取得
   *      b. 新しいCMKで平文DEKを再暗号化
   *      c. DEKメタデータ（version, rotatedAt）を更新
   *      d. データベースに保存
   *
   * 3. **古いCMKの保持期間**
   *    - 古いCMKは即座に削除せず、一定期間（例: 30日）保持
   *    - 保持期間中は読み取り専用モード（復号化のみ可能）
   *    - すべてのDEKが新しいCMKで再暗号化されたことを確認後、削除
   *
   * 4. **バージョン管理**
   *    - CMKにバージョン番号を付与（例: v1, v2, v3...）
   *    - DEKメタデータに使用したCMKバージョンを記録
   *    - 復号化時に適切なCMKバージョンを選択
   *
   * 5. **ロールバック対応**
   *    - ローテーション失敗時のロールバック手順を定義
   *    - トランザクション的な処理（部分的成功を避ける）
   *    - 監査ログへの記録
   *
   * ### 実装要件（本番環境）
   *
   * - **DEKストレージインターフェース**: すべてのDEKを列挙・更新するためのDB接続
   * - **CMK履歴管理**: 複数バージョンのCMKを安全に保存・取得する仕組み
   * - **アトミック更新**: DEK再暗号化の失敗時にロールバック可能な仕組み
   * - **監査ログ**: ローテーション操作のすべてを記録
   * - **KMS統合**: AWS KMS/Vault等での自動ローテーション機能の利用
   *
   * ### LocalMasterKeyProviderの制限
   *
   * このローカル実装は開発/テスト用であり、以下の理由から完全なローテーションは
   * サポートしていません:
   *
   * - DEKストレージへのアクセス手段がない（EncryptionManagerが管理）
   * - 複数CMKバージョンの永続化機能がない（メモリ上のみ）
   * - 本番環境では使用不可（constructorで禁止）
   *
   * **本番環境では、AWS KMS、HashiCorp Vault、Azure Key Vault等の
   * 適切な鍵管理サービスを使用し、その自動ローテーション機能を利用してください。**
   */
  async rotateKey(): Promise<void> {
    // ローカル実装の制限事項を警告
    console.warn(
      'Warning: LocalMasterKeyProvider.rotateKey() has limited functionality.\n' +
      'For production use, implement a proper MasterKeyProvider with KMS integration.\n' +
      'See method documentation for complete rotation strategy.'
    );

    // キーバージョンのインクリメント（基本的なバージョン追跡のみ）
    this.keyVersion += 1;

    // 新しいマスターキーを生成
    this.masterKey = crypto.randomBytes(KEY_LENGTH);

    console.log(
      `Master key rotated to version ${this.keyVersion}.\n` +
      'Note: Existing DEKs must be manually re-encrypted with the new CMK.\n' +
      'This is a development-only implementation. Use a proper KMS in production.'
    );

    // 実装ノート: 完全なローテーション実装には以下が必要:
    // 1. DEKストレージへのアクセス（現在はEncryptionManagerが管理）
    // 2. すべてのDEKを列挙して再暗号化するループ
    // 3. 古いCMKの保持とバージョン管理
    // 4. トランザクション処理とロールバック
    // 5. 監査ログへの記録
  }

  /**
   * 現在のキーバージョンを取得
   */
  getKeyVersion(): number {
    return this.keyVersion;
  }
}

/**
 * エンベロープ暗号化マネージャーの設定
 */
export interface EncryptionManagerConfig {
  /** キャッシュの最大サイズ（デフォルト: 100） */
  maxCacheSize?: number;
  /** キャッシュエントリの有効期限（ミリ秒、デフォルト: 1時間） */
  cacheMaxAge?: number;
}

/**
 * エンベロープ暗号化マネージャー
 */
export class EncryptionManager {
  private masterKeyProvider: MasterKeyProvider;
  private dataKeyCache: LRUCache<Buffer>;

  constructor(masterKeyProvider: MasterKeyProvider, config?: EncryptionManagerConfig) {
    this.masterKeyProvider = masterKeyProvider;

    // LRUキャッシュの設定（退避時にBufferをゼロクリア）
    this.dataKeyCache = new LRUCache<Buffer>({
      maxSize: config?.maxCacheSize ?? 100,
      maxAge: config?.cacheMaxAge ?? 60 * 60 * 1000, // デフォルト1時間
      onEvict: (_keyId: string, keyBuffer: Buffer) => {
        // セキュリティのため、退避時にキーをゼロクリア
        keyBuffer.fill(0);
      },
    });
  }

  /**
   * 新しいDEKを生成
   */
  async generateDataKey(): Promise<DataEncryptionKey> {
    const { plaintext, encrypted } = await this.masterKeyProvider.generateDataKey();
    const keyId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 365日後

    // キーをLRUキャッシュに保存
    this.dataKeyCache.set(keyId, plaintext);

    return {
      id: keyId,
      encryptedKey: encrypted.toString('base64'),
      version: 1, // 新規キーはバージョン1から開始
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
    const cachedKey = this.dataKeyCache.get(dek.id);
    if (cachedKey) {
      return cachedKey;
    }

    // CMKを使ってDEKを復号化
    const encryptedKeyBuffer = Buffer.from(dek.encryptedKey, 'base64');
    const plaintextKey = await this.masterKeyProvider.decrypt(encryptedKeyBuffer);

    // LRUキャッシュに保存
    this.dataKeyCache.set(dek.id, plaintextKey);

    return plaintextKey;
  }

  /**
   * データを暗号化
   *
   * @param plaintext 暗号化する平文データ
   * @param dek データ暗号化キー
   * @param recordId オプション: レコードID（AADに追加コンテキストとして含める）
   * @returns 暗号化されたデータ
   */
  async encrypt(
    plaintext: string | Buffer,
    dek: DataEncryptionKey,
    recordId?: string
  ): Promise<EncryptedData> {
    // DEKを取得（必要に応じて復号化）
    const dataKey = await this.loadDataKey(dek);

    // データをBufferに変換
    const plaintextBuffer = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;

    // データ作成タイムスタンプ（AAD用）
    const createdAt = new Date().toISOString();

    // IVを生成
    const iv = crypto.randomBytes(IV_LENGTH);

    // AADメタデータを構築
    const aadMetadata: AADMetadata = {
      keyId: dek.id,
      algorithm: ENCRYPTION_ALGORITHM,
      createdAt,
      keyVersion: dek.version,
      ...(recordId !== undefined && { recordId }),
    };

    // 決定論的なAADハッシュを生成
    const aad = generateAAD(aadMetadata);

    // 暗号化（AADでメタデータを完全性保護）
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, dataKey, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      keyId: dek.id,
      algorithm: ENCRYPTION_ALGORITHM,
      keyVersion: dek.version,
      createdAt,
      encryptedAt: new Date().toISOString(),
    };
  }

  /**
   * データを復号化
   *
   * @param encryptedData 暗号化されたデータ
   * @param dek データ暗号化キー
   * @param recordId オプション: レコードID（AAD検証用、暗号化時に指定した場合は必須）
   * @returns 復号化された平文データ
   */
  async decrypt(
    encryptedData: EncryptedData,
    dek: DataEncryptionKey,
    recordId?: string
  ): Promise<Buffer> {
    // キーIDの検証
    if (encryptedData.keyId !== dek.id) {
      throw new Error('Key ID mismatch');
    }

    // アルゴリズムの検証
    if (encryptedData.algorithm !== ENCRYPTION_ALGORITHM) {
      throw new Error(`Unsupported algorithm: ${encryptedData.algorithm}`);
    }

    // キーバージョンの検証
    if (encryptedData.keyVersion !== dek.version) {
      throw new Error(
        `Key version mismatch: encrypted with version ${encryptedData.keyVersion}, ` +
        `but DEK is version ${dek.version}`
      );
    }

    // DEKを取得（必要に応じて復号化）
    const dataKey = await this.loadDataKey(dek);

    // Base64からBufferに変換
    const ciphertext = Buffer.from(encryptedData.ciphertext, 'base64');
    const iv = Buffer.from(encryptedData.iv, 'base64');
    const authTag = Buffer.from(encryptedData.authTag, 'base64');

    // IVとAuthTagの長さを明示的に検証（Base64デコード後）
    if (iv.length !== IV_LENGTH) {
      throw new Error(`Invalid ciphertext: bad IV length (expected ${IV_LENGTH}, got ${iv.length})`);
    }
    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error(`Invalid ciphertext: bad auth tag length (expected ${AUTH_TAG_LENGTH}, got ${authTag.length})`);
    }

    // AADメタデータを再構築（暗号化時と同じ順序で）
    const aadMetadata: AADMetadata = {
      keyId: encryptedData.keyId,
      algorithm: encryptedData.algorithm,
      createdAt: encryptedData.createdAt,
      keyVersion: encryptedData.keyVersion,
      ...(recordId !== undefined && { recordId }),
    };

    // 決定論的なAADハッシュを生成（暗号化時と同じ値になるはず）
    const aad = generateAAD(aadMetadata);

    // 復号化（AADでメタデータ完全性を検証）
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, dataKey, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  /**
   * データキーキャッシュをクリア（セキュリティ対策）
   */
  clearKeyCache(): void {
    // LRUキャッシュのクリア（onEvictコールバックで自動的にゼロクリアされる）
    this.dataKeyCache.clear();
  }

  /**
   * 特定のキーをキャッシュから削除
   */
  evictKey(keyId: string): void {
    // LRUキャッシュから削除（onEvictコールバックで自動的にゼロクリアされる）
    this.dataKeyCache.delete(keyId);
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

    // タイムスタンプ破損チェック: lifetimeMs が 0 以下の場合
    if (lifetimeMs <= 0) {
      console.warn(
        `Warning: Invalid DEK timestamps detected (id: ${dek.id}). ` +
        `createdAt: ${dek.createdAt.toISOString()}, ` +
        `expiresAt: ${dek.expiresAt.toISOString()}. ` +
        `Forcing rotation due to corrupted or reversed timestamps.`
      );
      return true; // タイムスタンプが破損している場合は強制ローテーション
    }

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
