import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IndexOptimizer } from '../../performance/index-optimizer';
import { Pool } from 'pg';

vi.mock('pg', () => {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const mockPool = {
    query: vi.fn(),
  };
  return {
    Pool: vi.fn(() => mockPool),
  };
});

describe('IndexOptimizer', () => {
  let optimizer: IndexOptimizer;
  let mockPool: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = new Pool();
    optimizer = new IndexOptimizer({ pgPool: mockPool });
  });

  it('should detect unused indexes', async () => {
    const mockIndexes = {
      rows: [
        {
          schema_name: 'public',
          table_name: 'memories',
          index_name: 'idx_unused',
          definition: 'CREATE INDEX ...',
          index_size: '1048576',
          index_scan_count: '0', // unused
          index_tuple_read_count: '0',
          index_tuple_fetch_count: '0',
          is_unique: false,
          is_primary: false,
        },
        {
          schema_name: 'public',
          table_name: 'memories',
          index_name: 'idx_used',
          definition: 'CREATE INDEX ...',
          index_size: '1048576',
          index_scan_count: '1000', // used
          index_tuple_read_count: '5000',
          index_tuple_fetch_count: '5000',
          is_unique: false,
          is_primary: false,
        },
      ],
    };

    mockPool.query.mockResolvedValue(mockIndexes);

    const unused = await optimizer.detectUnusedIndexes();
    
    expect(unused).toHaveLength(1);
    expect(unused[0].indexName).toBe('idx_unused');
  });

  it('should detect bloated indexes', async () => {
    const mockBloatedIndexes = {
      rows: [
        {
          schemaname: 'public',
          tablename: 'memories',
          indexname: 'idx_bloated',
          index_size: '104857600', // 100MB
          table_size: '10485760',  // 10MB
          bloat_ratio: '1000',      // 10x size of table
        },
      ],
    };

    mockPool.query.mockResolvedValue(mockBloatedIndexes);

    const bloated = await optimizer.detectBloatedIndexes();
    
    expect(bloated).toHaveLength(1);
    expect(bloated[0].indexName).toBe('idx_bloated');
  });

  it('should reindex table', async () => {
    await optimizer.reindexTable('memories');
    
    expect(mockPool.query).toHaveBeenCalledWith('REINDEX TABLE "memories"');
  });
  
  it('should optimize HNSW index', async () => {
    // First query drops index, second creates it
    mockPool.query.mockResolvedValue({});
    
    await optimizer.optimizeHNSWIndex('memories', 'embedding');
    
    expect(mockPool.query).toHaveBeenCalledWith('DROP INDEX IF EXISTS "memories_embedding_hnsw_idx"');
    expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('CREATE INDEX "memories_embedding_hnsw_idx"'));
    expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('USING hnsw ("embedding" vector_cosine_ops)'));
  });
});