-- スキーマバージョン管理テーブル
-- Task 1.3: データベーススキーマの設計と初期化
-- スキーマ変更の履歴と互換性を管理

-- ========================================
-- スキーマバージョン管理テーブル
-- ========================================

CREATE TABLE IF NOT EXISTS schema_version (
    id SERIAL PRIMARY KEY,
    version VARCHAR(20) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    migration_file VARCHAR(255),
    checksum VARCHAR(64) -- SHA256 hash of migration file
);

-- 初期バージョンの記録
INSERT INTO schema_version (version, description, migration_file, checksum) VALUES
  (
    '1.0.0',
    'Initial schema creation with memories, memory_vectors, deletion audit, auto-cleanup, and search quality tables',
    '02-create-schema.sql',
    'initial'
  )
ON CONFLICT (version) DO NOTHING;

-- ========================================
-- 確認メッセージ
-- ========================================

DO $$
BEGIN
  RAISE NOTICE 'Schema version management table created';
  RAISE NOTICE 'Current schema version: 1.0.0';
END $$;
