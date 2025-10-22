/**
 * Query Processor Types
 *
 * Task 7.1: クエリプロセッサーの基本機能
 * design.md の Query Processor 仕様に基づく型定義
 */

import type { MemoryType, Memory } from '../memory/types';

/**
 * 検索クエリ
 */
export interface SearchQuery {
  /** クエリ文字列 */
  query: string;
  /** フィルタ条件 */
  filters?: SearchFilters;
}

/**
 * 検索フィルタ
 */
export interface SearchFilters {
  /** 時間範囲フィルタ */
  timeRange?: TimeFilter;
  /** 記憶タイプフィルタ */
  memoryTypes?: MemoryType[];
  /** タグフィルタ */
  tags?: string[];
  /** 最大結果件数 (デフォルト: 10) */
  limit?: number;
  /** オフセット (ページネーション用) */
  offset?: number;
}

/**
 * 時間フィルタ
 */
export type TimeFilter =
  | {
      /** 相対時間 */
      type: 'relative';
      /** 相対時間の値 */
      value: RelativeTimeValue;
    }
  | {
      /** 絶対時間 */
      type: 'absolute';
      /** 開始日時 */
      start: Date;
      /** 終了日時 */
      end: Date;
    };

/**
 * 相対時間の値
 */
export type RelativeTimeValue =
  | 'today'
  | 'yesterday'
  | 'last_week'
  | 'last_month'
  | 'last_7_days'
  | 'last_30_days'
  | 'last_90_days';

/**
 * パース済みクエリ
 */
export interface ParsedQuery {
  /** 元のクエリ文字列 */
  rawQuery: string;
  /** クエリの意図 */
  intent: QueryIntent;
  /** 抽出されたキーワード */
  keywords: string[];
  /** 時間フィルタ */
  timeFilter?: TimeFilter;
  /** タグ */
  tags?: string[];
  /** 記憶タイプ */
  memoryTypes?: MemoryType[];
  /** その他のメタデータフィルタ */
  metadata?: Record<string, unknown>;
}

/**
 * クエリの意図
 */
export type QueryIntent =
  | 'search' // 一般的な検索
  | 'find_related' // 関連記憶の検索
  | 'find_sequence' // 手順・シーケンスの検索
  | 'find_contradiction' // 矛盾の検索
  | 'timeline'; // 時系列検索

/**
 * 時間範囲
 */
export interface TimeRange {
  /** 開始日時 */
  start: Date;
  /** 終了日時 */
  end: Date;
}

/**
 * メタデータフィルタ (design.md の VectorStoreAdapter に準拠)
 */
export interface MetadataFilter {
  /** タグフィルタ (OR条件) */
  tags?: string[];
  /** 記憶タイプフィルタ */
  memoryTypes?: MemoryType[];
  /** ソースフィルタ */
  source?: string;
  /** 作成日時フィルタ (この日時以降) */
  createdAfter?: Date;
  /** 作成日時フィルタ (この日時以前) */
  createdBefore?: Date;
}

/**
 * クエリプラン
 */
export interface QueryPlan {
  /** 検索戦略 */
  strategy: SearchStrategy;
  /** 実行ステップ */
  steps: QueryStep[];
  /** フィルタ条件 */
  filters: MetadataFilter;
  /** 予想実行時間 (ミリ秒) */
  estimatedTime?: number;
}

/**
 * 検索戦略
 */
export type SearchStrategy =
  | 'vector_only' // ベクトル検索のみ
  | 'graph_only' // グラフ検索のみ
  | 'hybrid' // ハイブリッド検索 (ベクトル + グラフ)
  | 'graph_priority' // グラフ優先 (手続き記憶など)
  | 'metadata_filtering'; // メタデータフィルタリング優先

/**
 * クエリステップ
 */
export interface QueryStep {
  /** ステップタイプ */
  type: QueryStepType;
  /** パラメータ */
  params?: Record<string, unknown>;
  /** フィルタ条件 */
  filters?: MetadataFilter;
  /** 予想実行時間 (ミリ秒) */
  estimatedTime?: number;
}

/**
 * クエリステップタイプ
 */
export type QueryStepType =
  | 'vector_search' // ベクトル検索
  | 'graph_search' // グラフ検索
  | 'metadata_filter' // メタデータフィルタ
  | 'merge_results' // 結果のマージ
  | 'rank_results' // 結果のランキング
  | 'cache_lookup' // キャッシュ検索
  | 'cache_store'; // キャッシュ保存

/**
 * 最適化済みクエリプラン
 */
export interface OptimizedQueryPlan extends QueryPlan {
  /** 最適化の適用内容 */
  optimizations: string[];
  /** 最適化前の予想実行時間 */
  originalEstimatedTime: number;
  /** 最適化による改善率 (0.0 - 1.0) */
  improvementRate: number;
}

/**
 * クエリ処理結果
 */
export interface QueryResult<T = Memory> {
  /** 検索結果 */
  results: T[];
  /** 合計件数 */
  totalCount: number;
  /** 実行時間 (ミリ秒) */
  executionTime: number;
  /** 使用された検索戦略 */
  strategy: SearchStrategy;
  /** キャッシュヒットフラグ */
  cacheHit: boolean;
}

/**
 * クエリエラー
 */
export type QueryError =
  | { type: 'EMPTY_QUERY'; message: string }
  | { type: 'INVALID_TIME_RANGE'; message: string }
  | { type: 'UNSUPPORTED_FILTER'; message: string }
  | { type: 'SEARCH_FAILED'; message: string }
  | { type: 'TIMEOUT'; message: string };

/**
 * Task 7.2: ハイブリッド検索とキャッシングの型定義
 */

/**
 * ハイブリッド検索のオプション (design.md の HybridSearchParams に準拠)
 */
export interface HybridSearchOptions {
  /** セマンティック検索クエリ */
  semanticQuery?: string;
  /** グラフパターンクエリ */
  graphPattern?: string;
  /** フィルタ条件 */
  filters?: SearchFilters;
  /** 重み設定 */
  weights?: {
    semantic: number; // デフォルト: 0.7
    structural: number; // デフォルト: 0.3
  };
  /** スコアリング設定 */
  scoringConfig?: {
    alpha?: number; // グラフスコア減衰率（デフォルト: 1.0）
    epsilon?: number; // タイブレーク許容誤差（デフォルト: 1e-6）
  };
  /** 最大結果件数 */
  limit?: number;
}

/**
 * ハイブリッド検索結果 (design.md の HybridSearchResult に準拠)
 */
export interface HybridSearchResult {
  /** 記憶 */
  memory: Memory;
  /** スコア情報 */
  scores: {
    semantic: number; // セマンティック類似度スコア (0.0 - 1.0)
    structural: number; // 構造的関連性スコア (0.0 - 1.0)
    combined: number; // 統合スコア = w_semantic * semantic + w_structural * structural (0.0 - 1.0)
  };
  /** メタデータ */
  metadata: {
    pathLength?: number; // グラフ検索時のホップ数
    cosineSimilarity?: number; // ベクトル検索時の生スコア
  };
}

/**
 * キャッシュキーの生成に使用するクエリ情報
 */
export interface CacheableQuery {
  query: string;
  filters?: SearchFilters;
  strategy?: SearchStrategy;
}

/**
 * キャッシュ統計情報
 */
export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number; // 0.0 - 1.0
  size: number;
  maxSize: number;
}

/**
 * Task 7.3: 検索品質評価システムの型定義
 */

/**
 * 検索評価データセット (design.md の SearchEvaluationDataset に準拠)
 */
export interface SearchEvaluationDataset {
  /** クエリリスト */
  queries: Array<{
    /** クエリ文字列 */
    query: string;
    /** 正解となる関連記憶のID */
    relevantMemoryIds: string[];
    /** アノテーター一覧 */
    annotators: string[];
    /** アノテーター間一致度 (Fleiss' Kappa) */
    interAnnotatorAgreement?: number;
  }>;
  /** メタデータ */
  metadata: {
    /** 作成日時 */
    createdAt: Date;
    /** バージョン */
    version: string;
    /** 総クエリ数 */
    totalQueries: number;
    /** 最低クエリ数 (要件: 100) */
    minimumQueries: number;
  };
}

/**
 * 検索品質メトリクス (design.md の SearchQualityMetrics に準拠)
 */
export interface SearchQualityMetrics {
  /** Precision@10 (目標: ≥ 0.8) */
  precisionAt10: number;
  /** Recall@50 (目標: ≥ 0.7) */
  recallAt50: number;
  /** F1スコア (目標: ≥ 0.75) */
  f1Score: number;
  /** Mean Average Precision */
  meanAveragePrecision: number;
  /** 評価実施日時 */
  evaluatedAt: Date;
  /** テストセットサイズ */
  testSetSize: number;
  /** 閾値合格判定 */
  passedThresholds: {
    /** Precision@10 ≥ 0.8 */
    precisionAt10Passed: boolean;
    /** Recall@50 ≥ 0.7 */
    recallAt50Passed: boolean;
    /** F1スコア ≥ 0.75 */
    f1ScorePassed: boolean;
  };
}

/**
 * アノテーションタスク
 */
export interface AnnotationTask {
  /** クエリID */
  queryId: string;
  /** クエリ文字列 */
  query: string;
  /** 候補記憶一覧 */
  candidateMemories: Memory[];
  /** アノテーター別判定 */
  annotatorJudgments: Array<{
    /** アノテーター名 */
    annotator: string;
    /** 判定結果 */
    judgments: Array<{
      /** 記憶ID */
      memoryId: string;
      /** 関連性レベル (0: 無関係, 1: やや関連, 2: 関連, 3: 高関連) */
      relevanceLevel: 0 | 1 | 2 | 3;
    }>;
  }>;
}

/**
 * 関連性フィードバック (design.md の RelevanceFeedback に準拠)
 */
export interface RelevanceFeedback {
  /** ユーザーID */
  userId: string;
  /** 関連性判定 */
  relevanceJudgments: Array<{
    /** 記憶ID */
    memoryId: string;
    /** 関連性フラグ */
    isRelevant: boolean;
    /** 関連性レベル (0: 無関係, 1: やや関連, 2: 関連, 3: 高関連) */
    relevanceLevel?: 0 | 1 | 2 | 3;
  }>;
  /** フィードバック時刻 */
  timestamp: Date;
}

/**
 * 検索バリアント (A/Bテスト用)
 */
export interface SearchVariant {
  /** バリアント名 */
  name: string;
  /** 埋め込みモデル */
  embeddingModel?: string;
  /** 類似度閾値 */
  similarityThreshold?: number;
  /** ハイブリッド検索の重み */
  hybridSearchWeights?: {
    semantic: number;
    structural: number;
  };
}

/**
 * A/Bテスト結果
 */
export interface ABTestResult {
  /** 勝利バリアント */
  winner: SearchVariant;
  /** コントロールバリアントのメトリクス */
  controlMetrics: SearchQualityMetrics;
  /** 実験バリアントのメトリクス */
  experimentMetrics: SearchQualityMetrics;
  /** p値 (統計的有意性) */
  pValue: number;
  /** 有意水準 (デフォルト: 0.05) */
  significanceLevel?: number;
}

/**
 * 検索ログエントリ
 */
export interface SearchLogEntry {
  /** ログID */
  id: string;
  /** 記憶ID */
  memoryId: string;
  /** クエリ */
  query: string;
  /** 関連性スコア */
  relevanceScore?: number;
  /** 検索日時 */
  searchedAt: Date;
}

/**
 * ユーザーフィードバックログ
 */
export interface UserFeedbackLog {
  /** ログID */
  id: string;
  /** ユーザーID */
  userId: string;
  /** クエリ */
  query: string;
  /** 判定結果 (JSON) */
  judgments: RelevanceFeedback['relevanceJudgments'];
  /** フィードバック日時 */
  feedbackAt: Date;
}
