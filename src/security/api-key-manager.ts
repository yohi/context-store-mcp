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
 */

import crypto from 'crypto';

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
 * APIキーの情報
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
 * APIキー検証結果
 */
export interface ApiKeyValidationResult {
  /** 検証が成功したか */
  valid: boolean;
  /** キー情報（検証成功時） */
  key?: ApiKey;
  /** エラー理由（検証失敗時） */
  reason?: 'invalid_format' | 'not_found' | 'revoked' | 'expired' | 'hash_mismatch';
}

/**
 * Base62エンコード
 */
function encodeBase62(buffer: Buffer): string {
  let num = BigInt('0x' + buffer.toString('hex'));
  let encoded = '';

  while (num > 0n) {
    const remainder = Number(num % 62n);
    encoded = BASE62_CHARS[remainder] + encoded;
    num = num / 62n;
  }

  return encoded || BASE62_CHARS[0];
}

/**
 * APIキー管理マネージャー
 */
export class ApiKeyManager {
  private keys: Map<string, ApiKey> = new Map();

  /**
   * 新しいAPIキーを生成
   *
   * @param name キー名
   * @param scopes 権限スコープ
   * @param expiresIn 有効期限（ミリ秒）
   * @returns 生成されたキーと平文のAPIキー
   */
  generateApiKey(
    name: string,
    scopes: string[] = ['read', 'write'],
    expiresIn?: number
  ): { key: ApiKey; plainKey: string } {
    // ランダムなバイト列を生成
    const randomBytes = crypto.randomBytes(KEY_RANDOM_BYTES);
    const randomPart = encodeBase62(randomBytes);

    // APIキーを構築
    const plainKey = `${API_KEY_PREFIX}_${API_KEY_VERSION}_${randomPart}`;

    // キーをハッシュ化（SHA-256）
    const hashedKey = crypto.createHash('sha256').update(plainKey).digest('hex');

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
      expiresAt,
      status: 'active',
      scopes,
    };

    // メモリに保存（実際はデータベースに保存）
    this.keys.set(hashedKey, key);

    return { key, plainKey };
  }

  /**
   * APIキーを検証
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

    // キーをハッシュ化
    const hashedKey = crypto.createHash('sha256').update(plainKey).digest('hex');

    // データベースから取得（ここではメモリから）
    const key = this.keys.get(hashedKey);

    if (!key) {
      return { valid: false, reason: 'not_found' };
    }

    // ステータスチェック
    if (key.status === 'revoked') {
      return { valid: false, key, reason: 'revoked' };
    }

    // 有効期限チェック
    if (key.expiresAt && key.expiresAt <= new Date()) {
      // 期限切れの場合、ステータスを更新
      key.status = 'expired';
      return { valid: false, key, reason: 'expired' };
    }

    // 最終使用日時を更新
    key.lastUsedAt = new Date();

    return { valid: true, key };
  }

  /**
   * APIキーを無効化（取り消し）
   *
   * @param keyId キーID
   * @returns 成功したか
   */
  revokeApiKey(keyId: string): boolean {
    for (const key of this.keys.values()) {
      if (key.id === keyId) {
        key.status = 'revoked';
        return true;
      }
    }
    return false;
  }

  /**
   * ユーザーの全APIキーを取得
   *
   * @param userId ユーザーID（メタデータに保存されている想定）
   * @returns APIキーのリスト
   */
  listApiKeys(userId?: string): ApiKey[] {
    const result: ApiKey[] = [];

    for (const key of this.keys.values()) {
      // ユーザーIDでフィルタリング
      if (userId && key.metadata?.userId !== userId) {
        continue;
      }
      result.push(key);
    }

    return result;
  }

  /**
   * 期限切れキーのクリーンアップ
   *
   * @returns 削除されたキーの数
   */
  cleanupExpiredKeys(): number {
    const now = new Date();
    let count = 0;

    for (const [hashedKey, key] of this.keys.entries()) {
      if (key.expiresAt && key.expiresAt <= now) {
        // 期限切れから30日経過したキーを削除
        const gracePeriodMs = 30 * 24 * 60 * 60 * 1000; // 30日
        if (now.getTime() - key.expiresAt.getTime() > gracePeriodMs) {
          this.keys.delete(hashedKey);
          count++;
        } else if (key.status !== 'expired') {
          // ステータスを更新
          key.status = 'expired';
        }
      }
    }

    return count;
  }

  /**
   * APIキーをローテーション
   *
   * 古いキーを無効化し、新しいキーを生成
   *
   * @param oldKeyId 古いキーID
   * @returns 新しいキーと平文のAPIキー
   */
  rotateApiKey(oldKeyId: string, gracePeriodMs: number = 30 * 24 * 60 * 60 * 1000): { key: ApiKey; plainKey: string } | null {
    // 古いキーを検索
    let oldKey: ApiKey | undefined;
    for (const key of this.keys.values()) {
      if (key.id === oldKeyId) {
        oldKey = key;
        break;
      }
    }

    if (!oldKey) {
      return null;
    }

    // 新しいキーを生成
    const expiresIn = oldKey.expiresAt ? oldKey.expiresAt.getTime() - oldKey.createdAt.getTime() : undefined;
    const newKeyData = this.generateApiKey(oldKey.name, oldKey.scopes, expiresIn);

    // メタデータを引き継ぐ
    if (oldKey.metadata) {
      newKeyData.key.metadata = { ...oldKey.metadata };
    }

    // 古いキーに猶予期間を設定して無効化
    if (!oldKey.expiresAt || oldKey.expiresAt.getTime() - Date.now() > gracePeriodMs) {
      oldKey.expiresAt = new Date(Date.now() + gracePeriodMs);
    }

    return newKeyData;
  }

  /**
   * APIキーの統計情報を取得
   */
  getStatistics(): {
    total: number;
    active: number;
    revoked: number;
    expired: number;
  } {
    let active = 0;
    let revoked = 0;
    let expired = 0;

    for (const key of this.keys.values()) {
      switch (key.status) {
        case 'active':
          active++;
          break;
        case 'revoked':
          revoked++;
          break;
        case 'expired':
          expired++;
          break;
      }
    }

    return {
      total: this.keys.size,
      active,
      revoked,
      expired,
    };
  }

  /**
   * テスト用：全キーをクリア
   */
  clearAll(): void {
    this.keys.clear();
  }
}
