/**
 * トランザクションコーディネーター
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
import type { MemoryId, MemoryType, MemoryMetadata } from '../memory/types.js';

/**
 * メモリエンティティ (PostgreSQL + Neo4j 間で共有)
 */
export interface MemoryEntity {
  id: MemoryId;
  content: string;
  memoryType: MemoryType;
  metadata: MemoryMetadata;
}

/**
 * 構造化ロギングのためのロガーインターフェース
 */
export interface Logger {
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

/**
 * デフォルトのコンソールベースロガー実装
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
 * トランザクションコーディネーター設定
 */
export interface TransactionCoordinatorConfig {
  /** PostgreSQL接続プール */
  postgresPool: Pool;
  /** Neo4jドライバー */
  neo4jDriver: Driver;
  /** 構造化ロギング用ロガーインスタンス (デフォルト: コンソールベースロガー) */
  logger?: Logger;
  /** 最大リトライ回数 (デフォルト: 3) */
  maxRetries?: number;
  /** リトライバックオフの初期遅延（ミリ秒） (デフォルト: 100ms) */
  initialDelayMs?: number;
  /** リトライバックオフの最大遅延（ミリ秒） (デフォルト: 400ms) */
  maxDelayMs?: number;
  /** エクスポネンシャルバックオフの乗数 (デフォルト: 2.0) */
  backoffMultiplier?: number;
}

/**
 * トランザクション結果 - 判別共用体
 *
 * - 'ok': 完全成功 (PostgreSQLとNeo4jの両方が成功)
 * - 'partial': 部分成功 (PostgreSQLは成功、Neo4jは失敗または警告)
 * - 'failed': 完全失敗 (PostgreSQLが失敗または致命的エラー)
 */
export type TransactionResult =
  | {
    /** 成功ステータス */
    status: 'ok';
    /** 成功した操作のメモリID */
    memoryId: MemoryId;
  }
  | {
    /** 部分成功ステータス */
    status: 'partial';
    /** 部分成功した操作のメモリID */
    memoryId: MemoryId;
    /** 部分成功に関する警告情報 */
    warning: {
      type: 'SYNC_FAILURE';
      message: string;
    };
  }
  | {
    /** 失敗ステータス */
    status: 'failed';
    /** 失敗した操作のエラー情報 */
    error: {
      type: 'POSTGRESQL_ERROR' | 'NEO4J_ERROR' | 'SYNC_FAILURE';
      message: string;
      requiresCompensation?: boolean;
    };
  };

/**
 * トランザクションコーディネーター
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
   * Sagaパターンを使用した記憶の保存
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
        // Neo4j失敗時の補償トランザクション
        // 新規挿入の場合のみ sync_status をマーキング
        // 既存レコードの場合は警告のみ（既存の sync_status を保持）
        if (wasInserted) {
          try {
            await this.markSyncFailure(memory.id, 'neo4j_creation_failed');
          } catch (markError) {
            // 同期失敗マークにも失敗した場合は致命的エラーとして返す
            return {
              status: 'failed',
              error: {
                type: 'POSTGRESQL_ERROR',
                message: `Failed to mark sync failure after Neo4j error: ${markError instanceof Error ? markError.message : String(markError)
                  }`,
                requiresCompensation: true,
              },
            };
          }
        }

        // wasInserted に関係なく、Neo4j 失敗は部分成功として返す
        return {
          status: 'partial', // PostgreSQL成功、Neo4j失敗 = 部分成功
          memoryId: memory.id,
          warning: {
            type: 'SYNC_FAILURE',
            message: `Neo4j node creation failed: ${neoResult.error}${wasInserted ? '. Marked for background retry.' : '. Existing record remains out of sync.'
              }`,
          },
        };
      }
    }

    return {
      status: 'ok',
      memoryId: memory.id,
    };
  }

  /**
   * Sagaパターンを使用した記憶の更新
   *
   * フロー:
   * 1. PostgreSQL の記憶を更新（マスターDB）
   * 2. Neo4j のノードを更新（セカンダリDB）
   * 3. 失敗時の補償トランザクション
   *
   * 部分失敗時の動作:
   * - PG成功 + Neo4j失敗 → sync_status = 'pending_graph' でマーク、バックグラウンド再試行
   * - PG失敗 → 全体ロールバック（Neo4j操作なし）
   */
  async updateMemoryWithSaga(memory: MemoryEntity): Promise<TransactionResult> {
    // Step 1: PostgreSQL を更新（リトライ付き）
    let wasUpdated = false;
    try {
      await this.retryWithBackoff(async () => {
        wasUpdated = (await this.updateIntoPostgreSQLOrThrow(memory)) > 0;
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        status: 'failed',
        error: {
          type: 'POSTGRESQL_ERROR',
          message: `PostgreSQL update failed after retries: ${errorMessage}`,
        },
      };
    }

    // レコードが存在しない場合
    if (!wasUpdated) {
      return {
        status: 'failed',
        error: {
          type: 'POSTGRESQL_ERROR',
          message: `Memory with ID ${memory.id} not found for update`,
        },
      };
    }

    // Step 2: Neo4j のノードを更新（procedural memory の場合）
    if (memory.memoryType === 'procedural') {
      const neoResult = await this.createNeo4jNode(memory); // MERGE を使用するため、create/update 両方に対応

      if (!neoResult.success) {
        // Neo4j失敗時の補償トランザクション
        try {
          await this.markSyncFailure(memory.id, 'neo4j_update_failed');
        } catch (markError) {
          // 同期失敗マークにも失敗した場合は致命的エラーとして返す
          return {
            status: 'failed',
            error: {
              type: 'POSTGRESQL_ERROR',
              message: `Failed to mark sync failure after Neo4j error: ${markError instanceof Error ? markError.message : String(markError)
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
            message: `Neo4j node update failed: ${neoResult.error}. Marked for background retry.`,
          },
        };
      }
    }

    return {
      status: 'ok',
      memoryId: memory.id,
    };
  }

  /**
   * Sagaパターンを使用した記憶の削除
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
   * 記憶の物理削除（ハードデリート）
   * ガベージコレクションで使用
   */
  async hardDeleteMemory(memoryId: MemoryId): Promise<TransactionResult> {
    // Step 1: PostgreSQL から物理削除（マスターDBを先に削除）
    try {
      await this.config.postgresPool.query(
        `DELETE FROM memories WHERE id = $1`,
        [memoryId]
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        status: 'failed',
        error: {
          type: 'POSTGRESQL_ERROR',
          message: `PostgreSQL hard deletion failed: ${errorMessage}`,
          requiresCompensation: false,
        },
      };
    }

    // Step 2: Neo4j からノード削除（PostgreSQL削除成功後のみ実行）
    const neoResult = await this.deleteNeo4jNode(memoryId);

    if (!neoResult.success) {
      return {
        status: 'partial',
        memoryId,
        warning: {
          type: 'SYNC_FAILURE',
          message: `Neo4j node deletion failed during hard delete: ${neoResult.error}`,
        },
      };
    }

    return {
      status: 'ok',
      memoryId,
    };
  }

  /**
   * PostgreSQLに記憶を挿入
   * @returns 挿入された行数 (競合時は0、新規挿入時は1)
   * @throws 挿入失敗時にエラーをスロー (リトライ機構用)
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
   * PostgreSQLの記憶を更新
   * @returns 更新された行数 (見つからない場合は0、更新時は1)
   * @throws 更新失敗時にエラーをスロー (リトライ機構用)
   */
  private async updateIntoPostgreSQLOrThrow(memory: MemoryEntity): Promise<number> {
    const result = await this.config.postgresPool.query(
      `UPDATE memories 
       SET content = $2, memory_type = $3, metadata = $4, updated_at = NOW(), sync_status = 'synced'
       WHERE id = $1`,
      [memory.id, memory.content, memory.memoryType, JSON.stringify(memory.metadata)]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Neo4jノードを作成
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
         SET m.content = $content,
             m.type = $type,
             m.metadata = $metadata,
             m.updated_at = datetime()`,
        {
          id: memory.id,
          content: memory.content,
          type: memory.memoryType,
          metadata: JSON.stringify(memory.metadata),
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
   * Neo4jノードを削除
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
   * PostgreSQLからソフト削除
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
   * バックグラウンドリトライ用に同期失敗をマーク
   * @throws 同期失敗のマークに失敗した場合にエラーをスロー (呼び出し元で処理が必要)
   *
   * べき等性の保証:
   * - 新規挿入直後のレコード (sync_status='synced') を 'pending_graph' に更新
   * - 既に 'pending_graph' のレコードは再更新しても問題なし（べき等）
   * - 'failed' のレコードも更新可能（リトライのため）
   */
  private async markSyncFailure(memoryId: MemoryId, reason: string): Promise<void> {
    try {
      await this.config.postgresPool.query(
        `UPDATE memories SET sync_status = 'pending_graph'
         WHERE id = $1`,
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
   * 記憶のバージョン履歴を保存
   * 注: バージョン復元時に利用可能にするため、memoryTypeをメタデータに含めます
   */
  async saveMemoryVersion(memory: MemoryEntity, version: number): Promise<void> {
    try {
      // Include memoryType in metadata for reliable restoration
      const metadataWithType = {
        ...memory.metadata,
        memoryType: memory.memoryType,
      };

      await this.config.postgresPool.query(
        `INSERT INTO memory_versions (memory_id, version_number, content, metadata, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (memory_id, version_number) DO NOTHING`,
        [memory.id, version, memory.content, JSON.stringify(metadataWithType)]
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.config.logger.error(`Failed to save memory version: ${errorMessage}`, {
        memoryId: memory.id,
        version,
      });
      // Non-blocking error: version history failure shouldn't stop the main operation
      // but we log it.
    }
  }

  /**
   * 記憶のバージョン一覧を取得
   */
  async getMemoryVersions(memoryId: MemoryId): Promise<any[]> {
    try {
      const result = await this.config.postgresPool.query(
        `SELECT * FROM memory_versions WHERE memory_id = $1 ORDER BY version_number DESC`,
        [memoryId]
      );
      return result.rows.map(row => ({
        id: row.id,
        memoryId: row.memory_id,
        version: row.version_number,
        content: row.content,
        metadata: row.metadata,
        createdAt: row.created_at
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get memory versions: ${errorMessage}`);
    }
  }

  /**
   * 記憶を特定のバージョンに戻す
   * 注: これはデータの取得のみを行います。実際の更新はstoreMemory/updateMemoryで処理し、
   * すべてのストア（Neo4j, Vector）間での整合性を保証する必要があります。
   */
  async getMemoryVersion(memoryId: MemoryId, version: number): Promise<MemoryEntity | null> {
    try {
      const result = await this.config.postgresPool.query(
        `SELECT * FROM memory_versions WHERE memory_id = $1 AND version_number = $2`,
        [memoryId, version]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      let memoryType: MemoryType = row.metadata?.memoryType;

      // Defensive fallback: if metadata.memoryType is missing, query the current memory record
      if (!memoryType) {
        try {
          const currentMemory = await this.config.postgresPool.query(
            `SELECT memory_type FROM memories WHERE id = $1`,
            [row.memory_id]
          );
          if (currentMemory.rows.length > 0) {
            memoryType = currentMemory.rows[0].memory_type as MemoryType;
            this.config.logger.warn(
              'memoryType missing from version metadata, retrieved from current memory record',
              { memoryId: row.memory_id, version }
            );
          } else {
            // Current memory not found, use default
            memoryType = 'semantic';
            this.config.logger.warn(
              'memoryType missing from version metadata and current memory not found, defaulting to semantic',
              { memoryId: row.memory_id, version }
            );
          }
        } catch (queryError) {
          // Fallback query failed, use default
          memoryType = 'semantic';
          this.config.logger.error(
            'Failed to query current memory for memoryType, defaulting to semantic',
            { memoryId: row.memory_id, version, error: queryError }
          );
        }
      }

      // Remove memoryType from metadata to maintain single source of truth
      const { memoryType: _, ...metadataWithoutType } = row.metadata || {};

      return {
        id: row.memory_id,
        content: row.content,
        memoryType,
        metadata: metadataWithoutType
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get memory version: ${errorMessage}`);
    }
  }

  /**
   * 特定の日時より古いソフト削除された記憶を検索
   */
  async findSoftDeletedMemories(olderThan: Date): Promise<MemoryId[]> {
    try {
      const result = await this.config.postgresPool.query(
        `SELECT id FROM memories WHERE is_deleted = true AND deleted_at < $1 AND is_protected = false`,
        [olderThan]
      );
      return result.rows.map(row => row.id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to find soft-deleted memories: ${errorMessage}`);
    }
  }

  /**
   * 現在のデータベースサイズ（バイト）を取得
   */
  async getDatabaseSize(): Promise<number> {
    try {
      const result = await this.config.postgresPool.query(
        `SELECT pg_database_size(current_database()) as size`
      );
      return Number(result.rows[0].size);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.config.logger.error(`Failed to get database size: ${errorMessage}`);
      return 0;
    }
  }

  /**
   * 最近アクセスされていない重要度の低い記憶を削除
   * 特定された記憶に対してソフト削除をトリガーします。
   * 正常に削除された記憶の数を返します。
   */
  async deleteLowImportanceMemories(
    importanceThreshold: number,
    lastAccessedOlderThan: Date
  ): Promise<number> {
    try {
      // Find candidate IDs
      const result = await this.config.postgresPool.query(
        `SELECT id FROM memories 
         WHERE importance_score < $1 
         AND last_accessed_at < $2
         AND is_protected = false
         AND is_deleted = false`,
        [importanceThreshold, lastAccessedOlderThan]
      );

      const ids = result.rows.map((row) => row.id);
      if (ids.length === 0) {
        return 0;
      }

      this.config.logger.info(
        `Found ${ids.length} low-importance memories to delete (GC).`
      );

      let successCount = 0;
      for (const id of ids) {
        // Use Saga to ensure consistency (Neo4j removal, etc.)
        const deleteResult = await this.deleteMemoryWithSaga(id);
        if (deleteResult.status === 'ok') {
          successCount++;
        } else {
          this.config.logger.warn(`Failed to auto-delete memory ${id}`, {
            error: deleteResult.status === 'failed' ? deleteResult.error : deleteResult.warning
          });
        }
      }

      return successCount;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.config.logger.error(`Failed to execute low importance GC: ${errorMessage}`);
      return 0;
    }
  }

  /**
   * エクスポネンシャルバックオフによるリトライ
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
