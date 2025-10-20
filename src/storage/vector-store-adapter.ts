/**
 * Vector Store Adapter
 *
 * タスク5.1: ベクトルストレージアダプターの実装
 * - PostgreSQL + pgvector を使用したベクトル埋め込みの保存と検索
 * - OpenAI Embeddings API統合
 * - 高速近似最近傍探索 (HNSW インデックス)
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
  private pool: Pool;
  private openaiClient: OpenAI;
  private embeddingModel: string;
  private dimensions: number;
  private similarityThreshold: number;

  constructor(config: VectorStoreConfig) {
    this.pool = config.pool;
    this.openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
    this.embeddingModel = config.embeddingModel || 'text-embedding-3-small';
    this.dimensions = config.dimensions || 1536;
    this.similarityThreshold = config.similarityThreshold || 0.7;
  }

  /**
   * OpenAI Embeddings APIを使用してベクトルを生成
   *
   * @param text - 埋め込み対象テキスト
   * @returns ベクトル配列 (1536次元)
   * @throws エラー時は適切な例外をスロー
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty');
    }

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
      if (error instanceof OpenAI.APIError) {
        // APIエラーの詳細をログに記録
        throw new Error(
          `OpenAI API error: ${error.message} (status: ${error.status}, code: ${error.code})`
        );
      }
      throw error;
    }
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
    const client = await this.pool.connect();
    const ids: VectorId[] = [];

    try {
      await client.query('BEGIN');

      for (const item of items) {
        // ベクトル生成
        const embedding = await this.generateEmbedding(item.content);
        const normalizedEmbedding = this.normalizeVector(embedding);

        // UUIDを生成
        const id = randomUUID();
        ids.push(id);

        // memories テーブルに保存
        await client.query(
          `INSERT INTO memories (id, content, metadata, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())`,
          [id, item.content, JSON.stringify(item.metadata)]
        );

        // memory_vectors テーブルにベクトルを保存
        await client.query(
          `INSERT INTO memory_vectors (memory_id, embedding)
           VALUES ($1, $2::vector)`,
          [id, '[' + normalizedEmbedding.join(',') + ']']
        );
      }

      await client.query('COMMIT');
      return ids;
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Failed to bulk store vectors: ${error}`);
    } finally {
      client.release();
    }
  }

  async reindexVectors(): Promise<void> {
    // HNSW インデックスの再構築
    // REINDEX を使用してインデックスを再構築
    // CONCURRENTLY オプションで、再構築中も検索可能
    await this.pool.query('REINDEX INDEX CONCURRENTLY idx_memory_vectors_embedding');
  }
}
