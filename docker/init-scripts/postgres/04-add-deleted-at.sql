-- Task 3.2 Issue #3: Add deleted_at column for soft delete
-- Requirements: 1.5 (削除), 6.4 (GDPR準拠削除)

ALTER TABLE memories ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Index for performance on soft-deleted queries
CREATE INDEX IF NOT EXISTS idx_memories_deleted_at ON memories(deleted_at) WHERE is_deleted = true;
