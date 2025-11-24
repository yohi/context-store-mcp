import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryOptimizer } from '../../performance/query-optimizer';
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

describe('QueryOptimizer', () => {
  let optimizer: QueryOptimizer;
  let mockPool: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = new Pool();
    optimizer = new QueryOptimizer({ pgPool: mockPool, slowQueryThreshold: 100 });
  });

  it('should explain postgres query', async () => {
    const mockExplainOutput = {
      rows: [
        {
          'QUERY PLAN': [
            {
              'Planning Time': 0.5,
              Plan: {
                'Node Type': 'Seq Scan',
                'Relation Name': 'memories',
                'Startup Cost': 0.00,
                'Total Cost': 1.01,
                'Plan Rows': 1,
                'Plan Width': 32,
                'Actual Startup Time': 0.01,
                'Actual Total Time': 0.02,
                'Actual Rows': 1,
                'Actual Loops': 1,
              }
            }
          ]
        }
      ]
    };
    mockPool.query.mockResolvedValue(mockExplainOutput);

    const result = await optimizer.explainPostgresQuery('SELECT * FROM memories');
    
    expect(mockPool.query).toHaveBeenCalledWith('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM memories');
    expect(result.plan.nodeType).toBe('Seq Scan');
    expect(result.recommendations).toContainEqual(expect.stringContaining('Add index'));
  });

  it('should profile query and record slow query', async () => {
    // Mock execution result
    mockPool.query.mockImplementation((query: string) => {
      if (query.startsWith('EXPLAIN')) {
        return Promise.resolve({
           rows: [
            {
              'QUERY PLAN': [
                {
                  'Planning Time': 0.5,
                  Plan: {
                    'Node Type': 'Seq Scan',
                    'Relation Name': 'memories',
                    'Startup Cost': 0.00,
                    'Total Cost': 100000,
                    'Plan Rows': 100000,
                    'Plan Width': 32,
                  }
                }
              ]
            }
          ]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    vi.useFakeTimers();
    const start = 1000;
    vi.setSystemTime(start);
    
    const promise = optimizer.profileQuery('SELECT * FROM memories', 'postgresql');
    
    // Advance time to simulate slow query
    vi.setSystemTime(start + 200); // 200ms > 100ms threshold
    await promise;

    const slowQueries = optimizer.getSlowQueries();
    expect(slowQueries).toHaveLength(1);
    expect(slowQueries[0].query).toBe('SELECT * FROM memories');
    expect(slowQueries[0].explainPlan).toBeDefined();
    
    vi.useRealTimers();
  });
});