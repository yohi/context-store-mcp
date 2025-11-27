/**
 * API Key Management Module
 *
 * APIキーの生成、検証、管理を実装
 *
 * 要件:
 * - セキュアなAPIキー生成
 * - ハッシュ化による保存
 * - TTL（Time To Live）管理
 * - レート制限との統合
 * - キーのローテーション
 * - PostgreSQL永続化（プロセス再起動時もデータ保持）
 */

import crypto from 'crypto';
import type { IApiKeyStoreAdapter } from '../storage/api-key-store-adapter.js';

/**
 * APIキーの形式
 * - プレフィックス: "csm_" (Context Store MCP)
 * - バージョン: "v1"
 * - ランダム部分: 32バイト（Base62エンコード）
 *
 * 例: csm_v1_7YHF9K2mPqW3nxRtL4sJ8vU6eN1aZ5bC
 */
const API_KEY_PREFIX = 'csm';
const API_KEY_VERSION = 'v1';
const KEY_RANDOM_BYTES = 32;

/**
 * Base62文字セット（数字+大文字+小文字、紛らわしい文字を除く）
 */
const BASE62_CHARS = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';

/**
 * セキュリティペッパーの検証と取得
 *
 * HMAC-SHA256用のシークレットペッパーを環境変数から取得し、検証します。
 * ペッパーが設定されていない場合は、明確なエラーメッセージと共に失敗します。
 *
 * @returns 検証済みシークレットペッパー
 * @throws {Error} ペッパーが設定されていない場合
 */
function validateAndGetPepper(): string {
  const pepper = process.env['API_KEY_PEPPER'];

  if (!pepper) {
    const errorMessage =
      'FATAL: API_KEY_PEPPER environment variable is not set. ' +
      'This is required for secure API key hashing with HMAC-SHA256. ' +
      'Please set a strong random secret (minimum 32 characters recommended). ' +
      'Example: export API_KEY_PEPPER="your-secure-random-secret-here"';

    console.error(errorMessage);
    throw new Error('API_KEY_PEPPER environment variable is required');
  }

  // 最低限の長さチェック（16文字以上を推奨）
  if (pepper.length < 16) {
    const warningMessage =
      'WARNING: API_KEY_PEPPER is shorter than recommended (< 16 characters). ' +
      'For better security, use a longer secret (32+ characters recommended).';
    console.warn(warningMessage);
  }

  return pepper;
}

/**
 * HMAC-SHA256を使用してAPIキーをハッシュ化
 *
 * @param plainKey 平文のAPIキー
 * @param pepper シークレットペッパー
 * @returns ハッシュ化されたキー（16進数文字列）
 */
function hashApiKeyWithHmac(plainKey: string, pepper: string): string {
  return crypto.createHmac('sha256', pepper).update(plainKey).digest('hex');
}

/**
 * レガシーSHA-256を使用してAPIキーをハッシュ化（移行用のみ）
 *
 * @param plainKey 平文のAPIキー
 * @returns ハッシュ化されたキー（16進数文字列）
 * @deprecated HMAC-SHA256に移行してください
 */
function hashApiKeyWithSha256(plainKey: string): string {
  return crypto.createHash('sha256').update(plainKey).digest('hex');
}

/**
 * APIキーの情報（内部使用のみ）
 */
export interface ApiKey {
  /** キーID（UUID） */
  id: string;
  /** キープレフィックス（表示用、例: csm_v1_7YHF） */
  keyPrefix: string;
  /** ハッシュ化されたキー（SHA-256） */
  hashedKey: string;
  /** キー名（ユーザー識別用） */
  name: string;
  /** 作成日時 */
  createdAt: Date;
  /** 最終使用日時 */
  lastUsedAt?: Date;
  /** 有効期限 */
  expiresAt?: Date;
  /** キーのステータス */
  status: 'active' | 'revoked' | 'expired';
  /** 権限スコープ */
  scopes: string[];
  /** メタデータ */
  metadata?: Record<string, unknown>;
}

/**
 * APIキーの公開ビュー（hashedKeyを含まない安全なビュー）
 *
 * hashedKeyは内部管理用のみであり、外部に公開すべきではありません。
 * このビューはAPIキー検証結果などで使用され、ハッシュ漏洩リスクを防ぎます。
 */
export interface ApiKeyView {
  /** キーID（UUID） */
  id: string;
  /** キープレフィックス（表示用、例: csm_v1_7YHF） */
  keyPrefix: string;
  /** キー名（ユーザー識別用） */
  name: string;
  /** 作成日時 */
  createdAt: Date;
  /** 最終使用日時 */
  lastUsedAt?: Date;
  /** 有効期限 */
  expiresAt?: Date;
  /** キーのステータス */
  status: 'active' | 'revoked' | 'expired';
  /** 権限スコープ */
  scopes: string[];
  /** メタデータ */
  metadata?: Record<string, unknown>;
}

/**
 * APIキー検証結果
 */
export interface ApiKeyValidationResult {
  /** 検証が成功したか */
  valid: boolean;
  /** キー情報（検証成功時、hashedKeyを含まない安全なビュー） */
  key?: ApiKeyView;
  /** エラー理由（検証失敗時） */
  reason?: 'invalid_format' | 'not_found' | 'revoked' | 'expired' | 'hash_mismatch';
}

/**
 * Base62エンコード
 */
function encodeBase62(buffer: Buffer): string {
  let num = BigInt('0x' + buffer.toString('hex'));
  let encoded: string = '';

  while (num > 0n) {
    const remainder = Number(num % 62n);
    encoded = BASE62_CHARS[remainder] + encoded;
    num = num / 62n;
  }

  if (encoded.length === 0) {
    return BASE62_CHARS[0] as string;
  }
  return encoded;
}

/**
 * ApiKeyをApiKeyViewに変換（hashedKeyを除外）
 *
 * hashedKeyは内部管理用のみであり、外部に公開すべきではないため、
 * 安全な公開ビューに変換します。
 *
 * @param key 内部APIキー情報
 * @returns hashedKeyを含まない安全なビュー
 */
function sanitizeApiKey(key: ApiKey): ApiKeyView {
  return {
    id: key.id,
    keyPrefix: key.keyPrefix,
    name: key.name,
    createdAt: key.createdAt,
    status: key.status,
    scopes: key.scopes,
    ...(key.lastUsedAt !== undefined ? { lastUsedAt: key.lastUsedAt } : {}),
    ...(key.expiresAt !== undefined ? { expiresAt: key.expiresAt } : {}),
    ...(key.metadata !== undefined ? { metadata: key.metadata } : {}),
  };
}

/**
 * APIキー管理マネージャー
 */
export class ApiKeyManager {
  private readonly pepper: string;
  private readonly store: IApiKeyStoreAdapter;

  /**
   * コンストラクタ
   *
   * 初期化時にAPI_KEY_PEPPERを検証します。
   * ペッパーが未設定の場合は例外をスローし、サービス起動を中止します。
   *
   * @param store ストレージアダプター（PostgreSQLまたはInMemory）
   * @throws {Error} API_KEY_PEPPERが未設定の場合
   */
  constructor(store: IApiKeyStoreAdapter) {
    // 初期化時にペッパーを検証（未設定の場合は起動時に失敗）
    this.pepper = validateAndGetPepper();
    this.store = store;
  }

  /**
   * 新しいAPIキーを生成
   *
   * @param name キー名
   * @param scopes 権限スコープ
   * @param expiresIn 有効期限（ミリ秒）
   * @returns 生成されたキーと平文のAPIキー
   */
  async generateApiKey(
    name: string,
    scopes: string[] = ['read', 'write'],
    expiresIn?: number
  ): Promise<{ key: ApiKey; plainKey: string }> {
    // ランダムなバイト列を生成
    const randomBytes = crypto.randomBytes(KEY_RANDOM_BYTES);
    const randomPart = encodeBase62(randomBytes);

    // APIキーを構築
    const plainKey = `${API_KEY_PREFIX}_${API_KEY_VERSION}_${randomPart}`;

    // キーをハッシュ化（HMAC-SHA256 with pepper）
    const hashedKey = hashApiKeyWithHmac(plainKey, this.pepper);

    // プレフィックス（表示用、最初の8文字）
    const keyPrefix = `${API_KEY_PREFIX}_${API_KEY_VERSION}_${randomPart.substring(0, 8)}`;

    const now = new Date();
    const expiresAt = expiresIn ? new Date(now.getTime() + expiresIn) : undefined;

    const key: ApiKey = {
      id: crypto.randomUUID(),
      keyPrefix,
      hashedKey,
      name,
      createdAt: now,
      status: 'active',
      scopes,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    };

    // データベースに保存（PostgreSQLで永続化）
    await this.store.store(key);

    return { key, plainKey };
  }

  /**
   * APIキーを検証（デュアルモード：HMAC優先、レガシーSHA-256フォールバック）
   *
   * 検証プロセス:
   * 1. HMAC-SHA256で検証を試みる（新しいキー）
   * 2. 失敗した場合、レガシーSHA-256で検証（古いキー）
   * 3. レガシーで成功した場合、HMAC-SHA256に自動移行
   *
   * @param plainKey 平文のAPIキー
   * @returns 検証結果
   */
  async validateApiKey(plainKey: string): Promise<ApiKeyValidationResult> {
    // フォーマット検証
    const parts = plainKey.split('_');
    if (parts.length !== 3 || parts[0] !== API_KEY_PREFIX || parts[1] !== API_KEY_VERSION) {
      return { valid: false, reason: 'invalid_format' };
    }

    // 1. HMAC-SHA256で検証を試みる（新しいキー）
    const hashedKeyHmac = hashApiKeyWithHmac(plainKey, this.pepper);
    let key = await this.store.findByHashedKey(hashedKeyHmac);

    if (key) {
      // HMAC-SHA256で見つかった（最新のキー）
      return this.validateKeyStatus(key);
    }

    // 2. レガシーSHA-256で検証（移行用フォールバック）
    const hashedKeySha256 = hashApiKeyWithSha256(plainKey);
    key = await this.store.findByHashedKey(hashedKeySha256);

    if (!key) {
      return { valid: false, reason: 'not_found' };
    }

    // レガシーキーが見つかった場合、ステータスを検証
    const statusResult = await this.validateKeyStatus(key);

    if (!statusResult.valid) {
      return statusResult;
    }

    // 3. 有効なレガシーキーをHMAC-SHA256に自動移行
    console.log(
      `Migrating legacy API key (ID: ${key.id}, prefix: ${key.keyPrefix}) ` +
        `from SHA-256 to HMAC-SHA256`
    );

    // 古いエントリを削除
    await this.store.deleteByHashedKey(hashedKeySha256);

    // 新しいハッシュで再保存
    key.hashedKey = hashedKeyHmac;
    await this.store.store(key);

    console.log(
      `Successfully migrated API key (ID: ${key.id}) to HMAC-SHA256. ` +
        `Old hash removed from storage.`
    );

    // hashedKeyを除外した安全なビューを返す
    return { valid: true, key: sanitizeApiKey(key) };
  }

  /**
   * APIキーのステータスを検証（共通ロジック）
   *
   * @param key APIキー
   * @returns 検証結果（hashedKeyを含まない安全なビュー）
   */
  private async validateKeyStatus(key: ApiKey): Promise<ApiKeyValidationResult> {
    // ステータスチェック
    if (key.status === 'revoked') {
      // hashedKeyを除外した安全なビューを返す
      return { valid: false, key: sanitizeApiKey(key), reason: 'revoked' };
    }

    // 有効期限チェック
    if (key.expiresAt && key.expiresAt <= new Date()) {
      // 期限切れの場合、ステータスを更新
      key.status = 'expired';
      await this.store.update(key);
      // hashedKeyを除外した安全なビューを返す
      return { valid: false, key: sanitizeApiKey(key), reason: 'expired' };
    }

    // 最終使用日時を更新
    key.lastUsedAt = new Date();
    await this.store.update(key);

    // hashedKeyを除外した安全なビューを返す
    return { valid: true, key: sanitizeApiKey(key) };
  }

  /**
   * APIキーを無効化（取り消し）
   *
   * @param keyId キーID
   * @returns 成功したか
   */
  async revokeApiKey(keyId: string): Promise<boolean> {
    const key = await this.store.findById(keyId);
    if (!key) {
      return false;
    }

    key.status = 'revoked';
    return await this.store.update(key);
  }

  /**
   * ユーザーの全APIキーを取得（公開ビュー、hashedKeyを含まない）
   *
   * hashedKeyは内部管理用のみであり、外部に公開すべきではありません。
   * このメソッドは安全なApiKeyViewを返します。
   *
   * @param userId ユーザーID（メタデータに保存されている想定）
   * @returns APIキーのリスト（hashedKeyを含まない安全なビュー）
   */
  async listApiKeys(userId?: string): Promise<ApiKeyView[]> {
    const rawKeys = await this.store.findAll(userId);
    return rawKeys.map((key) => sanitizeApiKey(key));
  }

  /**
   * 期限切れキーのクリーンアップ
   *
   * @returns 削除されたキーの数
   */
  async cleanupExpiredKeys(): Promise<number> {
    const gracePeriodMs = 30 * 24 * 60 * 60 * 1000; // 30日
    return await this.store.cleanupExpired(gracePeriodMs);
  }

  /**
   * APIキーをローテーション
   *
   * 古いキーを無効化し、新しいキーを生成
   *
   * @param oldKeyId 古いキーID
   * @returns 新しいキーと平文のAPIキー
   */
  async rotateApiKey(oldKeyId: string, gracePeriodMs: number = 30 * 24 * 60 * 60 * 1000): Promise<{ key: ApiKey; plainKey: string } | null> {
    // 古いキーを検索
    const oldKey = await this.store.findById(oldKeyId);

    if (!oldKey) {
      return null;
    }

    // 新しいキーを生成
    const expiresIn = oldKey.expiresAt ? oldKey.expiresAt.getTime() - oldKey.createdAt.getTime() : undefined;
    const newKeyData = await this.generateApiKey(oldKey.name, oldKey.scopes, expiresIn);

    // メタデータを引き継ぐ
    if (oldKey.metadata) {
      newKeyData.key.metadata = { ...oldKey.metadata };
      await this.store.update(newKeyData.key);
    }

    // 古いキーに猶予期間を設定して無効化
    if (!oldKey.expiresAt || oldKey.expiresAt.getTime() - Date.now() > gracePeriodMs) {
      oldKey.expiresAt = new Date(Date.now() + gracePeriodMs);
      await this.store.update(oldKey);
    }

    return newKeyData;
  }

  /**
   * APIキーの統計情報を取得
   */
  async getStatistics(): Promise<{
    total: number;
    active: number;
    revoked: number;
    expired: number;
  }> {
    return await this.store.getStatistics();
  }
}
