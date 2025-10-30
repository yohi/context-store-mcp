/**
 * Failover Manager
 *
 * タスク9.2: フェイルオーバーとエラーリカバリー
 * - コンポーネント別フェイルオーバーモード
 * - PostgreSQL障害時: 読み取り専用モード
 * - Neo4j障害時: グラフ機能無効化
 * - ヘルスチェックと自動復旧
 *
 * Requirements: 5.3 (ハイブリッドストレージのフェイルオーバーとエラーリカバリー)
 * Design Reference: design.md - コンポーネント別フェイルオーバーモードとフォールバック動作
 */

import type { Pool } from 'pg';
import type { Driver, Session } from 'neo4j-driver';
import { CircuitBreaker } from './circuit-breaker.js';

/**
 * System Operation Mode
 */
export enum OperationMode {
  /** 正常動作モード */
  NORMAL = 'NORMAL',
  /** 読み取り専用モード（PostgreSQL障害時） */
  READ_ONLY = 'READ_ONLY',
  /** グラフ機能無効化モード（Neo4j障害時） */
  GRAPH_DISABLED = 'GRAPH_DISABLED',
  /** 完全障害モード（両方障害） */
  UNAVAILABLE = 'UNAVAILABLE',
}

/**
 * Failover Manager Configuration
 */
export interface FailoverManagerConfig {
  /** PostgreSQL connection pool */
  postgresPool: Pool;
  /** Neo4j driver */
  neo4jDriver: Driver;
  /** Health check interval in milliseconds (default: 30000ms = 30s) */
  healthCheckInterval?: number;
  /** Enable automatic health checks (default: false) */
  enableAutoHealthCheck?: boolean;
}

/**
 * Memory Metadata (for read-only mode)
 */
export interface MemoryMetadata {
  id: string;
  type: string;
  created_at?: Date;
  warning?: string;
}

/**
 * Store Memory Result
 */
export interface StoreMemoryResult {
  success: boolean;
  memoryId?: string;
  syncStatus?: 'synced' | 'pending_graph';
  error?: string;
}

/**
 * Search Result
 */
export interface SearchResult {
  id: string;
  content: string;
  memory_type: string;
  warning?: string;
}

/**
 * Failover Manager
 *
 * ハイブリッドストレージ（PostgreSQL + Neo4j）のフェイルオーバーとエラーリカバリーを管理する。
 *
 * モード遷移:
 * - NORMAL: 両方正常
 * - READ_ONLY: PostgreSQL障害時、Neo4jから基本的なメタデータのみ提供
 * - GRAPH_DISABLED: Neo4j障害時、PostgreSQLのみでフラット検索
 * - UNAVAILABLE: 両方障害時、全てのリクエストを拒否
 */
export class FailoverManager {
  private mode: OperationMode = OperationMode.NORMAL;
  private readonly config: Required<FailoverManagerConfig>;
  private readonly postgresCircuitBreaker: CircuitBreaker;
  private readonly neo4jCircuitBreaker: CircuitBreaker;
  private healthCheckTimer: NodeJS.Timeout | null = null;

  constructor(config: FailoverManagerConfig) {
    this.config = {
      postgresPool: config.postgresPool,
      neo4jDriver: config.neo4jDriver,
      healthCheckInterval: config.healthCheckInterval ?? 30000,
      enableAutoHealthCheck: config.enableAutoHealthCheck ?? false,
    };

    // Circuit Breaker の初期化
    this.postgresCircuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 30000,
    });

    this.neo4jCircuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 30000,
    });

    // 自動ヘルスチェックの開始
    if (this.config.enableAutoHealthCheck) {
      this.startHealthCheck();
    }
  }

  /**
   * Get current operation mode
   */
  getMode(): OperationMode {
    return this.mode;
  }

  /**
   * Check if PostgreSQL is available
   */
  isPostgresAvailable(): boolean {
    return this.mode !== OperationMode.READ_ONLY && this.mode !== OperationMode.UNAVAILABLE;
  }

  /**
   * Check if Neo4j (Graph) is available
   */
  isGraphAvailable(): boolean {
    return this.mode === OperationMode.NORMAL;
  }

  /**
   * Handle PostgreSQL failure
   */
  async handlePostgresFailure(): Promise<void> {
    if (this.isGraphAvailable()) {
      // Neo4jは正常なので READ_ONLY モードに遷移
      this.mode = OperationMode.READ_ONLY;
    } else {
      // Neo4jも障害なので UNAVAILABLE に遷移
      this.mode = OperationMode.UNAVAILABLE;
    }
  }

  /**
   * Handle Neo4j failure
   */
  async handleNeo4jFailure(): Promise<void> {
    if (this.isPostgresAvailable()) {
      // PostgreSQLは正常なので GRAPH_DISABLED モードに遷移
      this.mode = OperationMode.GRAPH_DISABLED;
    } else {
      // PostgreSQLも障害なので UNAVAILABLE に遷移
      this.mode = OperationMode.UNAVAILABLE;
    }
  }

  /**
   * Get memory metadata (read-only mode)
   */
  async getMemoryMetadata(memoryId: string): Promise<MemoryMetadata> {
    if (this.mode === OperationMode.UNAVAILABLE) {
      throw new Error('Context Store temporarily unavailable');
    }

    if (this.mode === OperationMode.READ_ONLY) {
      // Neo4jからメタデータを取得
      let session: Session | null = null;
      try {
        session = this.config.neo4jDriver.session();
        try {
          const result = await session.run('MATCH (m:Memory {id: $id}) RETURN m.id as id, m.type as type, m.created_at as created_at', {
            id: memoryId,
          });

          if (result.records.length === 0) {
            throw new Error('Memory not found');
          }

          const record = result.records[0];
          return {
            id: record.get('id'),
            type: record.get('type'),
            created_at: record.get('created_at'),
            warning: 'Vector search unavailable (PostgreSQL offline)',
          };
        } catch (error) {
          // Neo4jエラーが発生した場合はUNAVAILABLEに遷移
          await this.handleNeo4jFailure();
          throw error; // 元のエラーを再スロー
        }
      } finally {
        if (session) {
          await session.close();
        }
      }
    }

    // NORMAL または GRAPH_DISABLED モードの場合は PostgreSQL から取得
    const result = await this.config.postgresPool.query('SELECT id, memory_type, created_at FROM memories WHERE id = $1', [
      memoryId,
    ]);

    if (result.rows.length === 0) {
      throw new Error('Memory not found');
    }

    return {
      id: result.rows[0].id,
      type: result.rows[0].memory_type,
      created_at: result.rows[0].created_at,
    };
  }

  /**
   * Store memory
   */
  async storeMemory(memory: { id: string; content: string; memoryType?: string }): Promise<StoreMemoryResult> {
    if (this.mode === OperationMode.UNAVAILABLE) {
      throw new Error('Context Store temporarily unavailable');
    }

    if (this.mode === OperationMode.READ_ONLY) {
      throw new Error('Write operations not available in READ_ONLY mode');
    }

    // PostgreSQL に保存
    try {
      await this.postgresCircuitBreaker.execute(async () => {
        await this.config.postgresPool.query(
          'INSERT INTO memories (id, content, memory_type) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
          [memory.id, memory.content, memory.memoryType ?? 'semantic']
        );
      });
    } catch (error) {
      await this.handlePostgresFailure();
      throw error;
    }

    // Neo4j にノードを作成（procedural memory の場合）
    if (memory.memoryType === 'procedural') {
      if (this.mode === OperationMode.NORMAL) {
        let session: Session | null = null;
        try {
          session = this.config.neo4jDriver.session();
          await this.neo4jCircuitBreaker.execute(async () => {
            await session!.run('MERGE (m:Memory {id: $id}) SET m.type = $type, m.created_at = datetime()', {
              id: memory.id,
              type: memory.memoryType,
            });
          });

          return {
            success: true,
            memoryId: memory.id,
            syncStatus: 'synced',
          };
        } catch (error) {
          await this.handleNeo4jFailure();
          // Neo4j失敗でもPostgreSQLには保存されているので、pending_graphとしてマーク
          await this.config.postgresPool.query("UPDATE memories SET sync_status = 'pending_graph' WHERE id = $1", [memory.id]);
          return {
            success: true,
            memoryId: memory.id,
            syncStatus: 'pending_graph',
          };
        } finally {
          if (session) {
            await session.close();
          }
        }
      } else if (this.mode === OperationMode.GRAPH_DISABLED) {
        // Neo4jが無効化されている場合は、pending_graphとしてマーク
        await this.config.postgresPool.query("UPDATE memories SET sync_status = 'pending_graph' WHERE id = $1", [memory.id]);
        return {
          success: true,
          memoryId: memory.id,
          syncStatus: 'pending_graph',
        };
      }
    }

    return {
      success: true,
      memoryId: memory.id,
      syncStatus: 'synced',
    };
  }

  /**
   * Search memories
   */
  async searchMemories(query: string): Promise<SearchResult[]> {
    if (this.mode === OperationMode.UNAVAILABLE) {
      throw new Error('Context Store temporarily unavailable');
    }

    if (this.mode === OperationMode.READ_ONLY) {
      throw new Error('Search not available in READ_ONLY mode (PostgreSQL offline)');
    }

    // PostgreSQLからフラット検索
    const result = await this.config.postgresPool.query(
      'SELECT id, content, memory_type FROM memories WHERE content ILIKE $1 LIMIT 10',
      [`%${query}%`]
    );

    const results: SearchResult[] = result.rows.map((row) => ({
      id: row.id,
      content: row.content,
      memory_type: row.memory_type,
    }));

    // GRAPH_DISABLED モードの場合は警告を追加
    if (this.mode === OperationMode.GRAPH_DISABLED) {
      results.forEach((r) => {
        r.warning = 'Graph relationships unavailable (Neo4j offline)';
      });
    }

    return results;
  }

  /**
   * Check PostgreSQL health
   */
  async checkPostgresHealth(): Promise<boolean> {
    try {
      await this.postgresCircuitBreaker.execute(async () => {
        await this.config.postgresPool.query('SELECT 1');
      });

      // PostgreSQLが復旧した場合、モードを更新
      if (this.mode === OperationMode.READ_ONLY) {
        // Neo4jが正常かチェック
        const neo4jHealthy = await this.isNeo4jHealthy();
        this.mode = neo4jHealthy ? OperationMode.NORMAL : OperationMode.GRAPH_DISABLED;
      } else if (this.mode === OperationMode.UNAVAILABLE) {
        // Neo4jが正常かチェック
        const neo4jHealthy = await this.isNeo4jHealthy();
        this.mode = neo4jHealthy ? OperationMode.NORMAL : OperationMode.GRAPH_DISABLED;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if Neo4j is healthy (internal helper)
   */
  private async isNeo4jHealthy(): Promise<boolean> {
    try {
      await this.config.neo4jDriver.verifyConnectivity();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check Neo4j health
   */
  async checkNeo4jHealth(): Promise<boolean> {
    try {
      await this.neo4jCircuitBreaker.execute(async () => {
        await this.config.neo4jDriver.verifyConnectivity();
      });

      // Neo4jが復旧した場合、モードを更新
      if (this.mode === OperationMode.GRAPH_DISABLED) {
        this.mode = this.isPostgresAvailable() ? OperationMode.NORMAL : OperationMode.READ_ONLY;
      } else if (this.mode === OperationMode.UNAVAILABLE) {
        this.mode = this.isPostgresAvailable() ? OperationMode.NORMAL : OperationMode.READ_ONLY;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Start periodic health check
   */
  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(async () => {
      await this.checkPostgresHealth();
      await this.checkNeo4jHealth();
    }, this.config.healthCheckInterval);
  }

  /**
   * Stop periodic health check
   */
  stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.stopHealthCheck();
  }
}
