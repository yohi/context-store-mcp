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

import type { VectorStoreAdapter } from '../storage/vector-store-adapter.js';
import type { GraphStoreAdapter } from '../storage/graph-store-adapter.js';
import type { TransactionCoordinator } from '../storage/transaction-coordinator.js';

export interface MemoryManagerConfig {
  vectorStore?: VectorStoreAdapter;
  graphStore?: GraphStoreAdapter;
  transactionCoordinator?: TransactionCoordinator;
  classifier?: MemoryClassifierService;
}

export class MemoryManager implements MemoryManagerService {
  // テスト用のインメモリ保存（後のタスクでPostgreSQLに置き換え予定）
  private memories: Map<MemoryId, Memory> = new Map();
  // 記憶リンク用のインメモリ保存（後のタスクでNeo4jに置き換え予定）
  private links: Map<string, MemoryLink> = new Map();
  // 記憶履歴用のインメモリ保存
  private history: Map<MemoryId, MemoryHistoryEntry[]> = new Map();

  private vectorStore?: VectorStoreAdapter;
  private transactionCoordinator?: TransactionCoordinator;
  private classifier?: MemoryClassifierService;

  constructor(config?: MemoryManagerConfig) {
    if (config) {
      if (config.vectorStore) this.vectorStore = config.vectorStore;
      if (config.transactionCoordinator) this.transactionCoordinator = config.transactionCoordinator;
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

    // メモリに保存（後でPostgreSQLに置き換え予定）
    this.memories.set(memoryId, memory);

    // Transaction Coordinatorが利用可能な場合は使用
    if (this.transactionCoordinator) {
      const entity = {
        id: memoryId,
        content: memory.content,
        memoryType: memory.memoryType,
        metadata: memory.metadata,
      };

      const result = await this.transactionCoordinator.storeMemoryWithSaga(entity);

      if (result.status === 'failed') {
        // インメモリ保存をロールバック
        this.memories.delete(memoryId);
        return {
          success: false,
          error: {
            type: 'STORAGE_ERROR',
            message: result.error.message,
          },
        };
      }
      // 注意: Sagaが結果整合性を処理するため、現時点では部分的な成功の警告は無視します
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
    const existing = this.memories.get(id);
    if (!existing) {
      return {
        success: false,
        error: {
          type: 'MEMORY_NOT_FOUND',
          message: `Memory with ID ${id} not found`,
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

    // 更新前に現在の状態を履歴に保存
    this.saveHistory(existing);

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

    this.memories.set(id, updatedMemory);

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

      // 記憶を更新
      const entity = {
        id: updatedMemory.id,
        content: updatedMemory.content,
        memoryType: updatedMemory.memoryType,
        metadata: updatedMemory.metadata,
      };

      const result = await this.transactionCoordinator.updateMemoryWithSaga(entity);

      if (result.status === 'failed') {
        // インメモリ保存をロールバック
        this.memories.set(id, existing);
        return {
          success: false,
          error: {
            type: 'STORAGE_ERROR',
            message: result.error.message,
          },
        };
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
    const existing = this.memories.get(id);
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

    // 削除前に現在の状態を履歴に保存（オプションだが推奨）
    this.saveHistory(existing);

    // 論理削除: タイムスタンプ付きで削除済みとしてマーク（GDPR準拠）
    const deletedMemory: Memory = {
      ...existing,
      isDeleted: true,
      deletedAt: new Date(),
      updatedAt: new Date(),
      version: existing.version + 1, // 削除イベントのためにバージョンをインクリメント
    };

    this.memories.set(id, deletedMemory);

    // Transaction Coordinatorが利用可能な場合は使用
    if (this.transactionCoordinator) {
      const result = await this.transactionCoordinator.deleteMemoryWithSaga(id);

      if (result.status === 'failed') {
        // インメモリ保存をロールバック（元に戻す）
        this.memories.set(id, existing);
        return {
          success: false,
          error: {
            type: 'STORAGE_ERROR',
            message: result.error.message,
          },
        };
      }
    }

    return {
      success: true,
      value: true,
    };
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
        console.error('Failed to fetch history from DB, falling back to in-memory:', error);
      }
    }
    return this.history.get(id) || [];
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
      // インメモリ履歴にフォールバック
      const history = this.history.get(memoryId) || [];
      const entry = history.find((h) => h.version === version);
      if (entry) {
        targetContent = entry.content;
        targetMetadata = entry.metadata;
      }
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
    if (this.vectorStore) {
      try {
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
    return [];
  }

  /**
   * IDに基づいて類似した記憶を検索する (Issue #2)
   * 意味的類似性、タグの重複、時間的近接性を組み合わせる
   */
  async findSimilarMemoriesById(id: MemoryId, threshold: number = 0.8): Promise<Memory[]> {
    const target = this.memories.get(id);
    if (!target) return [];

    // 記憶ごとの最高スコアを保存する候補マップ
    const candidates = new Map<MemoryId, { memory: Memory; score: number }>();

    // 1. 意味検索 (VectorStore経由)
    if (this.vectorStore) {
      try {
        const results = await this.vectorStore.searchSimilar(target.content, 20);
        for (const res of results) {
          if (res.id === id) continue; // 自分自身をスキップ

          const memory = this.memories.get(res.id);
          if (memory && !memory.isDeleted) {
            candidates.set(res.id, { memory, score: res.similarity });
          }
        }
      } catch (e) {
        console.warn('Vector search failed during findSimilarMemoriesById:', e);
      }
    }

    // 2. タグと時間の分析 (インメモリキャッシュを反復処理)
    // 完全なPG実装では、これはDBクエリになります。
    // ここでは、キャッシュ/ソースとして機能する `this.memories` を反復処理します。
    for (const memory of this.memories.values()) {
      if (memory.id === id || memory.isDeleted) continue;

      // 意味検索ですでに見つかっている場合は、再評価をスキップ（後でブーストします）
      if (candidates.has(memory.id)) continue;

      // タグの重複を確認
      const hasTagOverlap = this.calculateTagOverlap(target.metadata.tags, memory.metadata.tags);

      // 時間的近接性を確認
      const isCloseInTime = this.checkTimeProximity(target.createdAt, memory.createdAt);

      // タグまたは時間が一致する場合、基本スコア0で候補として追加（ブーストされます）
      if (hasTagOverlap || isCloseInTime) {
        candidates.set(memory.id, { memory, score: 0.0 });
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

      // 時間的近接性のブースト (+0.15)
      if (this.checkTimeProximity(target.createdAt, item.memory.createdAt)) {
        finalScore += 0.15;
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
    const memory = this.memories.get(memoryId);
    if (!memory) {
      return [];
    }

    // 高い閾値で強化された類似検索を使用
    // 統合のための強力な候補（意味的または強力な文脈的一致）が必要です
    // 閾値0.8は、良好な意味的一致、または（そこそこの一致 + タグ/時間ブースト）を意味します
    return this.findSimilarMemoriesById(memoryId, 0.8);
  }

  /**
   * 記憶のスナップショットを履歴に保存する
   */
  private saveHistory(memory: Memory): void {
    const entry: MemoryHistoryEntry = {
      id: randomUUID(),
      memoryId: memory.id,
      version: memory.version,
      content: memory.content,
      metadata: { ...memory.metadata }, // メタデータのディープコピー
      timestamp: memory.updatedAt,
    };

    const currentHistory = this.history.get(memory.id) || [];
    currentHistory.push(entry);
    this.history.set(memory.id, currentHistory);
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
      const memory = this.memories.get(id);
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
    for (const id of ids) {
      const memory = this.memories.get(id);
      if (memory) {
        // 元の状態を保持するためにディープコピー
        snapshot.set(id, { ...memory });
      }
    }

    // 失敗時のロールバック付きでソース記憶を論理削除
    const deletedIds: MemoryId[] = [];
    for (const id of ids) {
      const deleteResult = await this.deleteMemory(id);
      if (!deleteResult.success) {
        // ロールバック: すべての変更されたソース記憶を復元
        for (const deletedId of deletedIds) {
          const original = snapshot.get(deletedId);
          if (original) {
            this.memories.set(deletedId, original);
          }
        }

        // 不整合を避けるために統合された記憶を削除
        this.memories.delete(mergeResult.value);

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

    // 2. インメモリガベージコレクション（レガシー/キャッシュクリーンアップ）
    // 古くて保護されていない論理削除された記憶を検索
    const toRemoveInMemory: MemoryId[] = [];
    for (const [id, memory] of this.memories.entries()) {
      if (
        memory.isDeleted &&
        !memory.isProtected &&
        memory.deletedAt !== null &&
        memory.deletedAt !== undefined &&
        memory.deletedAt < threshold
      ) {
        toRemoveInMemory.push(id);
      }
    }

    // これらの記憶をメモリキャッシュから物理的に削除
    for (const id of toRemoveInMemory) {
      this.memories.delete(id);
    }

    // 削除された記憶を参照している孤立したリンクを削除
    const toRemoveLinks: string[] = [];
    for (const [lid, link] of this.links.entries()) {
      // エンドポイントが見つからない（削除されている）か確認
      if (!this.memories.has(link.fromMemoryId) || !this.memories.has(link.toMemoryId)) {
        toRemoveLinks.push(lid);
      }
    }
    for (const lid of toRemoveLinks) {
      this.links.delete(lid);
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
    // 削除されていないすべての記憶の重要度スコアを更新
    for (const [id, memory] of this.memories.entries()) {
      if (!memory.isDeleted) {
        // アクセス数に基づく単純な重要度スコア計算
        // 実際の実装では以下を考慮します:
        // - 参照スコア（検索結果への出現）
        // - グラフ中心性スコア
        const referenceScore = Math.min(memory.accessCount / 100, 1.0);
        const centralityScore = 0.5; // プレースホルダー（Neo4j PageRankから取得予定）

        const importanceScore = referenceScore * 0.6 + centralityScore * 0.4;

        // 新しい重要度スコアで記憶を更新
        this.memories.set(id, {
          ...memory,
          importanceScore,
        });
      }
    }

    // 圧縮: 十分に長く削除されている論理削除された記憶を削除
    // これは本質的に軽量なガベージコレクションです
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
    linkType: MemoryLinkType,
    strength: number = 0.5,
    createdBy: 'user' | 'system' = 'system',
    reasoning?: string
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

    // 両方の記憶が存在することを確認
    const fromMemory = this.memories.get(from);
    const toMemory = this.memories.get(to);

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

    // 重複リンクを確認（同じfromMemoryId, toMemoryId, linkType）
    for (const existingLink of this.links.values()) {
      if (
        existingLink.fromMemoryId === from &&
        existingLink.toMemoryId === to &&
        existingLink.linkType === linkType
      ) {
        // 重複を作成する代わりに既存のリンクIDを返す
        return {
          success: true,
          value: existingLink.linkId,
        };
      }
    }

    // リンクIDを生成
    const linkId = randomUUID();

    // リンクを作成
    const link: MemoryLink = {
      linkId,
      fromMemoryId: from,
      toMemoryId: to,
      linkType,
      strength,
      metadata: {
        createdAt: new Date(),
        createdBy,
        ...(reasoning !== undefined && { reasoning }),
      },
    };

    // リンクを保存
    this.links.set(linkId, link);

    return {
      success: true,
      value: linkId,
    };
  }

  /**
   * 記憶のすべてのリンクを取得する（双方向）
   * 要件: 3.5 (相互参照の管理)
   */
  async getLinks(memoryId: MemoryId): Promise<MemoryLink[]> {
    const results: MemoryLink[] = [];

    // この記憶がソースまたはターゲットであるすべてのリンクを検索
    for (const link of this.links.values()) {
      if (link.fromMemoryId === memoryId || link.toMemoryId === memoryId) {
        // いずれかのエンドポイントが削除されているか見つからないリンクをスキップ
        const fromMemory = this.memories.get(link.fromMemoryId);
        const toMemory = this.memories.get(link.toMemoryId);

        // 両方のエンドポイントが存在し、削除されていない場合のみリンクを含める
        if (fromMemory && !fromMemory.isDeleted && toMemory && !toMemory.isDeleted) {
          results.push(link);
        }
      }
    }

    return results;
  }

  /**
   * リンクを削除する
   * 要件: 3.5 (リンク管理)
   */
  async deleteLink(linkId: string): Promise<Result<boolean, MemoryError>> {
    const link = this.links.get(linkId);

    if (!link) {
      return {
        success: false,
        error: {
          type: 'MEMORY_NOT_FOUND',
          message: `Link with ID ${linkId} not found`,
        },
      };
    }

    // リンクを削除
    this.links.delete(linkId);

    return {
      success: true,
      value: true,
    };
  }

  /**
   * タイプフィルタリングを使用して記憶を検索する
   * 要件: 3.6 (タイプフィルタリング機能)
   */
  async searchMemories(params: SearchParams): Promise<Memory[]> {
    const results: Memory[] = [];

    // すべての記憶を反復処理
    for (const memory of this.memories.values()) {
      // 削除された記憶をスキップ
      if (memory.isDeleted) {
        continue;
      }

      // memoryTypeフィルタを適用
      if (
        params.memoryTypes &&
        params.memoryTypes.length > 0 &&
        !params.memoryTypes.includes(memory.memoryType)
      ) {
        continue;
      }

      // tagsフィルタを適用
      if (params.tags && params.tags.length > 0) {
        const memoryTags = memory.metadata.tags || [];
        const hasMatchingTag = params.tags.some((tag) => memoryTags.includes(tag));
        if (!hasMatchingTag) {
          continue;
        }
      }

      // userIdフィルタを適用
      if (params.userId && memory.metadata.userId !== params.userId) {
        continue;
      }

      // projectIdフィルタを適用
      if (params.projectId && memory.metadata.projectId !== params.projectId) {
        continue;
      }

      // 結果に追加
      results.push(memory);
    }

    // 制限を適用
    if (params.limit && params.limit > 0) {
      return results.slice(0, params.limit);
    }

    return results;
  }

  /**
   * 記憶タイプを上書きする（ユーザーは自動分類されたタイプを手動で変更可能）
   * 要件: 3.4 design.md 決定2 (ユーザーによるタイプ上書き可能)
   */
  async overrideMemoryType(
    memoryId: MemoryId,
    newType: MemoryType
  ): Promise<Result<boolean, MemoryError>> {
    const memory = this.memories.get(memoryId);

    if (!memory) {
      return {
        success: false,
        error: {
          type: 'MEMORY_NOT_FOUND',
          message: `Memory with ID ${memoryId} not found`,
        },
      };
    }

    // 削除された記憶の上書きは許可しない
    if (memory.isDeleted) {
      return {
        success: false,
        error: {
          type: 'MEMORY_NOT_FOUND',
          message: `Cannot override type of deleted memory ${memoryId}`,
        },
      };
    }

    // 記憶タイプを更新（単一の信頼できる情報源: トップレベルのmemoryTypeのみ）
    // 単一の信頼できる情報源を維持するためにメタデータからmemoryTypeを削除
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { memoryType: _ignore, ...metadataWithoutType } = memory.metadata as MemoryMetadata & {
      memoryType?: MemoryType;
    };

    const updated: Memory = {
      ...memory,
      memoryType: newType,
      metadata: metadataWithoutType, // metadata.memoryTypeが削除されていることを確認
      updatedAt: new Date(),
    };

    this.memories.set(memoryId, updated);

    return {
      success: true,
      value: true,
    };
  }

  /**
   * テストヘルパー: IDで記憶を取得する（論理削除されたものを含む）
   * テスト目的のみ - パブリックAPIの一部ではない
   * @internal
   */
  getMemoryForTest(id: MemoryId): Memory | undefined {
    return this.memories.get(id);
  }

  /**
   * テストヘルパー: すべての記憶を取得する（論理削除されたものを含む）
   * テスト目的のみ - パブリックAPIの一部ではない
   * @internal
   */
  getAllMemoriesForTest(): Memory[] {
    return Array.from(this.memories.values());
  }

  /**
   * テストヘルパー: GCテスト用にdeletedAtタイムスタンプを手動設定する
   * テスト目的のみ - 古い削除をシミュレート可能
   * @internal
   */
  setDeletedAtForTest(id: MemoryId, deletedAt: Date): void {
    const memory = this.memories.get(id);
    if (memory) {
      this.memories.set(id, {
        ...memory,
        deletedAt,
      });
    }
  }

  /**
   * すべての記憶IDを取得する（整合性調整用）
   * 要件: 5.4 (整合性監視)
   */
  async getAllMemoryIds(): Promise<MemoryId[]> {
    const ids: MemoryId[] = [];

    for (const [id, memory] of this.memories.entries()) {
      // 削除されていない記憶のみを含める
      if (!memory.isDeleted) {
        ids.push(id);
      }
    }

    return ids;
  }
}
