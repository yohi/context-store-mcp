-- Classifier Training Data and Centroids Schema
-- Phase 5: Embedding-based classification support

-- Store labeled training samples for the classifier
CREATE TABLE IF NOT EXISTS classifier_training_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    true_type VARCHAR(20) NOT NULL CHECK (true_type IN ('episodic', 'semantic', 'procedural')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Store computed centroids for each memory type
CREATE TABLE IF NOT EXISTS classifier_centroids (
    memory_type VARCHAR(20) PRIMARY KEY CHECK (memory_type IN ('episodic', 'semantic', 'procedural')),
    centroid VECTOR(1536), -- OpenAI text-embedding-3-small dimension
    sample_count INTEGER DEFAULT 0,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for efficient querying
CREATE INDEX IF NOT EXISTS idx_classifier_training_type ON classifier_training_data(true_type);
CREATE INDEX IF NOT EXISTS idx_classifier_training_created ON classifier_training_data(created_at);

-- Initialize centroids with zero vectors (1536 dimensions)
INSERT INTO classifier_centroids (memory_type, centroid, sample_count)
VALUES 
    ('episodic', array_fill(0, ARRAY[1536])::vector, 0),
    ('semantic', array_fill(0, ARRAY[1536])::vector, 0),
    ('procedural', array_fill(0, ARRAY[1536])::vector, 0)
ON CONFLICT (memory_type) DO NOTHING;
