-- Test Database Schema (Simplified)
-- Only essential tables for integration tests

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Memories table
CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    memory_type VARCHAR(50) NOT NULL DEFAULT 'semantic',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    is_protected BOOLEAN NOT NULL DEFAULT FALSE,
    access_count INTEGER NOT NULL DEFAULT 0,
    importance_score REAL NOT NULL DEFAULT 0.0,
    last_accessed_at TIMESTAMP WITH TIME ZONE,
    version INTEGER NOT NULL DEFAULT 1,
    sync_status VARCHAR(20) DEFAULT 'synced' CHECK (sync_status IN ('synced', 'pending_graph', 'failed', 'error'))
);

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

CREATE TABLE IF NOT EXISTS memory_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(memory_id, version_number)
);


-- Memory vectors table
CREATE TABLE IF NOT EXISTS memory_vectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    embedding vector(1536),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Memory history table
CREATE TABLE IF NOT EXISTS memory_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID NOT NULL,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(memory_id, version)
);

-- Essential indexes
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_memories_deleted ON memories(is_deleted);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_memory_vectors_memory_id ON memory_vectors(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_history_memory_id ON memory_history(memory_id);

-- Vector similarity search index
CREATE INDEX IF NOT EXISTS idx_memory_vectors_embedding ON memory_vectors 
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
