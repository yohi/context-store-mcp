/**
 * Lite Mode Query Processor Implementation
 *
 * Task 8.1: LiteModeQueryProcessorクラスの実装
 * - Liteモード用の検索重み設定
 * - 新しさスコアの重視
 * - 手続き記憶タイプのブースト
 * - ファイルパスコンテキストの優先
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */

import { QueryProcessor } from './query-processor.js';
import type {
  HybridSearchOptions,
  HybridSearchResult,
  SearchFilters,
} from './types.js';
import type { Memory } from '../memory/types.js';
import type { LRUCache } from '../mcp/lru-cache.js';
import type { VectorStoreAdapter } from '../storage/vector-store-adapter.js';

/**
 * GraphStoreAdapter の型定義（暫定）
 */
interface GraphStoreAdapter {
  search?(query: string, options?: { limit?: number }): Promise<any[]>;
  traverseGraph?(
    startNode: string,
    pattern: any,
    params?: Record<string, unknown>
  ): Promise<any[]>;
}

/**
 * 検索重み設定
 */
export interface SearchWeights {
  /** 新しさの重み (デフォルト: 0.4) */
  recency: number;
  /** 関連性の重み (デフォルト: 0.3) */
  relevance: number;
  /** 手続き記憶の重み (デフォルト: 0.2) */
  procedural: number;
  /** ファイルパスコンテキストの重み (デフォルト: 0.1) */
  filePath: number;
}

/**
 * 検索コンテキスト
 */
export interface SearchContext {
  /** ファイルパス */
  filePath?: string;
  /** プロジェクト名 */
  project?: string;
  /** その他のコンテキスト情報 */
  [key: string]: unknown;
}

/**
 * 拡張された検索結果
 */
export interface ExtendedSearchResult extends HybridSearchResult {
  /** 新しさスコア (0.0 - 1.0) */
  recencyScore?: number;
  /** ファイルパスマッチスコア (0.0 - 1.0) */
  filePathScore?: number;
  /** 最終的な統合スコア */
  finalScore: number;
}

/**
 * Liteモード用クエリプロセッサー
 *
 * 個人使用に最適化された検索パラメータを提供:
 * - 新しさを重視 (recency: 0.4)
 * - 手続き記憶タイプのブースト (procedural: 0.2)
 * - ファイルパスコンテキストの優先 (filePath: 0.1)
 * - 関連性スコア (relevance: 0.3)
 */
export class LiteModeQueryProcessor extends QueryProcessor {
  private readonly defaultWeights: SearchWeights;

  /**
   * コンストラクタ
   *
   * @param options 設定オプション
   */
  constructor(options?: {
    cache?: LRUCache<any>;
    vectorAdapter?: VectorStoreAdapter;
    graphAdapter?: GraphStoreAdapter;
    weights?: Partial<SearchWeights>;
  }) {
    super(options);

    // Liteモード用のデフォルト重み設定
    this.defaultWeights = {
      recency: options?.weights?.recency ?? 0.4,
      relevance: options?.weights?.relevance ?? 0.3,
      procedural: options?.weights?.procedural ?? 0.2,
      filePath: options?.weights?.filePath ?? 0.1,
    };
  }

  /**
   * Liteモード用の検索重みを取得
   *
   * Requirements: 7.1, 7.5
   * @returns 検索重み設定
   */
  getLiteModeWeights(): SearchWeights {
    return { ...this.defaultWeights };
  }

  /**
   * 拡張検索 - Liteモード最適化を適用
   *
   * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
   *
   * @param query 検索クエリ文字列
   * @param context 検索コンテキスト（ファイルパス、プロジェクトなど）
   * @param options ハイブリッド検索オプション
   * @returns 拡張された検索結果配列
   */
  async search(
    query: string,
    context?: SearchContext,
    options?: HybridSearchOptions
  ): Promise<ExtendedSearchResult[]> {
    // 1. ベースのハイブリッド検索を実行
    const baseResults = await this.hybridSearch(query, options);

    // 2. ファイルパスコンテキストがある場合、関連記憶を優先
    // Requirements: 7.3
    let filePathResults: Memory[] = [];
    if (context?.filePath) {
      filePathResults = await this.searchByFilePath(context.filePath, options?.limit ?? 10);
    }

    // 3. 各結果に対してLiteモード最適化スコアを計算
    const weights = this.getLiteModeWeights();
    const enhancedResults = baseResults.map((result) => {
      // 新しさスコアを計算 (Requirements: 7.1)
      const recencyScore = this.calculateRecencyScore(result.memory);

      // 手続き記憶タイプの重みを適用 (Requirements: 7.2)
      // 手続き記憶の場合は設定された重み値、それ以外は0
      const proceduralWeight =
        result.memory.memoryType === 'procedural' ? weights.procedural : 0;

      // ファイルパスマッチスコアを計算 (Requirements: 7.3)
      const filePathScore = context?.filePath
        ? this.calculateFilePathScore(result.memory, context.filePath, filePathResults)
        : 0;

      // 最終スコアを計算
      // finalScore = w_recency * recency + w_relevance * combined + proceduralWeight + w_filePath * filePathScore
      // ※ proceduralWeight は手続き記憶の場合 w_procedural、それ以外は 0
      const finalScore =
        weights.recency * recencyScore +
        weights.relevance * result.scores.combined +
        proceduralWeight +
        weights.filePath * filePathScore;

      return {
        ...result,
        recencyScore,
        filePathScore,
        finalScore,
      };
    });

    // 4. 最終スコアでソート (Requirements: 7.4 - 同スコア時の新しさ優先)
    enhancedResults.sort((a, b) => {
      // スコアの差が十分大きい場合
      const scoreDiff = b.finalScore - a.finalScore;
      if (Math.abs(scoreDiff) > 1e-6) {
        return scoreDiff;
      }

      // 同スコアの場合、新しさで比較 (Requirements: 7.4)
      const recencyDiff = (b.recencyScore ?? 0) - (a.recencyScore ?? 0);
      if (Math.abs(recencyDiff) > 1e-6) {
        return recencyDiff;
      }

      // それでも同じ場合、タイムスタンプで比較
      const timeA = a.memory.createdAt?.getTime() ?? 0;
      const timeB = b.memory.createdAt?.getTime() ?? 0;
      return timeB - timeA;
    });

    return enhancedResults;
  }

  /**
   * 新しさスコアを計算
   *
   * Requirements: 7.1
   * より最近の記憶に高いスコアを付与
   *
   * @param memory 記憶オブジェクト
   * @returns 新しさスコア (0.0 - 1.0)
   */
  private calculateRecencyScore(memory: Memory): number {
    if (!memory.createdAt) {
      return 0;
    }

    const now = Date.now();
    const createdTime = memory.createdAt.getTime();
    const ageInDays = (now - createdTime) / (1000 * 60 * 60 * 24);

    // 指数減衰関数を使用: score = exp(-age / decay_constant)
    // decay_constant = 30日 (30日で約37%まで減衰)
    const decayConstant = 30;
    const recencyScore = Math.exp(-ageInDays / decayConstant);

    return Math.max(0, Math.min(1, recencyScore));
  }

  /**
   * ファイルパスマッチスコアを計算
   *
   * Requirements: 7.3
   * 同じファイルパスに関連付けられた記憶を優先
   *
   * @param memory 記憶オブジェクト
   * @param targetFilePath 検索対象のファイルパス
   * @param filePathResults ファイルパス検索結果
   * @returns ファイルパスマッチスコア (0.0 - 1.0)
   */
  private calculateFilePathScore(
    memory: Memory,
    targetFilePath: string,
    filePathResults: Memory[]
  ): number {
    // メタデータにファイルパス情報があるかチェック
    const memoryFilePath = this.extractFilePath(memory);

    if (!memoryFilePath) {
      return 0;
    }

    // 完全一致
    if (memoryFilePath === targetFilePath) {
      return 1.0;
    }

    // 部分一致（同じディレクトリ内など）
    const targetParts = targetFilePath.split('/');
    const memoryParts = memoryFilePath.split('/');

    let matchingParts = 0;
    const minLength = Math.min(targetParts.length, memoryParts.length);

    for (let i = 0; i < minLength; i++) {
      if (targetParts[i] === memoryParts[i]) {
        matchingParts++;
      } else {
        break;
      }
    }

    // 部分一致スコア
    const partialScore = matchingParts / Math.max(targetParts.length, memoryParts.length);

    // ファイルパス検索結果に含まれている場合、追加ボーナス
    const inFilePathResults = filePathResults.some((m) => m.id === memory.id);
    const bonus = inFilePathResults ? 0.2 : 0;

    return Math.min(1.0, partialScore + bonus);
  }

  /**
   * 記憶からファイルパスを抽出
   *
   * @param memory 記憶オブジェクト
   * @returns ファイルパス（存在しない場合はundefined）
   */
  private extractFilePath(memory: Memory): string | undefined {
    // メタデータからファイルパスを抽出
    if (memory.metadata) {
      // lite_mode_metadata.filePath
      if (
        typeof memory.metadata === 'object' &&
        'lite_mode_metadata' in memory.metadata
      ) {
        const liteMetadata = (memory.metadata as any).lite_mode_metadata;
        if (liteMetadata && typeof liteMetadata === 'object' && 'filePath' in liteMetadata) {
          return liteMetadata.filePath as string;
        }
      }

      // 直接 filePath プロパティ
      if ('filePath' in memory.metadata) {
        return (memory.metadata as any).filePath as string;
      }

      // context.filePath
      if ('context' in memory.metadata) {
        const context = (memory.metadata as any).context;
        if (context && typeof context === 'object' && 'filePath' in context) {
          return context.filePath as string;
        }
      }
    }

    return undefined;
  }

  /**
   * ファイルパスで記憶を検索
   *
   * Requirements: 7.3
   *
   * @param filePath ファイルパス
   * @param limit 最大結果件数
   * @returns 検索結果
   */
  private async searchByFilePath(filePath: string, limit: number): Promise<Memory[]> {
    // ファイルパスをクエリとして検索
    // 実際の実装では、メタデータフィルタを使用してより効率的に検索可能
    try {
      const results = await this.hybridSearch(filePath, { limit });
      return results
        .filter((r) => {
          const memoryFilePath = this.extractFilePath(r.memory);
          // 厳密なマッチング（完全一致またはパスセグメント単位の比較）
          // Requirements: 7.3 - ファイルパスコンテキストの正確な解決
          if (!memoryFilePath) return false;

          return (
            memoryFilePath === filePath ||
            memoryFilePath.startsWith(filePath + '/') ||
            filePath.startsWith(memoryFilePath + '/')
          );
        })
        .map((r) => r.memory);
    } catch (error) {
      console.warn('Failed to search by file path:', error);
      return [];
    }
  }

  /**
   * Liteモード用のデフォルトパラメータを取得
   *
   * Requirements: 7.5
   *
   * @returns デフォルトの検索フィルタ
   */
  getLiteModeDefaults(): SearchFilters {
    return {
      limit: 10,
      // Liteモードでは新しい記憶を優先するため、デフォルトで時間範囲を設定しない
      // （全期間を対象とし、新しさスコアでランキング）
    };
  }
}
