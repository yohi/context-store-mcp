/**
 * Memory Managerの実装
 * 記憶の保存、更新、削除を調整する
 * 要件: 1.1, 1.2, 1.6
 */

import { randomUUID } from 'node:crypto';
import type {
  Memory,
  MemoryId,
  MemoryError,
  MemoryManagerService,
  MemoryMetadata,
  Result,
  StoreMemoryParams,
  MemoryLink,
  MemoryLinkType,
  SearchParams,
  MemoryType,
  MemoryHistoryEntry,
  MemoryClassifierService,
} from './types.js';

import { Pool } from 'pg';
import type { VectorStoreAdapter, SearchOptions, EnhancedSearchResult } from '../storage/vector-store-adapter.js';
import type { GraphStoreAdapter } from '../storage/graph-store-adapter.js';
import type { TransactionCoordinator } from '../storage/transaction-coordinator.js';
import type { StorageAdapter } from '../storage/storage-adapter.js';
import { PostgresStorageAdapter } from '../storage/postgres-store-adapter.js';
import { getLogger } from '../monitoring/structured-logger.js';

const processLogger = getLogger();

export interface MemoryManagerConfig {
  storage?: StorageAdapter;
  vectorStore?: VectorStoreAdapter;
  graphStore?: GraphStoreAdapter;
  transactionCoordinator?: TransactionCoordinator | Partial<TransactionCoordinator>;
  classifier?: MemoryClassifierService;
}

export class MemoryManager implements MemoryManagerService {
  private storage: StorageAdapter;

  private vectorStore?: VectorStoreAdapter;
  private graphStore?: GraphStoreAdapter;
  private transactionCoordinator?: TransactionCoordinator;
  private classifier?: MemoryClassifierService;

  // このMemoryManagerがPoolを作成したかどうかを追跡
  private ownsStorage: boolean = false;

  // dispose()が既に呼ばれたかを追跡（冪等性のため）
  private isDisposed: boolean = false;

  constructor(config?: MemoryManagerConfig) {
    if (config?.storage) {
      this.storage = config.storage;
      this.ownsStorage = false; // 外部から提供されたストレージ
    } else {
      // デフォルトでPostgreSQLアダプターを使用
      const pool = new Pool({
        connectionString: process.env['DATABASE_URL'],
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });
      this.storage = new PostgresStorageAdapter(pool);
      this.ownsStorage = true; // このMemoryManagerがPoolを作成した
    }

    if (config) {
      if (config.vectorStore) this.vectorStore = config.vectorStore;
      if (config.graphStore) this.graphStore = config.graphStore;
      if (config.transactionCoordinator) this.transactionCoordinator = config.transactionCoordinator as TransactionCoordinator;
      if (config.classifier) this.classifier = config.classifier;
    }
  }



  /**
   * 自動ID生成とタイムスタンプ管理を行い、新しい記憶を保存する
   * 要件: 1.1 (永続的保存), 1.2 (セッション間アクセス), 1.6 (整合性維持)
   */
  async storeMemory(params: StoreMemoryParams): Promise<Result<MemoryId, MemoryError>> {
    // コンテンツの検証
    const validationError = this.validateContent(params.content);
    if (validationError !== null) {
      return {
        success: false,
        error: validationError,
      };
    }

    // 一意なIDの生成 (UUID v4)
    const memoryId = this.generateMemoryId();

    // デフォルト値でメタデータを処理
    const processedMetadata = this.processMetadata(params.metadata);

    // タイムスタンプの自動生成
    const timestamps = this.createTimestamps();

    // memoryTypeの正規化: トップレベルのparams.memoryTypeを優先、次にmetadata.memoryType
    const { memoryType: metadataType, ...metadataWithoutType } =
      processedMetadata as MemoryMetadata & { memoryType?: MemoryType };

    // 記憶タイプの決定: 明示的指定 > 分類器 > デフォルト
    let memoryType = params.memoryType || metadataType;

    if (!memoryType && this.classifier) {
      try {
        const classification = await this.classifier.classifyContent(params.content);
        memoryType = classification.primaryType;
      } catch (error) {
        console.error('Automatic classification failed:', error);
        // 分類に失敗した場合はsemanticにフォールバック
        memoryType = 'semantic';
      }
    }

    const finalMemoryType = memoryType || 'semantic';

    // 記憶エンティティの作成
    // memoryTypeは現在、トップレベルでのみ排他的に管理されています（単一の信頼できる情報源）
    const memory: Memory = {
      id: memoryId,
      content: params.content,
      memoryType: finalMemoryType,
      metadata: metadataWithoutType,
      ...timestamps,
      accessCount: 0,
      importanceScore: 0.0,
      isDeleted: false,
      isProtected: false,
      deletedAt: null, // 初期状態では削除されていない
      version: 1, // 初期バージョン
    };

    // Transaction Coordinatorが利用可能な場合は使用
    if (this.transactionCoordinator) {
      const entity = {
        id: memoryId,
        content: memory.content,
        memoryType: memory.memoryType,
        metadata: memory.metadata,
        ...(params.lite_mode_metadata ? { lite_mode_metadata: params.lite_mode_metadata } : {}),
      };

      const result = await this.transactionCoordinator.storeMemoryWithSaga(entity);

      if (result.status === 'failed') {
        return {
          success: false,
          error: {
            type: 'STORAGE_ERROR',
            message: result.error.message,
          },
        };
      }
      // 注意: Sagaが結果整合性を処理するため、現時点では部分的な成功の警告は無視します
    } else {
      processLogger.error('TransactionCoordinator unavailable for storeMemory', { memoryId });
      return {
        success: false,
        error: {
          type: 'TRANSACTION_UNAVAILABLE',
          message: 'TransactionCoordinator is required for data consistency but is unavailable',
        },
      };
    }

    // ベクトルストアに埋め込みを保存
    if (this.vectorStore) {
      try {
        await this.vectorStore.addEmbeddingForMemory(memoryId, memory.content);
      } catch (error) {
        console.error(`Failed to store embedding for memory ${memoryId}:`, error);
        // 埋め込みの失敗は警告としてログに記録し、操作自体は成功とみなす
      }
    }

    return {
      success: true,
      value: memoryId,
    };
  }

  /**
   * 既存の記憶を更新する
   * 要件: 1.3 (記憶更新), Task 3.2
   */
  async updateMemory(
    id: MemoryId,
    updates: Partial<Memory>
  ): Promise<Result<boolean, MemoryError>> {
    // 記憶が存在するか確認
    let existing: Memory | null = null;
    try {
      existing = await this.storage.getMemory(id);
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'STORAGE_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }

    if (!existing) {
      return {
        success: false,
        error: {
          type: 'MEMORY_NOT_FOUND',
          message: `Memory with ID ${id} not found`,
        },
      };
    }

    // 記憶が論理削除されているか確認
    if (existing.isDeleted) {
      return {
        success: false,
        error: {
          type: 'MEMORY_NOT_FOUND',
          message: `Memory with ID ${id} not found`,
        },
      };
    }

    // 記憶が保護されているか確認
    if (existing.isProtected) {
      return {
        success: false,
        error: {
          type: 'STORAGE_ERROR',
          message: `Cannot update protected memory: ${id}`,
        },
      };
    }

    // 更新される場合はコンテンツを検証
    if (updates.content !== undefined) {
      const validationError = this.validateContent(updates.content);
      if (validationError !== null) {
        return {
          success: false,
          error: validationError,
        };
      }
    }

    // 更新される場合はメタデータを正規化し、単一の信頼できる情報源を維持するためにmemoryTypeを削除
    let normalizedMetadata: MemoryMetadata | undefined = undefined;
    if (updates.metadata !== undefined) {
      const processed = this.processMetadata(updates.metadata);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { memoryType: _ignore, ...withoutType } = processed as MemoryMetadata & {
        memoryType?: MemoryType;
      };
      normalizedMetadata = withoutType;
    }

    // Transaction Coordinatorが利用可能な場合は使用
    if (this.transactionCoordinator) {
      // 更新前に現在のバージョンを履歴に保存
      const entityToArchive = {
        id: existing.id,
        content: existing.content,
        memoryType: existing.memoryType,
        metadata: existing.metadata,
      };
      await this.transactionCoordinator.saveMemoryVersion(entityToArchive, existing.version);

      // 保護されたフィールドを除外して更新された記憶を作成
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const {
        id: _id,
        createdAt: _createdAt,
        isDeleted: _isDeleted,
        deletedAt: _deletedAt,
        metadata: _metadata,
        version: _version, // 更新からバージョンを除外
        ...allowedUpdates
      } = updates;

      // 記憶を更新（保護されたフィールドを維持し、データの整合性を保つ）
      const updatedMemory: Memory = {
        ...existing,
        ...allowedUpdates,
        // 正規化されたメタデータが提供された場合は適用、それ以外は既存を維持
        ...(normalizedMetadata !== undefined ? { metadata: normalizedMetadata } : {}),
        id: existing.id, // IDは変更不可
        createdAt: existing.createdAt, // createdAtは変更不可
        isDeleted: existing.isDeleted, // isDeletedは更新経由で変更不可
        deletedAt: existing.deletedAt ?? null, // deletedAtは更新経由で変更不可、undefinedをnullに正規化
        updatedAt: new Date(), // 常にupdatedAtを更新
        version: existing.version + 1, // バージョンをインクリメント
      };

      // 記憶を更新
      const entity = {
        id: updatedMemory.id,
        content: updatedMemory.content,
        memoryType: updatedMemory.memoryType,
        metadata: updatedMemory.metadata,
        isProtected: updatedMemory.isProtected,
        isDeleted: updatedMemory.isDeleted,
      };

      const result = await this.transactionCoordinator.updateMemoryWithSaga(entity);

      if (result.status === 'failed') {
        return {
          success: false,
          error: {
            type: 'STORAGE_ERROR',
            message: result.error.message,
          },
        };
      }
    } else {
      processLogger.error('TransactionCoordinator unavailable for updateMemory', { memoryId: id });
      return {
        success: false,
        error: {
          type: 'TRANSACTION_UNAVAILABLE',
          message: 'TransactionCoordinator is required for data consistency but is unavailable',
        },
      };
    }

    // ベクトルストアの更新（コンテンツが変更された場合）
    if (this.vectorStore && updates.content) {
      try {
        await this.vectorStore.addEmbeddingForMemory(id, updates.content);
      } catch (error) {
        console.error(`Failed to update embedding for memory ${id}:`, error);
      }
    }

    return {
      success: true,
      value: true,
    };
  }

  /**
   * 記憶を論理削除する（削除済みとしてマークし、削除はしない）
   * 要件: 1.5 (削除), Task 3.2
   */
  async deleteMemory(id: MemoryId): Promise<Result<boolean, MemoryError>> {
    // 記憶が存在するか確認
    let existing: Memory | null = null;
    try {
      existing = await this.storage.getMemory(id);
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'STORAGE_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }

    if (!existing) {
      return {
        success: false,
        error: {
          type: 'MEMORY_NOT_FOUND',
          message: `Memory with ID ${id} not found`,
        },
      };
    }

    // 記憶が保護されているか確認
    if (existing.isProtected) {
      return {
        success: false,
        error: {
          type: 'STORAGE_ERROR',
          message: 'Cannot delete protected memory',
        },
      };
    }

    // Transaction Coordinatorが利用可能な場合は使用
    if (this.transactionCoordinator) {
      // 削除前に現在の状態を履歴に保存
      const entityToArchive = {
        id: existing.id,
        content: existing.content,
        memoryType: existing.memoryType,
        metadata: existing.metadata,
      };
      await this.transactionCoordinator.saveMemoryVersion(entityToArchive, existing.version);

      const result = await this.transactionCoordinator.deleteMemoryWithSaga(id);

      if (result.status === 'failed') {
        return {
          success: false,
          error: {
            type: 'STORAGE_ERROR',
            message: result.error.message,
          },
        };
      }
    } else {
      processLogger.error('TransactionCoordinator unavailable for deleteMemory', { memoryId: id });
      return {
        success: false,
        error: {
          type: 'TRANSACTION_UNAVAILABLE',
          message: 'TransactionCoordinator is required for data consistency but is unavailable',
        },
      };
    }

    // ベクトルストアからの削除（論理削除）
    if (this.vectorStore) {
      try {
        await this.vectorStore.deleteVector(id);
      } catch (error) {
        console.warn(`Failed to delete vector for memory ${id}:`, error);
      }
    }

    return {
      success: true,
      value: true,
    };
  }

  /**
   * IDで記憶を取得する
   * 要件: 1.2 (検索と取得)
   */
  async getMemory(id: MemoryId): Promise<Memory | null> {
    try {
      return await this.storage.getMemory(id);
    } catch (error) {
      console.error(`Failed to get memory ${id}:`, error);
      return null;
    }
  }

  /**
   * 論理削除された記憶を復元する（内部使用のみ）
   * 
   * このメソッドは、updateMemoryの保護フィールドフィルタリングをバイパスして、
   * isDeletedとdeletedAtフィールドを直接更新します。
   * 主にロールバックシナリオで使用されます。
   * 
   * @param id - 復元する記憶のID
   * @returns 成功した場合はtrue、失敗した場合はエラー
   */
  private async restoreMemory(id: MemoryId): Promise<Result<boolean, MemoryError>> {
    try {
      await this.storage.restoreMemory(id);
      return {
        success: true,
        value: true,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'STORAGE_ERROR',
          message: `Failed to restore memory ${id}: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  }

  /**
   * 記憶の履歴を取得する
   * 要件: Task 3.2
   */
  async getMemoryHistory(id: MemoryId): Promise<MemoryHistoryEntry[]> {
    if (this.transactionCoordinator) {
      try {
        const versions = await this.transactionCoordinator.getMemoryVersions(id);
        return versions.map((v: any) => ({
          id: v.id, // 履歴エントリID（記憶IDではない）
          memoryId: v.memoryId,
          version: v.version,
          content: v.content,
          metadata: v.metadata,
          timestamp: v.createdAt,
        }));
      } catch (error) {
        console.error('Failed to fetch history from DB:', error);
        return [];
      }
    }
    // インメモリ履歴は廃止されたため、TCがない場合は空配列を返す
    return [];
  }

  /**
   * 記憶を特定のバージョンに戻す
   * 要件: Task 3.2 Issue #1
   */
  async revertToVersion(memoryId: MemoryId, version: number): Promise<Result<boolean, MemoryError>> {
    // 1. ターゲットバージョンのデータを取得
    let targetContent: string | undefined;
    let targetMetadata: MemoryMetadata | undefined;

    if (this.transactionCoordinator) {
      try {
        const historicalMemory = await this.transactionCoordinator.getMemoryVersion(memoryId, version);
        if (historicalMemory) {
          targetContent = historicalMemory.content;
          targetMetadata = historicalMemory.metadata;
        }
      } catch (error) {
        return {
          success: false,
          error: {
            type: 'STORAGE_ERROR',
            message: `Failed to retrieve version ${version}: ${error instanceof Error ? error.message : String(error)}`,
          },
        };
      }
    } else {
      // インメモリ履歴廃止のため、TCがない場合はエラー
      return {
        success: false,
        error: {
          type: 'STORAGE_ERROR',
          message: 'Version history not available without TransactionCoordinator',
        },
      };
    }

    if (targetContent === undefined) {
      return {
        success: false,
        error: {
          type: 'MEMORY_NOT_FOUND',
          message: `Version ${version} not found for memory ${memoryId}`,
        },
      };
    }

    // 2. 古いコンテンツで記憶を更新（新しいバージョンを作成）
    const updates: Partial<Memory> = {
      content: targetContent,
    };
    if (targetMetadata) {
      updates.metadata = targetMetadata;
    }

    return this.updateMemory(memoryId, updates);
  }

  /**
   * ベクトル検索を使用して類似した記憶を検索する
   * 要件: 1.3 (類似記憶の自動検出), Task 3.2
   * 注意: これはインメモリ実装のプレースホルダーです。
   * 完全な実装にはVectorStoreAdapter (Task 5.1)とPostgreSQLが必要です。
   */
  async findSimilarMemories(content: string, limit: number = 5): Promise<Memory[]> {
    if (!this.vectorStore) {
      console.warn('VectorStoreAdapter is not available. Cannot perform semantic search.');
      return [];
    }
    if (!this.classifier) {
      console.warn('MemoryClassifierService is not available. Cannot generate embeddings for semantic search.');
      return [];
    }

    try {
      // const embedding = await this.classifier.generateEmbedding(content); // Now handled by vectorStore
      const results = await this.vectorStore.searchSimilar(content, limit);
      const memories: Memory[] = [];

      for (const r of results) {
        try {
          // storeMemoryと同じ検証/正規化パイプラインを通してメタデータを処理
          const processedMetadata = this.processMetadata(r.metadata as MemoryMetadata);

          // 単一の信頼できる情報源を維持するためにメタデータからmemoryTypeを抽出して削除
          const { memoryType: metadataType, ...metadataWithoutType } =
            processedMetadata as MemoryMetadata & { memoryType?: MemoryType };

          // 記憶タイプの決定: metadata.memoryTypeを優先、'semantic'にフォールバック
          const memoryType = metadataType || (r.metadata?.memoryType as MemoryType) || 'semantic';

          memories.push({
            id: r.id,
            content: r.content,
            memoryType,
            metadata: metadataWithoutType,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            lastAccessedAt: r.lastAccessedAt || new Date(),
            accessCount: r.accessCount || 0,
            importanceScore: r.importanceScore || 0,
            isDeleted: false,
            isProtected: false,
            version: r.version || 1,
            deletedAt: null,
          });
        } catch (error) {
          // 無効な結果をスキップし、エラーをログに記録
          console.warn(`Skipping invalid search result for memory ${r.id}:`, error);
          continue;
        }
      }

      return memories;
    } catch (error) {
      console.error('Vector search failed:', error);
      return [];
    }
  }

  /**
   * IDに基づいて類似した記憶を検索する (Issue #2)
   * 意味的類似性、タグの重複、時間的近接性を組み合わせる
   */
  async findSimilarMemoriesById(id: MemoryId, threshold: number = 0.8): Promise<Memory[]> {
    let target: Memory | null = null;
    try {
      target = await this.storage.getMemory(id);
    } catch (e) {
      return [];
    }

    if (!target) return [];

    // 記憶ごとの最高スコアを保存する候補マップ
    const candidates = new Map<MemoryId, { memory: Memory; score: number }>();

    // 1. 意味検索 (VectorStore経由)
    if (this.vectorStore) {
      try {
        const results = await this.vectorStore.searchSimilar(target.content, 20);
        for (const res of results) {
          if (res.id === id) continue; // 自分自身をスキップ

          // VectorSearchResultからMemoryオブジェクトを構築
          // 注意: 完全なMemoryオブジェクトではない可能性があるが、スコアリングには十分
          const memory: Memory = {
            id: res.id,
            content: res.content,
            memoryType: (res.metadata?.memoryType as MemoryType) || 'semantic',
            metadata: (res.metadata as MemoryMetadata) || {},
            createdAt: res.createdAt || new Date(),
            updatedAt: res.updatedAt || new Date(),
            lastAccessedAt: res.lastAccessedAt || new Date(),
            accessCount: res.accessCount || 0,
            importanceScore: res.importanceScore || 0,
            isDeleted: false,
            isProtected: false,
            version: res.version || 1,
            deletedAt: null,
          };

          candidates.set(res.id, { memory, score: res.similarity });
        }
      } catch (e) {
        console.warn('Vector search failed during findSimilarMemoriesById:', e);
      }
    }

    // 2. タグによる検索 (StorageAdapter経由)
    if (target.metadata.tags && target.metadata.tags.length > 0) {
      try {
        const tagMatches = await this.storage.searchMemories({ tags: target.metadata.tags, limit: 20 });
        for (const memory of tagMatches) {
          if (memory.id === id) continue;

          // 既に候補にある場合はスキップ（後でブースト）
          if (candidates.has(memory.id)) continue;

          // 新規候補として追加（スコア0、後でブースト）
          candidates.set(memory.id, { memory, score: 0.0 });
        }
      } catch (e) {
        console.warn('Tag search failed during findSimilarMemoriesById:', e);
      }
    }

    // 3. 最終スコアリングとフィルタリング
    const results: Memory[] = [];
    for (const [, item] of candidates) {
      let finalScore = item.score;

      // タグ重複のブースト (+0.15)
      if (this.calculateTagOverlap(target.metadata.tags, item.memory.metadata.tags)) {
        finalScore += 0.15;
      }
      // 時間的近接性のブースト (+0.10)
      if (item.memory.lastAccessedAt && target.lastAccessedAt && this.checkTimeProximity(target.lastAccessedAt, item.memory.lastAccessedAt)) {
        finalScore += 0.10;
      }

      // 閾値を確認
      if (finalScore >= threshold) {
        results.push(item.memory);
      }
    }

    // スコアでソート（同点の場合はupdatedAt）
    return results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  /**
   * 2つのタグ配列に重複があるか確認する
   */
  private calculateTagOverlap(tags1?: string[], tags2?: string[]): boolean {
    if (!tags1 || !tags2 || tags1.length === 0 || tags2.length === 0) return false;
    return tags1.some(t => tags2.includes(t));
  }

  /**
   * 2つの日付が互いに1時間以内かどうかを確認する
   */
  private checkTimeProximity(d1: Date, d2: Date): boolean {
    const diff = Math.abs(d1.getTime() - d2.getTime());
    const oneHour = 60 * 60 * 1000;
    return diff < oneHour;
  }

  /**
   * 指定された記憶と統合できる可能性のある記憶を提案する
   * 要件: Task 3.2 Issue #2
   */
  async suggestMerges(memoryId: MemoryId): Promise<Memory[]> {
    // 記憶の存在確認は findSimilarMemoriesById 内で行われるため、ここでは直接呼び出す
    // 高い閾値で強化された類似検索を使用
    // 統合のための強力な候補（意味的または強力な文脈的一致）が必要です
    // 閾値0.8は、良好な意味的一致、または（そこそこの一致 + タグ/時間ブースト）を意味します
    return this.findSimilarMemoriesById(memoryId, 0.8);
  }



  /**
   * 複数の記憶を単一の記憶に統合する
   * 要件: 1.3 (統合), Task 3.2
   */
  async mergeMemories(ids: MemoryId[]): Promise<Result<MemoryId, MemoryError>> {
    // 入力の検証
    if (ids.length < 2) {
      return {
        success: false,
        error: {
          type: 'INVALID_CONTENT',
          message: 'Must provide at least 2 memories to merge',
        },
      };
    }

    // すべての記憶が存在し、統合可能であることを確認
    const memories: Memory[] = [];
    for (const id of ids) {
      try {
        const memory = await this.storage.getMemory(id);
        if (!memory) {
          return {
            success: false,
            error: {
              type: 'MEMORY_NOT_FOUND',
              message: `Memory with ID ${id} not found`,
            },
          };
        }

        // 記憶が削除されているか確認
        if (memory.isDeleted) {
          return {
            success: false,
            error: {
              type: 'INVALID_CONTENT',
              message: `Cannot merge deleted memory: ${id}`,
            },
          };
        }

        // 記憶が保護されているか確認
        if (memory.isProtected) {
          return {
            success: false,
            error: {
              type: 'STORAGE_ERROR',
              message: `Cannot merge protected memory: ${id}`,
            },
          };
        }

        memories.push(memory);
      } catch (error) {
        return {
          success: false,
          error: {
            type: 'STORAGE_ERROR',
            message: `Failed to retrieve memory ${id}: ${error instanceof Error ? error.message : String(error)}`,
          },
        };
      }
    }

    // すべての記憶からコンテンツを結合
    const combinedContent = memories
      .map((m, index) => `[Memory ${index + 1}]\n${m.content}`)
      .join('\n\n');

    // すべての記憶からタグをマージ（一意のタグのみ、決定論的な順序でソート）
    const allTags = new Set<string>();
    for (const memory of memories) {
      // 反復処理の前にタグが配列であることを確認（防御的チェック）
      if (memory.metadata.tags && Array.isArray(memory.metadata.tags)) {
        for (const tag of memory.metadata.tags) {
          allTags.add(tag);
        }
      }
    }

    // 統合された記憶を作成
    // 最初の記憶のタイプを統合されたタイプとして使用（単一の信頼できる情報源）
    const mergedMemoryParams: StoreMemoryParams = {
      content: combinedContent,
      memoryType: memories[0]?.memoryType || 'semantic', // 最初の記憶のタイプを使用
      metadata: {
        tags: Array.from(allTags).sort(), // 安定した順序付けのためにソート
        source: 'merged',
        // 注意: memoryTypeはトップレベルでのみ管理されます（単一の信頼できる情報源）
      },
    };

    const mergeResult = await this.storeMemory(mergedMemoryParams);
    if (!mergeResult.success) {
      return mergeResult;
    }

    // 変更前にソース記憶のスナップショットをキャプチャ
    const snapshot = new Map<MemoryId, Memory>();
    for (const memory of memories) {
      snapshot.set(memory.id, { ...memory });
    }

    // 失敗時のロールバック付きでソース記憶を論理削除
    const deletedIds: MemoryId[] = [];
    for (const id of ids) {
      const deleteResult = await this.deleteMemory(id);
      if (!deleteResult.success) {
        // ロールバック: すべての変更されたソース記憶を復元
        // 注: 完全なロールバックは複雑（削除の取り消しが必要）。
        // ここでは、削除に失敗した時点で停止し、手動介入を促すエラーメッセージを返すのが現実的。
        // TransactionCoordinatorがあればSagaで補償されるはずだが、現状のアーキテクチャでは個別の操作の組み合わせ。

        // 簡易的なロールバック: 統合された記憶を削除
        await this.deleteMemory(mergeResult.value);

        // 既に削除されたソース記憶の復元を試みる
        for (const deletedId of deletedIds) {
          const original = snapshot.get(deletedId);
          if (original) {
            // 復元ロジック（isDeleted=falseにして更新）
            // updateMemoryは保護フィールドをフィルタリングするため、専用のrestoreMemoryメソッドを使用
            const restoreResult = await this.restoreMemory(deletedId);
            if (!restoreResult.success) {
              console.error(
                `Failed to restore source memory ${deletedId} during merge rollback:`,
                restoreResult.error
              );
            }
          }
        }

        return {
          success: false,
          error: {
            type: deleteResult.error.type,
            message: `Merge aborted: failed to delete source ${id} (${deleteResult.error.message})`,
          },
        };
      }
      deletedIds.push(id);
    }

    return {
      success: true,
      value: mergeResult.value,
    };
  }

  /**
   * 論理削除された記憶に対してガベージコレクションを実行する
   * 要件: Task 3.3 - ストレージ自動クリーンアップ
   */
  async performGarbageCollection(): Promise<void> {
    const now = new Date();
    const threshold = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30日前

    // 1. TransactionCoordinator経由のDBガベージコレクション
    if (this.transactionCoordinator) {
      try {
        // フェーズ1: 古い論理削除された記憶の物理削除
        const toRemove = await this.transactionCoordinator.findSoftDeletedMemories(threshold);
        if (toRemove.length > 0) {
          console.log(`[GC] Found ${toRemove.length} memories to delete physically.`);
          for (const id of toRemove) {
            const result = await this.transactionCoordinator.hardDeleteMemory(id);
            if (result.status === 'failed') {
              console.error(`[GC] Failed to delete memory ${id}:`, result.error);
            } else if (result.status === 'partial') {
              console.warn(`[GC] Partial deletion for memory ${id}:`, result.warning);
            }
          }
        }

        // フェーズ2: ストレージ圧迫管理 (Issue #4)
        const usageRatio = await this.getStorageUsageRatio();
        if (usageRatio >= 0.8) {
          console.warn(`[GC] Storage usage high (${(usageRatio * 100).toFixed(1)}%). Initiating auto-cleanup.`);
          // 30日間アクセスされていない重要でない記憶（スコア < 0.3）を削除
          const deletedCount = await this.transactionCoordinator.deleteLowImportanceMemories(0.3, threshold);
          if (deletedCount > 0) {
            console.log(`[GC] Auto-deleted ${deletedCount} low-importance memories to free space.`);
          }
        }

      } catch (error) {
        console.error('[GC] Failed to perform DB garbage collection:', error);
      }
    }

  }

  /**
   * 現在のストレージ使用率を取得する
   * Issue #4のヘルパー
   */
  private async getStorageUsageRatio(): Promise<number> {
    if (!this.transactionCoordinator) return 0;

    try {
      const usedBytes = await this.transactionCoordinator.getDatabaseSize();
      const limitBytes = Number(process.env['DB_SIZE_LIMIT_BYTES']) || 10737418240; // デフォルト10GB

      if (limitBytes <= 0) return 0;
      return usedBytes / limitBytes;
    } catch (error) {
      console.warn('Failed to check storage usage:', error);
      return 0;
    }
  }

  /**
   * 重要度スコアの更新と記憶の圧縮によりストレージを最適化する
   * 要件: Task 3.3 - ストレージ最適化
   */
  async optimizeStorage(): Promise<void> {
    // インメモリ最適化は廃止されました。
    // 将来的には、ここでTransactionCoordinatorを使用してDB側の最適化（VACUUMやインデックス再構築など）をトリガーできます。

    // 圧縮: 十分に長く削除されている論理削除された記憶を削除
    await this.performGarbageCollection();
  }

  /**
   * 保存前にコンテンツを検証する
   * 要件: データ整合性チェック (1.6)
   */
  private validateContent(content: string): MemoryError | null {
    // コンテンツが空または空白のみか確認
    if (content.trim().length === 0) {
      return {
        type: 'INVALID_CONTENT',
        message: 'Content cannot be empty or contain only whitespace',
      };
    }

    return null;
  }

  /**
   * UUID v4を使用して一意な記憶IDを生成する
   * 要件: 一意な識別子の生成 (Task 3.1)
   */
  private generateMemoryId(): MemoryId {
    return randomUUID();
  }

  /**
   * メタデータを処理および検証し、必要に応じてデフォルト値を適用する
   * 要件: メタデータ処理 (Task 3.1)
   */
  private processMetadata(metadata?: MemoryMetadata): MemoryMetadata {
    const processed: MemoryMetadata = {
      ...(metadata ?? {}),
    };

    // 提供されていない場合はタイムスタンプを設定
    if (processed.timestamp === undefined) {
      processed.timestamp = new Date();
    }

    // タグが配列であることを確認
    if (processed.tags !== undefined && !Array.isArray(processed.tags)) {
      processed.tags = [];
    }

    return processed;
  }

  /**
   * 記憶ライフサイクルイベントの自動タイムスタンプを作成する
   * 要件: 自動タイムスタンプ管理 (Task 3.1)
   */
  private createTimestamps(): {
    createdAt: Date;
    updatedAt: Date;
    lastAccessedAt: Date;
  } {
    const now = new Date();
    return {
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
    };
  }

  /**
   * 2つの記憶間にリンクを作成する (Task 4.3)
   * 要件: 3.5 (タイプ間リンクの生成と維持)
   */
  async createLink(
    from: MemoryId,
    to: MemoryId,
    _linkType: MemoryLinkType,
    strength: number = 0.5,
    _createdBy: 'user' | 'system' = 'system',
    _reasoning?: string
  ): Promise<Result<string, MemoryError>> {
    // 自己リンクを防止
    if (from === to) {
      return {
        success: false,
        error: {
          type: 'INVALID_CONTENT',
          message: `Self-links are not allowed: cannot link memory ${from} to itself`,
        },
      };
    }

    // DBから確認
    try {
      const fromMemory = await this.storage.getMemory(from);
      const toMemory = await this.storage.getMemory(to);

      if (!fromMemory) {
        return {
          success: false,
          error: {
            type: 'MEMORY_NOT_FOUND',
            message: `Source memory with ID ${from} not found`,
          },
        };
      }

      if (!toMemory) {
        return {
          success: false,
          error: {
            type: 'MEMORY_NOT_FOUND',
            message: `Target memory with ID ${to} not found`,
          },
        };
      }

      // いずれかの記憶が削除されているか確認
      if (fromMemory.isDeleted) {
        return {
          success: false,
          error: {
            type: 'MEMORY_NOT_FOUND',
            message: `Cannot create link: source memory ${from} is deleted`,
          },
        };
      }

      if (toMemory.isDeleted) {
        return {
          success: false,
          error: {
            type: 'MEMORY_NOT_FOUND',
            message: `Cannot create link: target memory ${to} is deleted`,
          },
        };
      }
    } catch (e) {
      return {
        success: false,
        error: {
          type: 'STORAGE_ERROR',
          message: String(e),
        },
      };
    }

    // 強度の範囲を検証
    if (strength < 0 || strength > 1) {
      return {
        success: false,
        error: {
          type: 'INVALID_CONTENT',
          message: `Link strength must be between 0 and 1, got ${strength}`,
        },
      };
    }

    if (this.graphStore) {
      try {
        const linkId = await this.graphStore.createRelationship(from, to, _linkType, {
          strength,
          createdBy: _createdBy,
          ...(_reasoning ? { reasoning: _reasoning } : {}),
          createdAt: new Date(),
        });
        return {
          success: true,
          value: linkId,
        };
      } catch (error) {
        return {
          success: false,
          error: {
            type: 'STORAGE_ERROR',
            message: `Failed to create link: ${error instanceof Error ? error.message : String(error)}`,
          },
        };
      }
    }

    return {
      success: false,
      error: {
        type: 'STORAGE_ERROR',
        message: 'GraphStoreAdapter is not available',
      },
    };
  }

  /**
   * 記憶のすべてのリンクを取得する（双方向）
   * 要件: 3.5 (相互参照の管理)
   */
  async getLinks(memoryId: MemoryId): Promise<MemoryLink[]> {
    if (this.graphStore) {
      try {
        const relationships = await this.graphStore.getNodeRelationships(memoryId, 'both');
        return relationships.map((rel) => {
          const metadata: MemoryLink['metadata'] = {
            createdAt: (rel.properties.createdAt as Date) || new Date(),
            createdBy: (rel.properties.createdBy as 'user' | 'system') || 'system',
          };
          if (rel.properties.reasoning) {
            metadata.reasoning = rel.properties.reasoning as string;
          }

          return {
            linkId: rel.id,
            fromMemoryId: rel.fromNodeId,
            toMemoryId: rel.toNodeId,
            linkType: rel.type as MemoryLinkType,
            strength: (rel.properties.strength as number) || 0.5,
            metadata,
          };
        });
      } catch (error) {
        console.error(`Failed to get links for memory ${memoryId}:`, error);
        return [];
      }
    }
    return [];
  }

  /**
   * リンクを削除する
   * 要件: 3.5 (リンク管理)
   */
  async deleteLink(linkId: string): Promise<Result<boolean, MemoryError>> {
    if (this.graphStore) {
      try {
        const success = await this.graphStore.deleteRelationship(linkId);
        if (success) {
          return { success: true, value: true };
        } else {
          return {
            success: false,
            error: {
              type: 'STORAGE_ERROR',
              message: `Link with ID ${linkId} not found or could not be deleted`,
            },
          };
        }
      } catch (error) {
        return {
          success: false,
          error: {
            type: 'STORAGE_ERROR',
            message: `Failed to delete link ${linkId}: ${error instanceof Error ? error.message : String(error)}`,
          },
        };
      }
    }

    return {
      success: false,
      error: {
        type: 'STORAGE_ERROR',
        message: 'GraphStoreAdapter is not available',
      },
    };
  }

  /**
   * タイプフィルタリングを使用して記憶を検索する
   * 要件: 3.6 (タイプフィルタリング機能)
   */
  async searchMemories(params: SearchParams): Promise<Memory[]> {
    // クエリがあり、VectorStoreが利用可能な場合はベクトル検索を使用
    if (params.query && this.vectorStore) {
      try {
        const filter: any = {};
        if (params.tags) {
          filter.tags = params.tags;
        }
        if (params.memoryTypes && params.memoryTypes.length > 0) {
          filter.memoryType = params.memoryTypes[0];
        }

        const options: SearchOptions = {
          limit: params.limit ?? 10, // デフォルト値を設定
          filter,
          minSimilarity: 0.6, // デフォルトの閾値
        };

        const results: EnhancedSearchResult[] = await this.vectorStore.searchSimilarAdvanced(params.query, options);

        return results.map(r => {
          // メタデータを処理
          const processedMetadata = this.processMetadata(r.metadata as MemoryMetadata);
          const { memoryType: metadataType, ...metadataWithoutType } =
            processedMetadata as MemoryMetadata & { memoryType?: MemoryType };

          const memoryType = metadataType || (r.metadata?.memoryType as MemoryType) || 'semantic';

          return {
            id: r.id,
            content: r.content,
            memoryType,
            metadata: metadataWithoutType,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            lastAccessedAt: r.lastAccessedAt || new Date(),
            accessCount: r.accessCount || 0,
            importanceScore: r.importanceScore || 0,
            isDeleted: false,
            isProtected: false,
            version: r.version || 1,
            deletedAt: null,
          };
        });
      } catch (error) {
        console.error('Vector search failed, falling back to basic search:', error);
        // フォールバックして下の基本検索を実行
      }
    }

    try {
      return await this.storage.searchMemories(params);
    } catch (error) {
      console.error('Search failed:', error);
      return [];
    }
  }

  /**
   * 記憶タイプを上書きする（ユーザーは自動分類されたタイプを手動で変更可能）
   * 要件: 3.4 design.md 決定2 (ユーザーによるタイプ上書き可能)
   */
  async overrideMemoryType(
    memoryId: MemoryId,
    newType: MemoryType
  ): Promise<Result<boolean, MemoryError>> {
    return this.updateMemory(memoryId, { memoryType: newType });
  }

  /**
   * すべての記憶IDを取得する（整合性調整用）
   * 要件: 5.4 (整合性監視)
   */
  async getAllMemoryIds(): Promise<MemoryId[]> {
    try {
      return await this.storage.getAllMemoryIds();
    } catch (e) {
      console.error('Failed to get all memory IDs:', e);
      return [];
    }
  }

  /**
   * MemoryManagerが所有するリソースをクリーンアップする
   * 
   * このメソッドは、MemoryManagerが作成したデータベース接続プールを
   * 適切にクローズします。アプリケーションのシャットダウン時に呼び出す必要があります。
   * 
   * このメソッドは冪等であり、複数回呼び出しても安全です。
   * 
   * @example
   * ```typescript
   * const memoryManager = new MemoryManager();
   * // ... 使用 ...
   * await memoryManager.dispose(); // シャットダウン時
   * ```
   */
  async dispose(): Promise<void> {
    // 既にdisposeされている場合は何もしない（冪等性）
    if (this.isDisposed) {
      return;
    }

    // このMemoryManagerがストレージを作成した場合のみクローズ
    if (this.ownsStorage && this.storage instanceof PostgresStorageAdapter) {
      try {
        await this.storage.close();
        console.log('MemoryManager: PostgreSQL connection pool closed');
      } catch (error) {
        console.error('MemoryManager: Error closing storage:', error);
        throw error;
      }
    }

    this.isDisposed = true;
  }
}
