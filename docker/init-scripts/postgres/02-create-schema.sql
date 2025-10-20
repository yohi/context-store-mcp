-- PostgreSQLスキーマ作成スクリプト
-- Task 1.3: データベーススキーマの設計と初期化
-- design.md の物理データモデルに基づいて作成

-- ========================================
-- メインテーブル
-- ========================================

-- memoriesテーブル: 記憶の基本情報を格納
CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    memory_type VARCHAR(20) NOT NULL CHECK (memory_type IN ('episodic', 'semantic', 'procedural')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    access_count INT DEFAULT 0,
    importance_score FLOAT DEFAULT 0.0 CHECK (importance_score >= 0.0 AND importance_score <= 1.0),
    is_deleted BOOLEAN DEFAULT FALSE,
    is_protected BOOLEAN DEFAULT FALSE,
    deletion_requested_at TIMESTAMP WITH TIME ZONE
);

-- memory_vectorsテーブル: ベクトル埋め込みを格納
CREATE TABLE IF NOT EXISTS memory_vectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    embedding vector(1536) NOT NULL,
    UNIQUE(memory_id)
);

-- ========================================
-- GDPR準拠削除関連テーブル
-- ========================================

-- deletion_audit_logテーブル: 削除イベントの監査ログ
CREATE TABLE IF NOT EXISTS deletion_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID NOT NULL,
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('REQUESTED', 'SOFT_DELETED', 'PURGED', 'BACKUP_CLEARED', 'VERIFIED')),
    user_id UUID,
    reason TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',
    content_checksum VARCHAR(64) -- SHA256 hash
);

-- deletion_failuresテーブル: 削除失敗の追跡
CREATE TABLE IF NOT EXISTS deletion_failures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID NOT NULL,
    failure_mode VARCHAR(50) NOT NULL CHECK (failure_mode IN ('NEO4J_TIMEOUT', 'POSTGRESQL_DEADLOCK', 'REPLICA_SYNC_TIMEOUT', 'BACKUP_DELETION_FAILED')),
    error_message TEXT,
    retry_count INT DEFAULT 0,
    last_retry_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- backup_deletion_queueテーブル: バックアップ削除キュー
CREATE TABLE IF NOT EXISTS backup_deletion_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID NOT NULL,
    deletion_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    retention_end_date TIMESTAMP WITH TIME ZONE NOT NULL,
    processed BOOLEAN DEFAULT FALSE
);

-- ========================================
-- 自動整理関連テーブル
-- ========================================

-- search_result_logテーブル: 検索結果ログ（重要度スコア計算用）
CREATE TABLE IF NOT EXISTS search_result_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    relevance_score FLOAT,
    searched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ========================================
-- 検索品質評価関連テーブル
-- ========================================

-- user_feedback_logテーブル: ユーザーフィードバックログ
CREATE TABLE IF NOT EXISTS user_feedback_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    query TEXT NOT NULL,
    judgments JSONB NOT NULL,  -- Array of {memoryId, isRelevant, relevanceLevel}
    feedback_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ========================================
-- 同期失敗追跡テーブル
-- ========================================

-- sync_failuresテーブル: PostgreSQL-Neo4j間の同期失敗追跡
CREATE TABLE IF NOT EXISTS sync_failures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID NOT NULL,
    operation VARCHAR(50) NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
    target_db VARCHAR(20) NOT NULL CHECK (target_db = 'neo4j'),
    error_message TEXT,
    retry_count INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_retry_at TIMESTAMP WITH TIME ZONE
);

-- ========================================
-- インデックス作成
-- ========================================

-- memoriesテーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_memories_is_deleted ON memories(is_deleted);
CREATE INDEX IF NOT EXISTS idx_memories_last_accessed ON memories(last_accessed_at);
CREATE INDEX IF NOT EXISTS idx_memories_importance_score ON memories(importance_score);
CREATE INDEX IF NOT EXISTS idx_memories_protected ON memories(is_protected) WHERE is_protected = true;

-- memory_vectorsテーブルのHNSWインデックス
CREATE INDEX IF NOT EXISTS idx_memory_vectors_embedding ON memory_vectors
    USING hnsw (embedding vector_cosine_ops);

-- deletion_audit_logテーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_deletion_audit_memory_id ON deletion_audit_log(memory_id);
CREATE INDEX IF NOT EXISTS idx_deletion_audit_timestamp ON deletion_audit_log(timestamp);

-- deletion_failuresテーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_deletion_failures_memory_id ON deletion_failures(memory_id);

-- backup_deletion_queueテーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_backup_deletion_processed ON backup_deletion_queue(processed, retention_end_date);

-- search_result_logテーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_search_result_memory_id ON search_result_log(memory_id);
CREATE INDEX IF NOT EXISTS idx_search_result_searched_at ON search_result_log(searched_at);
CREATE INDEX IF NOT EXISTS idx_search_result_log_cleanup ON search_result_log(searched_at) WHERE searched_at < NOW() - INTERVAL '30 days';

-- user_feedback_logテーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_user_feedback_query ON user_feedback_log(query);
CREATE INDEX IF NOT EXISTS idx_user_feedback_at ON user_feedback_log(feedback_at);

-- sync_failuresテーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_sync_failures_memory_id ON sync_failures(memory_id);
CREATE INDEX IF NOT EXISTS idx_sync_failures_created_at ON sync_failures(created_at);

-- ========================================
-- 確認メッセージ
-- ========================================

DO $$
BEGIN
  RAISE NOTICE 'Database schema created successfully';
  RAISE NOTICE 'Tables created: memories, memory_vectors, deletion_audit_log, deletion_failures, backup_deletion_queue, search_result_log, user_feedback_log, sync_failures';
  RAISE NOTICE 'All indexes created successfully';
END $$;
