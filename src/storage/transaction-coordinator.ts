/**
 * Transaction Coordinator
 *
 * タスク9.1: トランザクション調整とSagaパターン
 * - PostgreSQL-Neo4j間の調整戦略
 * - 補償トランザクション (Compensating Transactions)
 * - 部分失敗時のロールバック意味論
 * - べき等性の保証
 * - トランザクション境界の定義
 *
 * Requirements: 5.3 (ハイブリッドストレージのフェイルオーバーとエラーリカバリー)
 * Design Reference: design.md - ハイブリッドストレージの一貫性戦略
 */

import type { Pool } from 'pg';
import type { Driver, Session } from 'neo4j-driver';
import type { MemoryId, MemoryType } from '../memory/types.js';

/**
 * Memory Entity (PostgreSQL + Neo4j 間で共有)
 */
export interface MemoryEntity {
  id: MemoryId;
  content: string;
  memoryType: MemoryType;
  metadata: Record<string, unknown>;
}

/**
 * Logger interface for structured logging
 */
export interface Logger {
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

/**
 * Default console-based logger implementation
 */
const defaultLogger: Logger = {
  warn: (message: string, context?: Record<string, unknown>) => {
    console.warn(message, context ? JSON.stringify(context) : '');
  },
  error: (message: string, context?: Record<string, unknown>) => {
    console.error(message, context ? JSON.stringify(context) : '');
  },
  info: (message: string, context?: Record<string, unknown>) => {
    console.info(message, context ? JSON.stringify(context) : '');
  },
  debug: (message: string, context?: Record<string, unknown>) => {
    console.debug(message, context ? JSON.stringify(context) : '');
  },
};

/**
 * Transaction Coordinator Configuration
 */
export interface TransactionCoordinatorConfig {
  /** PostgreSQL connection pool */
  postgresPool: Pool;
  /** Neo4j driver */
  neo4jDriver: Driver;
  /** Logger instance for structured logging (default: console-based logger) */
  logger?: Logger;
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds for retry backoff (default: 100ms) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds for retry backoff (default: 400ms) */
  maxDelayMs?: number;
  /** Backoff multiplier for exponential backoff (default: 2.0) */
  backoffMultiplier?: number;
}

/**
 * Transaction Result - Discriminated Union
 *
 * - 'ok': Complete success (both PostgreSQL and Neo4j succeeded)
 * - 'partial': Partial success (PostgreSQL succeeded, Neo4j failed or warning)
 * - 'failed': Complete failure (PostgreSQL failed or critical error)
 */
export type TransactionResult =
  | {
      /** Success status */
      status: 'ok';
      /** Memory ID for successful operation */
      memoryId: MemoryId;
    }
  | {
      /** Partial success status */
      status: 'partial';
      /** Memory ID for partially successful operation */
      memoryId: MemoryId;
      /** Warning information for partial success */
      warning: {
        type: 'SYNC_FAILURE';
        message: string;
      };
    }
  | {
      /** Failure status */
      status: 'failed';
      /** Error information for failed operation */
      error: {
        type: 'POSTGRESQL_ERROR' | 'NEO4J_ERROR' | 'SYNC_FAILURE';
        message: string;
        requiresCompensation?: boolean;
      };
    };

/**
 * Transaction Coordinator
 *
 * PostgreSQL (Master DB) と Neo4j (Secondary DB) 間のトランザクション調整を行う。
 * Sagaパターンを採用し、補償トランザクションで不整合を解決する。
 */
export class TransactionCoordinator {
  private readonly config: Required<TransactionCoordinatorConfig>;

  constructor(config: TransactionCoordinatorConfig) {
    this.config = {
      postgresPool: config.postgresPool,
      neo4jDriver: config.neo4jDriver,
      logger: config.logger ?? defaultLogger,
      maxRetries: config.maxRetries ?? 3,
      initialDelayMs: config.initialDelayMs ?? 100,
      maxDelayMs: config.maxDelayMs ?? 400,
      backoffMultiplier: config.backoffMultiplier ?? 2.0,
    };
  }

  /**
   * Store Memory with Saga Pattern
   *
   * フロー:
   * 1. PostgreSQL に記憶を保存（マスターDB）
   * 2. Neo4j にノードを作成（セカンダリDB）
   * 3. 失敗時の補償トランザクション
   *
   * 部分失敗時の動作:
   * - PG成功 + Neo4j失敗 → sync_status = 'pending_graph' でマーク、バックグラウンド再試行
   * - PG失敗 → 全体ロールバック（Neo4j操作なし）
   *
   * べき等性の保証:
   * - ON CONFLICT DO NOTHING を使用し、既存レコードは更新しない
   * - 新規挿入時のみ sync_status をマークする（既存レコードは保護）
   */
  async storeMemoryWithSaga(memory: MemoryEntity): Promise<TransactionResult> {
    // Step 1: PostgreSQL に保存（リトライ付き）
    let wasInserted = false;
    try {
      await this.retryWithBackoff(async () => {
        wasInserted = (await this.insertIntoPostgreSQLOrThrow(memory)) > 0;
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        status: 'failed',
        error: {
          type: 'POSTGRESQL_ERROR',
          message: `PostgreSQL insertion failed after retries: ${errorMessage}`,
        },
      };
    }

    // Step 2: Neo4j にノードを作成（procedural memory の場合）
    if (memory.memoryType === 'procedural') {
      const neoResult = await this.createNeo4jNode(memory);

      if (!neoResult.success) {
        // Neo4j失敗時の補償トランザクション: 新規挿入の場合のみ sync_status マーキング
        // 理由: 既存レコードは既に同期済みの可能性があり、ステータスを上書きしない
        if (wasInserted) {
          try {
            await this.markSyncFailure(memory.id, 'neo4j_creation_failed');
          } catch (markError) {
            // 同期失敗マークにも失敗した場合は致命的エラーとして返す
            return {
              status: 'failed',
              error: {
                type: 'POSTGRESQL_ERROR',
                message: `Failed to mark sync failure after Neo4j error: ${
                  markError instanceof Error ? markError.message : String(markError)
                }`,
                requiresCompensation: true,
              },
            };
          }

          return {
            status: 'partial', // PostgreSQL成功、Neo4j失敗 = 部分成功
            memoryId: memory.id,
            warning: {
              type: 'SYNC_FAILURE',
              message: `Neo4j node creation failed: ${neoResult.error}. Marked for background retry.`,
            },
          };
        }
      }
    }

    return {
      status: 'ok',
      memoryId: memory.id,
    };
  }

  /**
   * Delete Memory with Saga Pattern
   *
   * フロー:
   * 1. Neo4j からノードとエッジを削除（依存関係を先に削除）
   * 2. PostgreSQL から記憶を削除（ソフト削除）
   * 3. 失敗時の補償トランザクション
   *
   * 部分失敗時の動作:
   * - Neo4j削除失敗 → 許容（孤立ノードとして後で清掃）、PostgreSQL削除は続行
   * - PostgreSQL削除失敗 → 致命的エラー、補償トランザクション必要
   */
  async deleteMemoryWithSaga(memoryId: MemoryId): Promise<TransactionResult> {
    // Step 1: Neo4j からノード削除（エラーは許容）
    const neoResult = await this.deleteNeo4jNode(memoryId);
    let syncFailure: string | undefined = undefined;

    if (!neoResult.success) {
      // Neo4j削除失敗は許容し、PostgreSQL削除を続行
      syncFailure = neoResult.error;
    }

    // Step 2: PostgreSQL からソフト削除
    const pgResult = await this.softDeleteFromPostgreSQL(memoryId);

    if (!pgResult.success) {
      return {
        status: 'failed',
        error: {
          type: 'POSTGRESQL_ERROR',
          message: `PostgreSQL deletion failed: ${pgResult.error}`,
          requiresCompensation: true,
        },
      };
    }

    // Neo4j削除失敗があった場合は警告を返す
    if (syncFailure) {
      return {
        status: 'partial',
        memoryId,
        warning: {
          type: 'SYNC_FAILURE',
          message: `Neo4j node deletion failed: ${syncFailure}. Orphan node will be cleaned later.`,
        },
      };
    }

    return {
      status: 'ok',
      memoryId,
    };
  }

  /**
   * Insert memory into PostgreSQL
   * @returns Number of rows inserted (0 if conflict, 1 if new insert)
   * @throws Error if insertion fails (for retry mechanism)
   */
  private async insertIntoPostgreSQLOrThrow(memory: MemoryEntity): Promise<number> {
    const result = await this.config.postgresPool.query(
      `INSERT INTO memories (id, content, memory_type, metadata, created_at, updated_at, sync_status)
       VALUES ($1, $2, $3, $4, NOW(), NOW(), 'synced')
       ON CONFLICT (id) DO NOTHING`, // べき等性: 既存の場合は何もしない
      [memory.id, memory.content, memory.memoryType, JSON.stringify(memory.metadata)]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Create Neo4j Node
   */
  private async createNeo4jNode(
    memory: MemoryEntity
  ): Promise<{ success: boolean; error?: string }> {
    let session: Session | null = null;
    try {
      session = this.config.neo4jDriver.session();
      await session.run(
        `MERGE (m:Memory {id: $id})
         ON CREATE SET m.created_at = datetime()
         SET m.type = $type`,
        {
          id: memory.id,
          type: memory.memoryType,
        }
      );
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    } finally {
      if (session) {
        await session.close();
      }
    }
  }

  /**
   * Delete Neo4j Node
   */
  private async deleteNeo4jNode(memoryId: MemoryId): Promise<{ success: boolean; error?: string }> {
    let session: Session | null = null;
    try {
      session = this.config.neo4jDriver.session();
      await session.run(`MATCH (m:Memory {id: $id}) DETACH DELETE m`, {
        id: memoryId,
      });
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    } finally {
      if (session) {
        await session.close();
      }
    }
  }

  /**
   * Soft Delete from PostgreSQL
   */
  private async softDeleteFromPostgreSQL(
    memoryId: MemoryId
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.config.postgresPool.query(
        `UPDATE memories SET is_deleted = true, deleted_at = NOW() WHERE id = $1`,
        [memoryId]
      );
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Mark Sync Failure for background retry
   * @throws Error if marking sync failure fails (caller must handle)
   *
   * べき等性の保証:
   * - 既に 'synced' のレコードは更新しない（競合状態を回避）
   * - 新規挿入直後のみ 'pending_graph' に更新される
   */
  private async markSyncFailure(memoryId: MemoryId, reason: string): Promise<void> {
    try {
      await this.config.postgresPool.query(
        `UPDATE memories SET sync_status = 'pending_graph'
         WHERE id = $1 AND sync_status != 'synced'`,
        [memoryId]
      );
      // TODO: Insert into sync_failures table for tracking
      this.config.logger.warn('Sync failure marked for memory', { memoryId, reason });
    } catch (error) {
      // 同期失敗マークに失敗した場合、エラーを呼び出し側へ伝播
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Retry with Exponential Backoff
   *
   * 指数バックオフによる再試行戦略:
   * - 試行1: 100ms待機後に試行
   * - 試行2: 200ms待機後に試行
   * - 試行3: 400ms待機後に試行
   */
  private async retryWithBackoff<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const result = await operation();
        return result;
      } catch (error) {
        lastError = error;

        // 最後の試行でもエラーが発生した場合は、そのまま投げる
        if (attempt === this.config.maxRetries - 1) {
          throw error;
        }

        // 指数バックオフ計算
        const delay = Math.min(
          this.config.initialDelayMs * Math.pow(this.config.backoffMultiplier, attempt),
          this.config.maxDelayMs
        );

        // 待機
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // ここには到達しないはずだが、TypeScriptの型チェックのために追加
    throw lastError;
  }
}
