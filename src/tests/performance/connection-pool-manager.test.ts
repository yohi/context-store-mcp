
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConnectionPoolManager } from '../../performance/connection-pool-manager';
import { Pool } from 'pg';
import neo4j from 'neo4j-driver';

// Mock pg
vi.mock('pg', () => {
  const mockPool = {
    connect: vi.fn().mockResolvedValue({
      query: vi.fn(),
      release: vi.fn(),
    }),
    end: vi.fn(),
    on: vi.fn(),
    totalCount: 10,
    idleCount: 5,
    waitingCount: 0,
    query: vi.fn(),
  };
  return {
    Pool: vi.fn(() => mockPool),
  };
});

// Mock neo4j-driver
vi.mock('neo4j-driver', () => {
  const mockSession = {
    run: vi.fn(),
    close: vi.fn(),
  };
  const mockDriver = {
    session: vi.fn(() => mockSession),
    close: vi.fn(),
    verifyConnectivity: vi.fn(),
  };
  return {
    default: {
      driver: vi.fn(() => mockDriver),
      auth: {
        basic: vi.fn(),
      },
    },
  };
});

describe('ConnectionPoolManager', () => {
  let poolManager: ConnectionPoolManager;
  const pgConfig = {
    host: 'localhost',
    port: 5432,
    database: 'testdb',
    user: 'testuser',
    password: 'testpassword',
    poolConfig: { min: 2, max: 10 },
  };
  const neo4jConfig = {
    uri: 'bolt://localhost:7687',
    username: 'neo4j',
    password: 'password',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    poolManager = new ConnectionPoolManager(pgConfig, neo4jConfig);
  });

  afterEach(async () => {
    await poolManager.shutdown();
  });

  it('should initialize PostgreSQL pool correctly', () => {
    poolManager.initializePostgresPool();
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      host: pgConfig.host,
      max: pgConfig.poolConfig.max,
      min: pgConfig.poolConfig.min,
    }));
    expect(poolManager.isPostgresInitialized()).toBe(true);
  });

  it('should initialize Neo4j driver correctly', () => {
    poolManager.initializeNeo4jDriver(neo4jConfig.uri, neo4jConfig.username, neo4jConfig.password);
    expect(neo4j.driver).toHaveBeenCalled();
    expect(poolManager.isNeo4jInitialized()).toBe(true);
  });

  it('should acquire PostgreSQL connection', async () => {
    poolManager.initializePostgresPool();
    const client = await poolManager.acquirePostgresConnection();
    expect(client).toBeDefined();
    expect(client.release).toBeDefined();
  });

  it('should provide PostgreSQL statistics', () => {
    poolManager.initializePostgresPool();
    const stats = poolManager.getPostgresStatistics();
    expect(stats).toEqual({
      active: 5, // 10 total - 5 idle
      idle: 5,
      waiting: 0,
      total: 10,
    });
  });

  it('should shutdown pools correctly', async () => {
    poolManager.initializePostgresPool();
    poolManager.initializeNeo4jDriver(neo4jConfig.uri, neo4jConfig.username, neo4jConfig.password);
    
    await poolManager.shutdown();
    
    expect(poolManager.isPostgresInitialized()).toBe(false);
    expect(poolManager.isNeo4jInitialized()).toBe(false);
  });

  it('should update PostgreSQL pool configuration and re-initialize', async () => {
    poolManager.initializePostgresPool();
    
    const newConfig = { max: 50, min: 10 };
    await poolManager.updatePostgresPoolConfig(newConfig);
    
    expect(Pool).toHaveBeenLastCalledWith(expect.objectContaining({
      max: 50,
      min: 10,
    }));
    expect(poolManager.getPostgresStatistics()).toBeDefined();
  });
});
