-- Liteモード用PostgreSQLスキーマ拡張マイグレーション
-- 既存のデータベースに対してLiteモード用のスキーマ拡張を適用するスクリプト
-- 
-- 使用方法:
--   psql -U <username> -d <database> -f scripts/migrate-lite-mode-schema.sql
-- 
-- または Docker環境の場合:
--   docker exec -i context-store-postgres psql -U postgres -d context_store < scripts/migrate-lite-mode-schema.sql

BEGIN;

-- ========================================
-- Liteモード用メタデータカラムの追加
-- ========================================

-- memoriesテーブルにlite_mode_metadataカラムを追加
-- 既存のカラムがある場合はスキップ
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'memories' AND column_name = 'lite_mode_metadata'
  ) THEN
    ALTER TABLE memories ADD COLUMN lite_mode_metadata JSONB DEFAULT '{}';
    RAISE NOTICE 'Added lite_mode_metadata column to memories table';
  ELSE
    RAISE NOTICE 'lite_mode_metadata column already exists, skipping';
  END IF;
END $$;

-- ========================================
-- Liteモード用インデックスの作成
-- ========================================

-- lite_mode_metadataのGINインデックス
CREATE INDEX IF NOT EXISTS idx_memories_lite_metadata 
  ON memories USING GIN (lite_mode_metadata);

-- ソースタグによるフィルタリング用インデックス
CREATE INDEX IF NOT EXISTS idx_memories_lite_source 
  ON memories ((lite_mode_metadata->>'source'));

-- プロジェクトタグによるフィルタリング用インデックス
CREATE INDEX IF NOT EXISTS idx_memories_lite_project 
  ON memories ((lite_mode_metadata->>'project'));

-- タグ配列によるフィルタリング用インデックス
CREATE INDEX IF NOT EXISTS idx_memories_lite_tags 
  ON memories USING GIN ((lite_mode_metadata->'tags'));

-- ソースタイプによるフィルタリング用インデックス
CREATE INDEX IF NOT EXISTS idx_memories_lite_source_type 
  ON memories ((lite_mode_metadata->>'sourceType'));

RAISE NOTICE 'Created Lite mode indexes';

-- ========================================
-- コレクター状態管理テーブル
-- ========================================

-- collector_stateテーブルの作成
CREATE TABLE IF NOT EXISTS collector_state (
    collector_id VARCHAR(255) PRIMARY KEY,
    last_position BIGINT NOT NULL DEFAULT 0,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

-- collector_stateテーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_collector_state_updated 
  ON collector_state(last_updated);

RAISE NOTICE 'Created collector_state table';

-- ========================================
-- コメント追加
-- ========================================

COMMENT ON COLUMN memories.lite_mode_metadata IS 
'Liteモード用メタデータ。グラフストアの代わりにJSONBで関係性データを保存。
フィールド例:
- source: ソース名（claude-desktop, chatgpt-desktop, cursor, windsurf, claude-code, gemini-cli等）
- sourceType: ソースタイプ（desktop-app, ide, cli-agent）
- project: プロジェクト名
- tags: タグ配列
- filePath: ファイルパス（コンテキスト用）
- collectorVersion: コレクターバージョン';

COMMENT ON TABLE collector_state IS 
'コレクターの状態管理テーブル。
各コレクター（Desktop App、AI IDE、CLIエージェント）がログファイルのどこまで読み取ったかを記録し、
再起動時に前回の位置から処理を再開できるようにする。';

COMMENT ON COLUMN collector_state.collector_id IS 
'コレクターの一意識別子。
例: claude-desktop-collector, cursor-collector, claude-code-collector';

COMMENT ON COLUMN collector_state.last_position IS 
'ログファイル内の最後に読み取った位置（バイトオフセット）';

COMMENT ON COLUMN collector_state.metadata IS 
'コレクター固有のメタデータ。
例: ログファイルパス、ポーリング間隔、エラー情報等';

-- ========================================
-- マイグレーション完了
-- ========================================

COMMIT;

-- 確認メッセージ
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Lite mode schema migration completed successfully';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Changes applied:';
  RAISE NOTICE '  - Added lite_mode_metadata column to memories table';
  RAISE NOTICE '  - Created 5 indexes for Lite mode queries';
  RAISE NOTICE '  - Created collector_state table';
  RAISE NOTICE '========================================';
END $$;
