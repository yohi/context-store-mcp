/**
 * Vector Store Adapter
 *
 * タスク5.1: ベクトルストレージアダプターの実装
 * - PostgreSQL + pgvector を使用したベクトル埋め込みの保存と検索
 * - OpenAI Embeddings API統合
 * - 高速近似最近傍探索 (HNSW インデックス)
 *
 * タスク5.2: 類似性検索とランキング機能
 * - 類似度計算による検索実装
 * - 閾値フィルタリング
 * - スコアリングアルゴリズム
 * - 検索結果のランキング
 * - メタデータフィルタの適用
 */

import type { Pool } from 'pg';
import OpenAI from 'openai';
import { randomUUID } from 'crypto';

/**
 * ベクトルID (UUID)
 */
export type VectorId = string;

/**
 * メタデータの型定義
 */
export interface Metadata {
  source?: string;
  timestamp?: Date;
  tags?: string[];
  memoryType?: 'episodic' | 'semantic' | 'procedural';
  [key: string]: unknown;
}

/**
 * ベクトル検索結果
 */
export interface VectorSearchResult {
  /** ベクトルID (UUID) */
  id: VectorId;
  /** 記憶コンテンツ */
  content: string;
  /** コサイン類似度 (0.0 - 1.0) */
  similarity: number;
  /** メタデータ */
  metadata: Metadata;
}

/**
 * バッチ保存用アイテム
 */
export interface VectorItem {
  content: string;
  metadata: Metadata;
}

/**
 * メタデータフィルタ条件（タスク5.2）
 */
export interface MetadataFilter {
  /** タグによるフィルタ（OR条件） */
  tags?: string[];
  /** 記憶タイプによるフィルタ */
  memoryType?: 'episodic' | 'semantic' | 'procedural';
  /** ソースによるフィルタ */
  source?: string;
  /** 作成日時の範囲フィルタ */
  createdAfter?: Date;
  createdBefore?: Date;
  /** カスタムメタデータフィルタ */
  customFilters?: Record<string, unknown>;
}

/**
 * スコアリング戦略（タスク5.2）
 */
export type ScoringStrategy =
  | 'similarity_only' // コサイン類似度のみ
  | 'recency_weighted' // 類似度 + 新しさの加重平均
  | 'importance_weighted' // 類似度 + 重要度の加重平均
  | 'hybrid'; // 類似度 + 新しさ + 重要度の複合スコア

/**
 * 検索オプション（タスク5.2）
 */
export interface SearchOptions {
  /** 最大結果件数 (デフォルト: 10, 最大: 100) */
  limit?: number;
  /** オフセット (ページネーション用) */
  offset?: number;
  /** 最小類似度閾値 (デフォルト: 0.7) */
  minSimilarity?: number;
  /** メタデータフィルタ */
  filter?: MetadataFilter;
  /** スコアリング戦略 (デフォルト: similarity_only) */
  scoringStrategy?: ScoringStrategy;
  /** 除外する記憶のIDリスト */
  excludeIds?: VectorId[];
  /** 多様性を考慮するかどうか (MMRアルゴリズム) */
  diversityEnabled?: boolean;
}

/**
 * 拡張されたベクトル検索結果（タスク5.2）
 */
export interface EnhancedSearchResult extends VectorSearchResult {
  /** 最終スコア（スコアリング戦略適用後） */
  finalScore: number;
  /** スコアの内訳 */
  scoreBreakdown?: {
    similarityScore: number;
    recencyScore?: number;
    importanceScore?: number;
  };
  /** マッチした理由の説明 */
  explanation?: string;
}

/**
 * スコアリング重み設定（タスク5.2）
 */
export interface ScoringWeights {
  /** similarity_only: 類似度のみ */
  similarityOnly: { similarity: number };
  /** recency_weighted: 類似度 + 新しさ */
  recencyWeighted: { similarity: number; recency: number };
  /** importance_weighted: 類似度 + 重要度 */
  importanceWeighted: { similarity: number; importance: number };
  /** hybrid: 類似度 + 新しさ + 重要度 */
  hybrid: { similarity: number; recency: number; importance: number };
}

/**
 * Vector Store Adapter Configuration
 */
export interface VectorStoreConfig {
  /** PostgreSQL接続プール */
  pool: Pool;
  /** OpenAI API Key */
  openaiApiKey: string;
  /** 埋め込みモデル (デフォルト: text-embedding-3-small) */
  embeddingModel?: string;
  /** ベクトル次元数 (デフォルト: 1536) */
  dimensions?: number;
  /** 類似度閾値 (デフォルト: 0.7) */
  similarityThreshold?: number;
  /** スコアリング重み (タスク5.2, カスタマイズ可能) */
  scoringWeights?: Partial<ScoringWeights>;
}

/**
 * Vector Store Adapter Interface
 *
 * design.md の VectorStoreAdapter インターフェースに準拠
 */
export interface IVectorStoreAdapter {
  /**
   * コンテンツとメタデータを埋め込みベクトルと共に保存
   *
   * @param content - 記憶コンテンツ
   * @param metadata - メタデータ
   * @returns ベクトルID (UUID)
   */
  storeWithEmbedding(content: string, metadata: Metadata): Promise<VectorId>;

  /**
   * 類似性検索を実行
   *
   * @param query - 検索クエリ
   * @param limit - 結果の最大件数 (デフォルト: 10)
   * @returns 検索結果配列 (類似度降順)
   */
  searchSimilar(query: string, limit?: number): Promise<VectorSearchResult[]>;

  /**
   * 拡張された類似性検索を実行（タスク5.2）
   *
   * メタデータフィルタ、スコアリング戦略、ランキング機能を提供
   *
   * @param query - 検索クエリ
   * @param options - 検索オプション
   * @returns 拡張された検索結果配列
   */
  searchSimilarAdvanced(query: string, options?: SearchOptions): Promise<EnhancedSearchResult[]>;

  /**
   * ベクトルを削除
   *
   * @param id - ベクトルID
   * @returns 削除成功時 true、対象が存在しない場合 false
   */
  deleteVector(id: VectorId): Promise<boolean>;

  /**
   * バッチ保存
   *
   * @param items - 保存するアイテム配列
   * @returns 保存されたベクトルIDの配列
   */
  bulkStore(items: VectorItem[]): Promise<VectorId[]>;

  /**
   * ベクトルインデックスを再構築
   *
   * HNSWインデックスの最適化を実行
   */
  reindexVectors(): Promise<void>;
}

/**
 * Vector Store Adapter Implementation
 */
export class VectorStoreAdapter implements IVectorStoreAdapter {
  // タスク5.2: スコアリング重みのデフォルト値（カスタマイズ可能）
  private static readonly DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
    similarityOnly: { similarity: 1.0 },
    recencyWeighted: { similarity: 0.7, recency: 0.3 },
    importanceWeighted: { similarity: 0.7, importance: 0.3 },
    hybrid: { similarity: 0.6, recency: 0.2, importance: 0.2 },
  };

  // タスク5.2: MMRアルゴリズムのλパラメータ（関連性と多様性のバランス）
  private static readonly MMR_LAMBDA = 0.7;

  // タスク5.2: 新しさスコアの減衰パラメータ（日数）
  private static readonly RECENCY_DECAY_DAYS = 30;

  private pool: Pool;
  private openaiClient: OpenAI;
  private embeddingModel: string;
  private dimensions: number;
  private similarityThreshold: number;
  private scoringWeights: ScoringWeights;

  constructor(config: VectorStoreConfig) {
    this.pool = config.pool;
    this.openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
    this.embeddingModel = config.embeddingModel || 'text-embedding-3-small';
    this.dimensions = config.dimensions || 1536;
    this.similarityThreshold = config.similarityThreshold || 0.7;
    this.scoringWeights = {
      ...VectorStoreAdapter.DEFAULT_SCORING_WEIGHTS,
      ...config.scoringWeights,
    };
  }

  /**
   * OpenAI Embeddings APIを使用してベクトルを生成
   * レート制限エラー(429)に対してエクスポネンシャルバックオフで自動リトライを実行
   *
   * @param text - 埋め込み対象テキスト
   * @returns ベクトル配列 (1536次元)
   * @throws エラー時は適切な例外をスロー
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty');
    }

    const maxRetries = 5;
    const baseDelay = 1000; // 1秒
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // OpenAI Embeddings API呼び出し
        const response = await this.openaiClient.embeddings.create({
          model: this.embeddingModel,
          input: text,
          encoding_format: 'float',
        });

        if (!response.data || response.data.length === 0) {
          throw new Error('No embedding data returned from OpenAI API');
        }

        const firstEmbedding = response.data[0];
        if (!firstEmbedding) {
          throw new Error('Invalid embedding data structure from OpenAI API');
        }

        const embedding = firstEmbedding.embedding;

        // 次元数チェック
        if (embedding.length !== this.dimensions) {
          throw new Error(
            `Unexpected embedding dimensions: expected ${this.dimensions}, got ${embedding.length}`
          );
        }

        return embedding;
      } catch (error) {
        // リトライ可能なエラーかどうかを判定
        // OpenAI SDK v6.5.0のデフォルト動作に準拠：
        // - RateLimitError (429)
        // - InternalServerError (5xx)
        // - APIConnectionError (ネットワークエラー)
        const isRetryableError =
          error instanceof OpenAI.RateLimitError ||
          error instanceof OpenAI.APIConnectionError ||
          (error instanceof OpenAI.APIError &&
            (error.status === 429 || (error.status !== undefined && error.status >= 500)));

        if (!isRetryableError) {
          // リトライ不可能なエラーは即座に再スロー
          if (error instanceof OpenAI.APIError) {
            throw new Error(
              `OpenAI API error: ${error.message} (status: ${error.status}, code: ${error.code})`
            );
          }
          throw error;
        }

        lastError = error as Error;

        // 最後のリトライまで達した場合は抜ける
        if (attempt === maxRetries - 1) {
          break;
        }

        // エクスポネンシャルバックオフ + ジッター計算
        const exponentialDelay = baseDelay * Math.pow(2, attempt);
        const jitter = Math.random() * 200 - 100; // -100ms ~ +100ms
        const delayMs = Math.max(0, exponentialDelay + jitter);

        // リトライ前に待機
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // 全リトライ失敗時
    throw new Error(
      `OpenAI API rate limit exceeded after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * ベクトルを正規化 (ノルムを1にする)
   *
   * @param vector - 元のベクトル
   * @returns 正規化されたベクトル
   */
  private normalizeVector(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (norm === 0) {
      throw new Error('Cannot normalize zero vector');
    }
    return vector.map(val => val / norm);
  }

  async storeWithEmbedding(content: string, metadata: Metadata): Promise<VectorId> {
    // ベクトル生成
    const embedding = await this.generateEmbedding(content);
    const normalizedEmbedding = this.normalizeVector(embedding);

    // UUIDを生成
    const id = randomUUID();

    // PostgreSQLに保存
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // memories テーブルに保存
      await client.query(
        `INSERT INTO memories (id, content, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [id, content, JSON.stringify(metadata)]
      );

      // memory_vectors テーブルにベクトルを保存
      await client.query(
        `INSERT INTO memory_vectors (memory_id, embedding)
         VALUES ($1, $2::vector)`,
        [id, '[' + normalizedEmbedding.join(',') + ']']
      );

      await client.query('COMMIT');
      return id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Failed to store vector: ${error}`);
    } finally {
      client.release();
    }
  }

  async searchSimilar(query: string, limit: number = 10): Promise<VectorSearchResult[]> {
    // クエリのベクトルを生成
    const queryEmbedding = await this.generateEmbedding(query);
    const normalizedQuery = this.normalizeVector(queryEmbedding);

    // pgvectorのコサイン類似度検索を実行
    // <=> はコサイン距離演算子、1 - distance でコサイン類似度に変換
    const result = await this.pool.query(
      `SELECT
        m.id,
        m.content,
        m.metadata,
        1 - (mv.embedding <=> $1::vector) AS similarity
       FROM memories m
       JOIN memory_vectors mv ON m.id = mv.memory_id
       WHERE m.is_deleted = false
         AND 1 - (mv.embedding <=> $1::vector) >= $2
       ORDER BY similarity DESC
       LIMIT $3`,
      ['[' + normalizedQuery.join(',') + ']', this.similarityThreshold, limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      content: row.content,
      similarity: parseFloat(row.similarity),
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    }));
  }

  async deleteVector(id: VectorId): Promise<boolean> {
    const result = await this.pool.query(
      'UPDATE memories SET is_deleted = true WHERE id = $1 AND is_deleted = false',
      [id]
    );

    return result.rowCount !== null && result.rowCount > 0;
  }

  async bulkStore(items: VectorItem[]): Promise<VectorId[]> {
    // Step 1: Generate all embeddings in parallel BEFORE opening transaction
    // This avoids holding DB connection while waiting for OpenAI API
    const embeddingPromises = items.map(item => this.generateEmbedding(item.content));
    const embeddings = await Promise.all(embeddingPromises);
    const normalizedEmbeddings = embeddings.map(emb => this.normalizeVector(emb));

    // Step 2: Generate UUIDs upfront
    const ids: VectorId[] = items.map(() => randomUUID());

    // Step 3: Build bulk INSERT statements with parameterized queries
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Bulk insert into memories table
      // VALUES ($1, $2, $3, NOW(), NOW()), ($4, $5, $6, NOW(), NOW()), ...
      const memoriesValues: string[] = [];
      const memoriesParams: unknown[] = [];
      let paramIndex = 1;

      for (let i = 0; i < items.length; i++) {
        memoriesValues.push(
          `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, NOW(), NOW())`
        );
        memoriesParams.push(ids[i], items[i].content, JSON.stringify(items[i].metadata));
        paramIndex += 3;
      }

      await client.query(
        `INSERT INTO memories (id, content, metadata, created_at, updated_at)
         VALUES ${memoriesValues.join(', ')}`,
        memoriesParams
      );

      // Bulk insert into memory_vectors table
      // VALUES ($1, $2::vector), ($3, $4::vector), ...
      const vectorsValues: string[] = [];
      const vectorsParams: unknown[] = [];
      paramIndex = 1;

      for (let i = 0; i < items.length; i++) {
        vectorsValues.push(`($${paramIndex}, $${paramIndex + 1}::vector)`);
        vectorsParams.push(ids[i], '[' + normalizedEmbeddings[i].join(',') + ']');
        paramIndex += 2;
      }

      await client.query(
        `INSERT INTO memory_vectors (memory_id, embedding)
         VALUES ${vectorsValues.join(', ')}`,
        vectorsParams
      );

      await client.query('COMMIT');
      return ids;
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Failed to bulk store vectors: ${error}`);
    } finally {
      client.release();
    }
  }

  /**
   * HNSWインデックスの再構築
   * REINDEX CONCURRENTLY を使用し、再構築中も検索可能な状態を維持
   *
   * @throws REINDEX失敗時にエラーをスロー。失敗時は無効なインデックス(_ccnewサフィックス)が残る可能性があるため、
   *         手動でのクリーンアップが必要な場合がある
   */
  async reindexVectors(): Promise<void> {
    const indexName = 'idx_memory_vectors_embedding';
    const client = await this.pool.connect();

    try {
      console.log(`Starting REINDEX CONCURRENTLY for ${indexName}...`);

      // REINDEX CONCURRENTLY実行
      await client.query(`REINDEX INDEX CONCURRENTLY ${indexName}`);

      console.log(`Successfully completed REINDEX CONCURRENTLY for ${indexName}`);
    } catch (error) {
      // REINDEX CONCURRENTLY失敗時のエラーログ
      console.error(`REINDEX CONCURRENTLY failed for ${indexName}:`, error);
      console.error(
        `Warning: An invalid index with _ccnew suffix may remain. ` +
          `Check with: SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE indexrelid::regclass::text LIKE '${indexName}%';`
      );

      // 無効なインデックスの存在をチェック
      try {
        const invalidIndexResult = await client.query(
          `SELECT indexrelid::regclass AS index_name, indisvalid
           FROM pg_index
           WHERE indexrelid::regclass::text LIKE $1 AND NOT indisvalid`,
          [`${indexName}%`]
        );

        if (invalidIndexResult.rows.length > 0) {
          const invalidIndexes = invalidIndexResult.rows
            .map((row) => row.index_name)
            .join(', ');
          console.error(
            `Detected invalid indexes that need manual cleanup: ${invalidIndexes}`
          );
          console.error(
            `To cleanup, run: DROP INDEX CONCURRENTLY IF EXISTS <invalid_index_name>;`
          );
        }
      } catch (checkError) {
        // インデックスチェック自体が失敗した場合も記録
        console.error('Failed to check for invalid indexes:', checkError);
      }

      throw new Error(
        `Failed to reindex ${indexName}: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      client.release();
    }
  }

  /**
   * 拡張された類似性検索を実行（タスク5.2）
   *
   * メタデータフィルタ、スコアリング戦略、ランキング機能を提供
   */
  async searchSimilarAdvanced(query: string, options: SearchOptions = {}): Promise<EnhancedSearchResult[]> {
    // パラメータの検証とデフォルト値の設定
    const {
      limit = 10,
      offset = 0,
      minSimilarity = this.similarityThreshold,
      filter,
      scoringStrategy = 'similarity_only',
      excludeIds = [],
      diversityEnabled = false,
    } = options;

    // パラメータの範囲チェック
    if (limit < 1 || limit > 100) {
      throw new Error('limit must be between 1 and 100');
    }
    if (offset < 0) {
      throw new Error('offset must be non-negative');
    }
    if (minSimilarity < 0 || minSimilarity > 1) {
      throw new Error('minSimilarity must be between 0 and 1');
    }
    if (!query || query.trim().length === 0) {
      throw new Error('query cannot be empty');
    }

    // クエリのベクトルを生成
    const queryEmbedding = await this.generateEmbedding(query);
    const normalizedQuery = this.normalizeVector(queryEmbedding);

    // メタデータフィルタ条件を構築
    const whereConditions: string[] = ['m.is_deleted = false'];
    const queryParams: unknown[] = [JSON.stringify(normalizedQuery), minSimilarity];
    let paramIndex = 3;

    // 除外IDフィルタ
    if (excludeIds.length > 0) {
      whereConditions.push(`m.id != ALL($${paramIndex})`);
      queryParams.push(excludeIds);
      paramIndex++;
    }

    // メタデータフィルタの適用
    if (filter) {
      if (filter.memoryType) {
        whereConditions.push(`m.metadata->>'memoryType' = $${paramIndex}`);
        queryParams.push(filter.memoryType);
        paramIndex++;
      }

      if (filter.source) {
        whereConditions.push(`m.metadata->>'source' = $${paramIndex}`);
        queryParams.push(filter.source);
        paramIndex++;
      }

      if (filter.tags && filter.tags.length > 0) {
        // タグの OR 条件（いずれかのタグを含む）
        whereConditions.push(`m.metadata->'tags' ?| $${paramIndex}`);
        queryParams.push(filter.tags);
        paramIndex++;
      }

      if (filter.createdAfter) {
        whereConditions.push(`m.created_at >= $${paramIndex}`);
        queryParams.push(filter.createdAfter);
        paramIndex++;
      }

      if (filter.createdBefore) {
        whereConditions.push(`m.created_at <= $${paramIndex}`);
        queryParams.push(filter.createdBefore);
        paramIndex++;
      }
    }

    const whereClause = whereConditions.join(' AND ');

    // コサイン類似度検索を実行
    const result = await this.pool.query(
      `SELECT
        m.id,
        m.content,
        m.metadata,
        m.created_at,
        1 - (mv.embedding <=> $1::vector) AS similarity
       FROM memories m
       JOIN memory_vectors mv ON m.id = mv.memory_id
       WHERE ${whereClause}
         AND 1 - (mv.embedding <=> $1::vector) >= $2
       ORDER BY similarity DESC
       LIMIT ${limit + offset}`,
      queryParams
    );

    // 基本検索結果を取得
    const baseResults: VectorSearchResult[] = result.rows.map(row => ({
      id: row.id,
      content: row.content,
      similarity: parseFloat(row.similarity),
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    }));

    // スコアリング戦略を適用
    const enhancedResults: EnhancedSearchResult[] = baseResults.map(result => {
      const scoreBreakdown = this.calculateScoreBreakdown(result, scoringStrategy, result.metadata);
      const finalScore = this.calculateFinalScore(scoreBreakdown, scoringStrategy);

      return {
        ...result,
        finalScore,
        scoreBreakdown,
        explanation: this.generateExplanation(result, scoreBreakdown),
      };
    });

    // 最終スコアでソート
    enhancedResults.sort((a, b) => {
      if (Math.abs(a.finalScore - b.finalScore) < 0.0001) {
        // 同じスコアの場合は新しい記憶を優先
        const timeA = new Date(a.metadata.timestamp || 0).getTime();
        const timeB = new Date(b.metadata.timestamp || 0).getTime();
        return timeB - timeA;
      }
      return b.finalScore - a.finalScore;
    });

    // 多様性を考慮する場合（MMRアルゴリズム）
    let finalResults = enhancedResults;
    if (diversityEnabled && enhancedResults.length > 1) {
      finalResults = this.applyMaximalMarginalRelevance(enhancedResults, limit);
    }

    // オフセットとリミットを適用
    return finalResults.slice(offset, offset + limit);
  }

  /**
   * スコアの内訳を計算
   */
  private calculateScoreBreakdown(
    result: VectorSearchResult,
    strategy: ScoringStrategy,
    metadata: Metadata
  ): {
    similarityScore: number;
    recencyScore?: number;
    importanceScore?: number;
  } {
    const breakdown: {
      similarityScore: number;
      recencyScore?: number;
      importanceScore?: number;
    } = {
      similarityScore: result.similarity,
    };

    if (strategy !== 'similarity_only') {
      // 新しさスコアを計算（0-1の範囲）
      if (strategy === 'recency_weighted' || strategy === 'hybrid') {
        const timestamp = metadata.timestamp ? new Date(metadata.timestamp).getTime() : 0;
        const now = Date.now();
        const daysSinceCreation = (now - timestamp) / (1000 * 60 * 60 * 24);
        // 指定日数以内なら高スコア、それ以降は指数関数的に減衰
        breakdown.recencyScore = Math.exp(
          -daysSinceCreation / VectorStoreAdapter.RECENCY_DECAY_DAYS
        );
      }

      // 重要度スコアを計算（0-1の範囲）
      if (strategy === 'importance_weighted' || strategy === 'hybrid') {
        // metadata に importance フィールドがあればそれを使用、なければ0.5
        breakdown.importanceScore =
          typeof metadata['importance'] === 'number' ? (metadata['importance'] as number) : 0.5;
      }
    }

    return breakdown;
  }

  /**
   * 最終スコアを計算
   */
  private calculateFinalScore(
    breakdown: {
      similarityScore: number;
      recencyScore?: number;
      importanceScore?: number;
    },
    strategy: ScoringStrategy
  ): number {
    const weights = this.scoringWeights;

    switch (strategy) {
      case 'similarity_only':
        return breakdown.similarityScore * weights.similarityOnly.similarity;

      case 'recency_weighted':
        return (
          breakdown.similarityScore * weights.recencyWeighted.similarity +
          (breakdown.recencyScore || 0) * weights.recencyWeighted.recency
        );

      case 'importance_weighted':
        return (
          breakdown.similarityScore * weights.importanceWeighted.similarity +
          (breakdown.importanceScore || 0) * weights.importanceWeighted.importance
        );

      case 'hybrid':
        return (
          breakdown.similarityScore * weights.hybrid.similarity +
          (breakdown.recencyScore || 0) * weights.hybrid.recency +
          (breakdown.importanceScore || 0) * weights.hybrid.importance
        );

      default:
        return breakdown.similarityScore;
    }
  }

  /**
   * マッチした理由の説明を生成
   */
  private generateExplanation(
    result: VectorSearchResult,
    scoreBreakdown: {
      similarityScore: number;
      recencyScore?: number;
      importanceScore?: number;
    }
  ): string {
    const parts: string[] = [];

    parts.push(`類似度: ${(scoreBreakdown.similarityScore * 100).toFixed(1)}%`);

    if (scoreBreakdown.recencyScore !== undefined) {
      parts.push(`新しさ: ${(scoreBreakdown.recencyScore * 100).toFixed(1)}%`);
    }

    if (scoreBreakdown.importanceScore !== undefined) {
      parts.push(`重要度: ${(scoreBreakdown.importanceScore * 100).toFixed(1)}%`);
    }

    if (result.metadata.tags && Array.isArray(result.metadata.tags)) {
      parts.push(`タグ: ${result.metadata.tags.join(', ')}`);
    }

    return parts.join(' | ');
  }

  /**
   * MMR (Maximal Marginal Relevance) アルゴリズムを適用
   *
   * 結果の多様性を確保するために、類似した結果を除外しつつ
   * 関連性の高い結果を優先的に選択する
   */
  private applyMaximalMarginalRelevance(
    results: EnhancedSearchResult[],
    limit: number
  ): EnhancedSearchResult[] {
    if (results.length <= limit) {
      return results;
    }

    const selected: EnhancedSearchResult[] = [];
    const remaining = [...results];

    // 最初は最も関連性の高い結果を選択
    selected.push(remaining.shift()!);

    // lambda パラメータ（関連性と多様性のバランス）
    const lambda = VectorStoreAdapter.MMR_LAMBDA;

    while (selected.length < limit && remaining.length > 0) {
      let maxScore = -Infinity;
      let maxIndex = -1;

      // 残りの各候補について MMR スコアを計算
      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i];
        if (!candidate) continue;

        // 既に選択された結果との最大類似度を計算
        let maxSimilarityToSelected = 0;
        for (const selectedResult of selected) {
          // ここでは簡易的にスコアの差を類似度の代理として使用
          const similarity = 1 - Math.abs(candidate.finalScore - selectedResult.finalScore);
          maxSimilarityToSelected = Math.max(maxSimilarityToSelected, similarity);
        }

        // MMR スコア = λ * 関連性 - (1 - λ) * 類似度
        const mmrScore = lambda * candidate.finalScore - (1 - lambda) * maxSimilarityToSelected;

        if (mmrScore > maxScore) {
          maxScore = mmrScore;
          maxIndex = i;
        }
      }

      // 最もMMRスコアの高い候補を選択
      if (maxIndex >= 0) {
        const selectedCandidate = remaining.splice(maxIndex, 1)[0];
        if (selectedCandidate) {
          selected.push(selectedCandidate);
        }
      } else {
        break;
      }
    }

    return selected;
  }
}
