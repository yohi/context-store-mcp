-- Liteモード用PostgreSQLスキーマ拡張
-- タスク2.4: PostgreSQLスキーマの拡張
-- 要件: 3.4, 4.1, 4.2, 4.3, 5.4

-- ========================================
-- Liteモード用メタデータカラムの追加
-- ========================================

-- memoriesテーブルにlite_mode_metadataカラムを追加
-- Liteモードでは、グラフストアの代わりにJSONBカラムで関係性データを保存
ALTER TABLE memories 
ADD COLUMN IF NOT EXISTS lite_mode_metadata JSONB DEFAULT '{}';

-- ========================================
-- Liteモード用インデックスの作成
-- ========================================

-- lite_mode_metadataのGINインデックス（JSONBクエリの高速化）
CREATE INDEX IF NOT EXISTS idx_memories_lite_metadata 
  ON memories USING GIN (lite_mode_metadata);

-- ソースタグによるフィルタリング用インデックス
-- 例: source:claude-desktop, source:chatgpt-desktop, source:cursor, source:windsurf
CREATE INDEX IF NOT EXISTS idx_memories_lite_source 
  ON memories ((lite_mode_metadata->>'source'));

-- プロジェクトタグによるフィルタリング用インデックス
-- 例: project:my-project
CREATE INDEX IF NOT EXISTS idx_memories_lite_project 
  ON memories ((lite_mode_metadata->>'project'));

-- タグ配列によるフィルタリング用インデックス（OR検索）
-- 例: tags: ['source:cursor', 'project:my-app']
CREATE INDEX IF NOT EXISTS idx_memories_lite_tags 
  ON memories USING GIN ((lite_mode_metadata->'tags'));

-- ソースタイプによるフィルタリング用インデックス
-- 例: sourceType: 'desktop-app', 'ide', 'cli-agent'
CREATE INDEX IF NOT EXISTS idx_memories_lite_source_type 
  ON memories ((lite_mode_metadata->>'sourceType'));

-- ========================================
-- コレクター状態管理テーブル
-- ========================================

-- collector_stateテーブル: コレクターの状態を保存
-- 各コレクターがログファイルのどこまで読み取ったかを記録
CREATE TABLE IF NOT EXISTS collector_state (
    collector_id VARCHAR(255) PRIMARY KEY,
    last_position BIGINT NOT NULL DEFAULT 0,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

-- collector_stateテーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_collector_state_updated 
  ON collector_state(last_updated);

-- ========================================
-- コメント追加（ドキュメント化）
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
-- 確認メッセージ
-- ========================================

DO $$
BEGIN
  RAISE NOTICE 'Lite mode schema extensions created successfully';
  RAISE NOTICE 'Added lite_mode_metadata column to memories table';
  RAISE NOTICE 'Created collector_state table for collector state management';
  RAISE NOTICE 'Created indexes for Lite mode queries';
END $$;
