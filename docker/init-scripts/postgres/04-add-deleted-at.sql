-- Task 3.2 Issue #3: Add deleted_at column for soft delete
-- Requirements: 1.5 (削除), 6.4 (GDPR準拠削除)

ALTER TABLE memories ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Retrofit: Ensure existing soft-deleted rows have a timestamp
UPDATE memories SET deleted_at = NOW() WHERE is_deleted = true AND deleted_at IS NULL;

-- Index for performance on soft-deleted queries
CREATE INDEX IF NOT EXISTS idx_memories_deleted_at ON memories(deleted_at) WHERE deleted_at IS NOT NULL;

-- Trigger to enforce consistency between is_deleted and deleted_at
CREATE OR REPLACE FUNCTION sync_soft_delete_columns() RETURNS TRIGGER AS $$
BEGIN
    -- Handle Restore scenarios
    -- 1. deleted_at cleared
    IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
        NEW.is_deleted := false;
    END IF;
    
    -- 2. is_deleted cleared
    IF TG_OP = 'UPDATE' AND OLD.is_deleted = true AND NEW.is_deleted = false THEN
        NEW.deleted_at := NULL;
    END IF;

    -- Handle Delete scenarios
    -- 3. deleted_at set (takes precedence)
    IF NEW.deleted_at IS NOT NULL THEN
        NEW.is_deleted := true;
    END IF;
    
    -- 4. is_deleted set
    IF NEW.is_deleted = true AND NEW.deleted_at IS NULL THEN
        NEW.deleted_at := NOW();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_soft_delete ON memories;
CREATE TRIGGER trg_sync_soft_delete
BEFORE INSERT OR UPDATE ON memories
FOR EACH ROW
EXECUTE FUNCTION sync_soft_delete_columns();
