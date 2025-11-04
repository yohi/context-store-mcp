-- Migration: Add sync_status column to memories table
-- Date: 2025-11-04
-- Purpose: Track synchronization status between PostgreSQL and Neo4j

-- Add sync_status column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'memories'
        AND column_name = 'sync_status'
    ) THEN
        -- Add the column with default value
        ALTER TABLE memories
        ADD COLUMN sync_status VARCHAR(20) DEFAULT 'synced'
        CHECK (sync_status IN ('synced', 'pending_graph', 'failed', 'error'));

        RAISE NOTICE 'Added sync_status column to memories table';

        -- Create partial index for non-synced records
        CREATE INDEX IF NOT EXISTS idx_memories_sync_status
        ON memories(sync_status)
        WHERE sync_status != 'synced';

        RAISE NOTICE 'Created index idx_memories_sync_status';

        -- Set default value for existing records
        UPDATE memories
        SET sync_status = 'synced'
        WHERE sync_status IS NULL;

        RAISE NOTICE 'Updated existing records with default sync_status';
    ELSE
        RAISE NOTICE 'Column sync_status already exists in memories table';
    END IF;
END $$;
