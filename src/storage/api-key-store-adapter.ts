/**
 * API Key Store Adapter
 *
 * APIキーの永続化層を提供するストレージアダプター
 * PostgreSQLを使用した ACID準拠の永続化を実装
 *
 * 設計原則:
 * - プロセス再起動時もデータを保持
 * - トランザクション対応
 * - インメモリ実装からの移行パス提供
 */

import type { Pool } from 'pg';
import type { ApiKey } from '../security/api-key-manager.js';

/**
 * APIキーストレージアダプターのインターフェース
 *
 * 実装:
 * - PostgreSQLAdapter: 本番用の永続化実装
 * - InMemoryAdapter: テスト用のメモリ実装
 */
export interface IApiKeyStoreAdapter {
  /**
   * APIキーを保存
   *
   * @param key APIキー情報
   * @returns 成功した場合true
   */
  store(key: ApiKey): Promise<boolean>;

  /**
   * ハッシュ化されたキーでAPIキーを検索
   *
   * @param hashedKey ハッシュ化されたキー
   * @returns APIキー情報（見つからない場合はnull）
   */
  findByHashedKey(hashedKey: string): Promise<ApiKey | null>;

  /**
   * IDでAPIキーを検索
   *
   * @param id キーID
   * @returns APIキー情報（見つからない場合はnull）
   */
  findById(id: string): Promise<ApiKey | null>;

  /**
   * ユーザーIDに紐づく全APIキーを取得
   *
   * @param userId ユーザーID（オプション）
   * @returns APIキーのリスト
   */
  findAll(userId?: string): Promise<ApiKey[]>;

  /**
   * APIキーを更新
   *
   * @param key APIキー情報
   * @returns 成功した場合true
   */
  update(key: ApiKey): Promise<boolean>;

  /**
   * APIキーを削除（ハッシュで指定）
   *
   * @param hashedKey ハッシュ化されたキー
   * @returns 成功した場合true
   */
  deleteByHashedKey(hashedKey: string): Promise<boolean>;

  /**
   * 期限切れキーのクリーンアップ
   *
   * @param gracePeriodMs 猶予期間（ミリ秒）
   * @returns 削除されたキーの数
   */
  cleanupExpired(gracePeriodMs: number): Promise<number>;

  /**
   * APIキーの統計情報を取得
   */
  getStatistics(): Promise<{
    total: number;
    active: number;
    revoked: number;
    expired: number;
  }>;
}

/**
 * PostgreSQL実装のAPIキーストレージアダプター
 */
export class PostgresApiKeyStoreAdapter implements IApiKeyStoreAdapter {
  constructor(private readonly pool: Pool) {}

  async store(key: ApiKey): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const query = `
        INSERT INTO api_keys (
          id, key_prefix, hashed_key, name, user_id,
          created_at, last_used_at, expires_at, status, scopes, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (hashed_key) DO UPDATE SET
          key_prefix = EXCLUDED.key_prefix,
          name = EXCLUDED.name,
          last_used_at = EXCLUDED.last_used_at,
          expires_at = EXCLUDED.expires_at,
          status = EXCLUDED.status,
          scopes = EXCLUDED.scopes,
          metadata = EXCLUDED.metadata
      `;

      await client.query(query, [
        key.id,
        key.keyPrefix,
        key.hashedKey,
        key.name,
        key.metadata?.userId ?? null,
        key.createdAt,
        key.lastUsedAt ?? null,
        key.expiresAt ?? null,
        key.status,
        JSON.stringify(key.scopes),
        JSON.stringify(key.metadata ?? {}),
      ]);

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Failed to store API key:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async findByHashedKey(hashedKey: string): Promise<ApiKey | null> {
    const query = `
      SELECT id, key_prefix, hashed_key, name, user_id,
             created_at, last_used_at, expires_at, status, scopes, metadata
      FROM api_keys
      WHERE hashed_key = $1
    `;

    const result = await this.pool.query(query, [hashedKey]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.rowToApiKey(result.rows[0]);
  }

  async findById(id: string): Promise<ApiKey | null> {
    const query = `
      SELECT id, key_prefix, hashed_key, name, user_id,
             created_at, last_used_at, expires_at, status, scopes, metadata
      FROM api_keys
      WHERE id = $1
    `;

    const result = await this.pool.query(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.rowToApiKey(result.rows[0]);
  }

  async findAll(userId?: string): Promise<ApiKey[]> {
    let query = `
      SELECT id, key_prefix, hashed_key, name, user_id,
             created_at, last_used_at, expires_at, status, scopes, metadata
      FROM api_keys
    `;

    const params: unknown[] = [];

    if (userId) {
      query += ' WHERE user_id = $1';
      params.push(userId);
    }

    query += ' ORDER BY created_at DESC';

    const result = await this.pool.query(query, params);

    return result.rows.map((row) => this.rowToApiKey(row));
  }

  async update(key: ApiKey): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const query = `
        UPDATE api_keys SET
          key_prefix = $2,
          hashed_key = $3,
          name = $4,
          last_used_at = $5,
          expires_at = $6,
          status = $7,
          scopes = $8,
          metadata = $9
        WHERE id = $1
      `;

      const result = await client.query(query, [
        key.id,
        key.keyPrefix,
        key.hashedKey,
        key.name,
        key.lastUsedAt ?? null,
        key.expiresAt ?? null,
        key.status,
        JSON.stringify(key.scopes),
        JSON.stringify(key.metadata ?? {}),
      ]);

      await client.query('COMMIT');

      return result.rowCount !== null && result.rowCount > 0;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Failed to update API key:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteByHashedKey(hashedKey: string): Promise<boolean> {
    const query = 'DELETE FROM api_keys WHERE hashed_key = $1';
    const result = await this.pool.query(query, [hashedKey]);

    return result.rowCount !== null && result.rowCount > 0;
  }

  async cleanupExpired(gracePeriodMs: number): Promise<number> {
    const gracePeriodDate = new Date(Date.now() - gracePeriodMs);

    const query = `
      DELETE FROM api_keys
      WHERE expires_at IS NOT NULL
        AND expires_at < $1
        AND status = 'expired'
    `;

    const result = await this.pool.query(query, [gracePeriodDate]);

    // 期限切れだがまだexpiredステータスでないものを更新
    await this.pool.query(`
      UPDATE api_keys
      SET status = 'expired'
      WHERE expires_at IS NOT NULL
        AND expires_at <= NOW()
        AND status = 'active'
    `);

    return result.rowCount ?? 0;
  }

  async getStatistics(): Promise<{
    total: number;
    active: number;
    revoked: number;
    expired: number;
  }> {
    const query = `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE status = 'revoked') as revoked,
        COUNT(*) FILTER (WHERE status = 'expired') as expired
      FROM api_keys
    `;

    const result = await this.pool.query(query);
    const row = result.rows[0];

    return {
      total: parseInt(row.total, 10),
      active: parseInt(row.active, 10),
      revoked: parseInt(row.revoked, 10),
      expired: parseInt(row.expired, 10),
    };
  }

  /**
   * データベース行をApiKeyオブジェクトに変換
   */
  private rowToApiKey(row: any): ApiKey {
    return {
      id: row.id,
      keyPrefix: row.key_prefix,
      hashedKey: row.hashed_key,
      name: row.name,
      createdAt: new Date(row.created_at),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : undefined,
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
      status: row.status,
      scopes: Array.isArray(row.scopes) ? row.scopes : JSON.parse(row.scopes),
      metadata: row.metadata || {},
    };
  }
}

/**
 * インメモリ実装のAPIキーストレージアダプター（テスト用）
 *
 * パフォーマンス最適化:
 * - keyIdIndex: keyId → hashedKey のマッピングでO(1)ルックアップ
 */
export class InMemoryApiKeyStoreAdapter implements IApiKeyStoreAdapter {
  private keys: Map<string, ApiKey> = new Map();
  /** keyId → hashedKey のインデックス（O(1)ルックアップ用） */
  private keyIdIndex: Map<string, string> = new Map();

  async store(key: ApiKey): Promise<boolean> {
    this.keys.set(key.hashedKey, key);
    this.keyIdIndex.set(key.id, key.hashedKey);
    return true;
  }

  async findByHashedKey(hashedKey: string): Promise<ApiKey | null> {
    return this.keys.get(hashedKey) ?? null;
  }

  async findById(id: string): Promise<ApiKey | null> {
    // O(1)ルックアップ: keyIdIndex経由でhashedKeyを取得
    const hashedKey = this.keyIdIndex.get(id);
    if (!hashedKey) {
      return null;
    }
    return this.keys.get(hashedKey) ?? null;
  }

  async findAll(userId?: string): Promise<ApiKey[]> {
    const result: ApiKey[] = [];

    for (const key of this.keys.values()) {
      if (!userId || key.metadata?.userId === userId) {
        result.push(key);
      }
    }

    return result;
  }

  async update(key: ApiKey): Promise<boolean> {
    const existing = await this.findById(key.id);
    if (!existing) {
      return false;
    }

    // 古いハッシュのエントリを削除
    this.keys.delete(existing.hashedKey);

    // 新しいハッシュで保存
    this.keys.set(key.hashedKey, key);

    // インデックスを更新（ハッシュが変更された場合）
    if (existing.hashedKey !== key.hashedKey) {
      this.keyIdIndex.set(key.id, key.hashedKey);
    }

    return true;
  }

  async deleteByHashedKey(hashedKey: string): Promise<boolean> {
    const key = this.keys.get(hashedKey);
    if (key) {
      // インデックスからも削除
      this.keyIdIndex.delete(key.id);
    }
    return this.keys.delete(hashedKey);
  }

  async cleanupExpired(gracePeriodMs: number): Promise<number> {
    const now = new Date();
    const gracePeriodDate = new Date(now.getTime() - gracePeriodMs);
    let count = 0;

    for (const [hashedKey, key] of this.keys.entries()) {
      if (key.expiresAt && key.expiresAt <= gracePeriodDate && key.status === 'expired') {
        this.keys.delete(hashedKey);
        this.keyIdIndex.delete(key.id);
        count++;
      } else if (key.expiresAt && key.expiresAt <= now && key.status === 'active') {
        key.status = 'expired';
      }
    }

    return count;
  }

  async getStatistics(): Promise<{
    total: number;
    active: number;
    revoked: number;
    expired: number;
  }> {
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
  clear(): void {
    this.keys.clear();
    this.keyIdIndex.clear();
  }
}
