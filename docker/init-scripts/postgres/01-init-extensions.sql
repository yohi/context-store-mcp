-- PostgreSQL初期化スクリプト: 拡張機能の有効化
-- このスクリプトはコンテナ起動時に自動実行されます

-- pgvector拡張機能の有効化（ベクトル検索用）
CREATE EXTENSION IF NOT EXISTS vector;

-- UUID生成用拡張機能の有効化
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 暗号化関数用拡張機能の有効化
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 確認メッセージ
DO $$
BEGIN
  RAISE NOTICE 'pgvector extension enabled successfully';
  RAISE NOTICE 'uuid-ossp extension enabled successfully';
  RAISE NOTICE 'pgcrypto extension enabled successfully';
END $$;
