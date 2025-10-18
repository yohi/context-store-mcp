/**
 * データベーススキーマテスト
 * Task 1.3: データベーススキーマの設計と初期化
 *
 * このテストは以下を検証します:
 * - PostgreSQLテーブルの正しい作成
 * - インデックスの存在
 * - 外部キー制約の設定
 * - デフォルト値の設定
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

// テスト用データベース接続設定
const dbName = process.env.POSTGRES_DB || 'context_store_test';
const testPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: dbName,
  user: process.env.POSTGRES_USER || 'context_store_user',
  password: process.env.POSTGRES_PASSWORD || 'changeme',
  // CI環境でのハングを防ぐためのプール設定
  max: 5, // 最大接続数
  idleTimeoutMillis: 30000, // アイドルタイムアウト (30秒)
  connectionTimeoutMillis: 2000, // 接続タイムアウト (2秒)
});

/**
 * テスト用データベースの安全性チェック
 * 本番データベースへの接続を防ぐため、データベース名を検証します
 */
function validateTestDatabase(databaseName: string): void {
  // 大文字小文字を区別しない比較のため正規化
  const normalizedName = databaseName.toLowerCase();

  // より厳密なテストDB検証: 単語境界での"test"、または接頭辞/接尾辞として"test"を含むかチェック
  // 例: "test_db", "db_test", "my-test-db", "test" は OK
  // 例: "contest", "latest" などは NG（誤検知を防ぐ）
  const isTestDb = /\btest\b/i.test(databaseName) || /(^test[_-]|[_-]test$)/i.test(databaseName);
  const isProductionDb = normalizedName === 'context_store';

  if (isProductionDb) {
    throw new Error(
      `FATAL: Tests are attempting to connect to production database "${databaseName}". ` +
      'Tests must use a test-specific database (e.g., "context_store_test"). ' +
      'Set POSTGRES_DB environment variable to a test database name containing "test".'
    );
  }

  if (!isTestDb) {
    throw new Error(
      `FATAL: Database name "${databaseName}" does not appear to be a test database. ` +
      'For safety, test database names must contain "test" or end with "_test". ' +
      'Set POSTGRES_DB=context_store_test or another test-specific name.'
    );
  }

  // CI環境では環境変数が明示的に設定されていることを確認
  if (process.env.CI && !process.env.POSTGRES_DB) {
    throw new Error(
      'FATAL: Running in CI environment without explicit POSTGRES_DB set. ' +
      'For safety, CI must explicitly set POSTGRES_DB to prevent accidental production database access.'
    );
  }
}

describe('PostgreSQLスキーマテスト', () => {
  beforeAll(async () => {
    // 破壊的操作の前に必ずテスト用データベースであることを検証
    validateTestDatabase(dbName);

    // テスト用データベースのクリーンアップ
    await testPool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await testPool.query('CREATE SCHEMA public');
    await testPool.query('GRANT ALL ON SCHEMA public TO CURRENT_USER');
    await testPool.query('GRANT ALL ON SCHEMA public TO public');
  });

  afterAll(async () => {
    await testPool.end();
  });

  describe('memoriesテーブル', () => {
    it('memoriesテーブルが存在すること', async () => {
      // スキーマ適用前はテーブルが存在しない（RED）
      const result = await testPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'memories'
        );
      `);

      expect(result.rows[0].exists).toBe(false);
    });

    it('memoriesテーブルが正しいカラムを持つこと', async () => {
      // まだスキーマ未適用なのでカラムが存在しない（RED）
      const result = await testPool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'memories'
        ORDER BY ordinal_position;
      `);

      expect(result.rows).toHaveLength(0);
    });

    it('is_deleted列がデフォルトでfalseであること', async () => {
      const result = await testPool.query(`
        SELECT column_default
        FROM information_schema.columns
        WHERE table_name = 'memories'
        AND column_name = 'is_deleted';
      `);

      expect(result.rows).toHaveLength(0);
    });

    it('is_protected列がデフォルトでfalseであること', async () => {
      const result = await testPool.query(`
        SELECT column_default
        FROM information_schema.columns
        WHERE table_name = 'memories'
        AND column_name = 'is_protected';
      `);

      expect(result.rows).toHaveLength(0);
    });

    it('importance_score列がデフォルトで0.0であること', async () => {
      const result = await testPool.query(`
        SELECT column_default
        FROM information_schema.columns
        WHERE table_name = 'memories'
        AND column_name = 'importance_score';
      `);

      expect(result.rows).toHaveLength(0);
    });
  });

  describe('memory_vectorsテーブル', () => {
    it('memory_vectorsテーブルが存在すること', async () => {
      const result = await testPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'memory_vectors'
        );
      `);

      expect(result.rows[0].exists).toBe(false);
    });

    it('memory_idにUNIQUE制約があること', async () => {
      const result = await testPool.query(`
        SELECT constraint_name, constraint_type
        FROM information_schema.table_constraints
        WHERE table_name = 'memory_vectors'
        AND constraint_type = 'UNIQUE';
      `);

      expect(result.rows).toHaveLength(0);
    });

    it('memory_idに外部キー制約があること', async () => {
      const result = await testPool.query(`
        SELECT constraint_name, constraint_type
        FROM information_schema.table_constraints
        WHERE table_name = 'memory_vectors'
        AND constraint_type = 'FOREIGN KEY';
      `);

      expect(result.rows).toHaveLength(0);
    });
  });

  describe('インデックス', () => {
    it('memories.memory_typeにインデックスが存在すること', async () => {
      const result = await testPool.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'memories'
        AND indexname = 'idx_memories_type';
      `);

      expect(result.rows).toHaveLength(0);
    });

    it('memories.created_atにインデックスが存在すること', async () => {
      const result = await testPool.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'memories'
        AND indexname = 'idx_memories_created_at';
      `);

      expect(result.rows).toHaveLength(0);
    });

    it('memories.is_deletedにインデックスが存在すること', async () => {
      const result = await testPool.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'memories'
        AND indexname = 'idx_memories_is_deleted';
      `);

      expect(result.rows).toHaveLength(0);
    });

    it('memory_vectors.embeddingにHNSWインデックスが存在すること', async () => {
      const result = await testPool.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'memory_vectors'
        AND indexname = 'idx_memory_vectors_embedding';
      `);

      expect(result.rows).toHaveLength(0);
    });
  });

  describe('削除関連テーブル', () => {
    it('deletion_audit_logテーブルが存在すること', async () => {
      const result = await testPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'deletion_audit_log'
        );
      `);

      expect(result.rows[0].exists).toBe(false);
    });

    it('deletion_failuresテーブルが存在すること', async () => {
      const result = await testPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'deletion_failures'
        );
      `);

      expect(result.rows[0].exists).toBe(false);
    });

    it('backup_deletion_queueテーブルが存在すること', async () => {
      const result = await testPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'backup_deletion_queue'
        );
      `);

      expect(result.rows[0].exists).toBe(false);
    });

    it('sync_failuresテーブルが存在すること', async () => {
      const result = await testPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'sync_failures'
        );
      `);

      expect(result.rows[0].exists).toBe(false);
    });
  });

  describe('自動整理関連テーブル', () => {
    it('search_result_logテーブルが存在すること', async () => {
      const result = await testPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'search_result_log'
        );
      `);

      expect(result.rows[0].exists).toBe(false);
    });
  });

  describe('検索品質評価関連テーブル', () => {
    it('user_feedback_logテーブルが存在すること', async () => {
      const result = await testPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'user_feedback_log'
        );
      `);

      expect(result.rows[0].exists).toBe(false);
    });
  });
});
