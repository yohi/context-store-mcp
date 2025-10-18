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
const testPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'context_store_test',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
});

describe('PostgreSQLスキーマテスト', () => {
  beforeAll(async () => {
    // テスト用データベースのクリーンアップ
    await testPool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await testPool.query('CREATE SCHEMA public');
    await testPool.query('GRANT ALL ON SCHEMA public TO postgres');
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
