/**
 * 記憶タイプ分類器の実装
 * 要件: 3.1, 3.2, 3.3, 3.4 (記憶タイプ自動分類)
 * design.mdのMemory Type Classifier仕様に基づく
 *
 * アプローチ: ルールベース + 埋め込みベース のハイブリッド方式
 * - ルールベーススコア (0-1): 各タイプの特徴量マッチ度
 * - 埋め込みスコア (0-1): 類似記憶タイプとのコサイン類似度
 * - 最終スコア: 0.6 * ルールベース + 0.4 * 埋め込み
 *
 * 閾値設定:
 * - 高信頼度: スコア ≥ 0.8 → 自動分類確定
 * - 中信頼度: 0.6 ≤ スコア < 0.8 → 推奨タイプとして提示
 * - 低信頼度: スコア < 0.6 → デフォルト (semantic) + 警告
 */

import type { Pool } from 'pg';
import OpenAI from 'openai';
import type {
  MemoryClassification,
  MemoryClassifierService,
  MemoryType,
  LabeledSample,
  TrainingSample,
  AccuracyMetrics,
  ClassificationStats,
} from './types.js';

// エピソード記憶のキーワード（対話的、時間的、イベント的）
// 注: 「で」のような助詞は他のタイプでも頻出するため除外
const EPISODIC_KEYWORDS = [
  '昨日',
  '先週',
  '今朝',
  '金曜日',
  '会話',
  '話した',
  '議論',
  '決めた',
  'ミーティング',
  '会議',
  'スタンドアップ',
  '話し合',
  '確認した',
  '要望',
  'ゴール',
  'スプリント',
  'について',
];

// 意味記憶のキーワード（定義、仕様、概念）
const SEMANTIC_KEYWORDS = [
  '仕様',
  '定義',
  'ルール',
  '概念',
  'とは',
  'である',
  'API',
  'パターン',
  'アーキテクチャ',
  'TypeScript',
  'interface',
  'べき',
];

// 手続き記憶のキーワード（手順、方法、解決策）
const PROCEDURAL_KEYWORDS = [
  '方法',
  '手順',
  '解決',
  '修正',
  '実装',
  'インストール',
  '編集',
  '起動',
  '確認',
  'デバッグ',
  '必要',
  'する',
  'ます',
  '改善',
  'パフォーマンス',
];

// 統計情報を保持するための内部状態
interface ClassificationRecord {
  content: string;
  classification: MemoryClassification;
  timestamp: Date;
}

export class MemoryClassifier implements MemoryClassifierService {
  private classificationHistory: ClassificationRecord[] = [];
  private pool: Pool | null = null;
  private openaiClient: OpenAI | null = null;
  private embeddingModel: string = 'text-embedding-3-small';

  // インスタンスプロパティとしてキーワードを保持（学習により拡張可能）
  private episodicKeywords: Set<string>;
  private semanticKeywords: Set<string>;
  private proceduralKeywords: Set<string>;

  constructor(config?: { pool?: Pool; openaiApiKey?: string }) {
    // 初期キーワードのロード
    this.episodicKeywords = new Set(EPISODIC_KEYWORDS);
    this.semanticKeywords = new Set(SEMANTIC_KEYWORDS);
    this.proceduralKeywords = new Set(PROCEDURAL_KEYWORDS);

    // Optional dependencies for embedding-based classification
    if (config?.pool) {
      this.pool = config.pool;
    }
    if (config?.openaiApiKey) {
      this.openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
    }
  }

  /**
   * コンテンツを分析して記憶タイプを自動分類
   * 要件: 3.4 (自動判定)
   */
  async classifyContent(content: string): Promise<MemoryClassification> {
    // 空コンテンツのハンドリング
    if (!content || content.trim().length === 0) {
      return this.createLowConfidenceClassification();
    }

    // 特徴量抽出
    const features = this.extractFeatures(content);

    // 各タイプのスコア計算（ハイブリッド方式）
    const episodicScore = await this.calculateEpisodicScore(features, content);
    const semanticScore = await this.calculateSemanticScore(features, content);
    const proceduralScore = await this.calculateProceduralScore(features, content);

    // 最も高いスコアのタイプを選択
    const scores: Array<{ type: MemoryType; score: number }> = [
      { type: 'episodic', score: episodicScore },
      { type: 'semantic', score: semanticScore },
      { type: 'procedural', score: proceduralScore },
    ];

    scores.sort((a, b) => b.score - a.score);

    const { type: primaryType, score: confidence } = scores[0]!;

    // primaryTypeに対応する埋め込みスコアをfeaturesに反映
    const primaryEmbeddingScore = await this.calculateEmbeddingScore(content, primaryType);
    features.embeddingScore = primaryEmbeddingScore ?? 0;

    // 低信頼度(<0.6)は仕様通り semantic へフォールバック
    if (confidence < 0.6) {
      const fallback = this.createLowConfidenceClassification();
      fallback.features = {
        ruleBasedScore: features.ruleBasedScore,
        embeddingScore: features.embeddingScore,
        detectedKeywords: features.detectedKeywords,
      };
      this.classificationHistory.push({
        content,
        classification: fallback,
        timestamp: new Date(),
      });
      return fallback;
    }

    // 推奨タイプはしきい値(>=0.6)のみ提示
    const suggestedTypes = scores
      .slice(1)
      .filter((s) => s.score >= 0.6)
      .map((s) => ({ type: s.type, confidence: s.score }));

    const classification: MemoryClassification = {
      primaryType,
      confidence,
      suggestedTypes,
      features: {
        ruleBasedScore: features.ruleBasedScore,
        embeddingScore: features.embeddingScore,
        detectedKeywords: features.detectedKeywords,
      },
    };

    this.classificationHistory.push({
      content,
      classification,
      timestamp: new Date(),
    });

    return classification;
  }

  /**
   * 特定のタイプに対する信頼度スコアを取得
   * 要件: 3.4
   */
  async getConfidenceScore(content: string, type: MemoryType): Promise<number> {
    const features = this.extractFeatures(content);

    switch (type) {
      case 'episodic':
        return this.calculateEpisodicScore(features, content);
      case 'semantic':
        return this.calculateSemanticScore(features, content);
      case 'procedural':
        return this.calculateProceduralScore(features, content);
      default:
        return 0;
    }
  }

  /**
   * 分類器の学習
   * 要件: 3.4
   *
   * 学習データから新しいキーワードを抽出し、データベースに永続化する。
   * また、各タイプのcentroidを再計算してDBに保存する。
   */
  async trainClassifier(samples: TrainingSample[]): Promise<void> {
    if (samples.length === 0) return;

    const segmenter = new Intl.Segmenter('ja-JP', { granularity: 'word' });

    // タイプごとの単語頻度マップ
    const wordCounts: Record<MemoryType, Map<string, number>> = {
      episodic: new Map(),
      semantic: new Map(),
      procedural: new Map(),
    };

    // サンプルを解析して単語をカウント
    for (const sample of samples) {
      const segments = segmenter.segment(sample.content);
      for (const segment of segments) {
        if (segment.isWordLike) {
          const word = segment.segment;
          if (word.length > 1) {
            const counts = wordCounts[sample.trueType];
            counts.set(word, (counts.get(word) || 0) + 1);
          }
        }
      }
    }

    // 頻出語をキーワードとして登録
    const THRESHOLD = 2;

    for (const type of ['episodic', 'semantic', 'procedural'] as MemoryType[]) {
      const counts = wordCounts[type];
      const targetSet = this.getKeywordSet(type);

      for (const [word, count] of counts.entries()) {
        const adaptiveThreshold = Math.min(THRESHOLD, Math.ceil(samples.length / 2));

        if (count >= adaptiveThreshold) {
          targetSet.add(word);
        }
      }
    }

    // データベースに学習データを保存し、centroidを再計算
    if (this.pool && this.openaiClient) {
      try {
        // 1. 学習データを保存
        for (const sample of samples) {
          await this.pool.query(
            `INSERT INTO classifier_training_data (content, true_type, metadata)
             VALUES ($1, $2, $3)`,
            [sample.content, sample.trueType, JSON.stringify(sample.metadata || {})]
          );
        }

        // 2. 各タイプのcentroidを再計算
        for (const type of ['episodic', 'semantic', 'procedural'] as MemoryType[]) {
          // タイプごとの全サンプルを取得
          const result = await this.pool.query(
            `SELECT content FROM classifier_training_data WHERE true_type = $1`,
            [type]
          );

          if (result.rows.length === 0) continue;

          // 各サンプルの埋め込みを生成
          const embeddings: number[][] = [];
          for (const row of result.rows) {
            const embedding = await this.generateEmbedding(row.content);
            // Skip samples where embedding generation failed
            if (embedding !== null) {
              embeddings.push(embedding);
            }
          }

          // centroidを計算（平均ベクトル）
          const centroid = this.calculateCentroid(embeddings);

          // DBに保存
          await this.pool.query(
            `INSERT INTO classifier_centroids (memory_type, centroid, sample_count, last_updated)
           VALUES ($3, $1::vector, $2, NOW())
           ON CONFLICT (memory_type) DO UPDATE SET
             centroid = EXCLUDED.centroid,
             sample_count = EXCLUDED.sample_count,
             last_updated = NOW();
           `,
            [this.toPgvector(centroid), embeddings.length, type]
          );
        }

        console.log(`学習完了。更新されたキーワード数: エピソード=${this.episodicKeywords.size}, 意味=${this.semanticKeywords.size}, 手続き=${this.proceduralKeywords.size}`);
      } catch (error) {
        console.error('Failed to persist training data:', error);
      }
    } else {
      console.log(`学習完了（メモリのみ）。更新されたキーワード数: エピソード=${this.episodicKeywords.size}, 意味=${this.semanticKeywords.size}, 手続き=${this.proceduralKeywords.size}`);
    }
  }

  /**
   * コンテンツの埋め込みを生成
   * 要件: 3.4 (埋め込みベースの分類)
   * 
   * @returns 埋め込みベクトル、または生成に失敗した場合はnull
   */
  async generateEmbedding(content: string): Promise<number[] | null> {
    if (!this.openaiClient) {
      // OpenAI client not available, return null to trigger rule-based fallback
      return null;
    }

    try {
      const response = await this.openaiClient.embeddings.create({
        model: this.embeddingModel,
        input: content,
        encoding_format: 'float',
      });

      const embedding = response.data[0]?.embedding;
      if (!embedding) {
        console.error('No embedding returned from OpenAI');
        return null;
      }

      return embedding;
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      // Return null instead of zero vector to allow callers to detect failure
      return null;
    }
  }

  private getKeywordSet(type: MemoryType): Set<string> {
    switch (type) {
      case 'episodic': return this.episodicKeywords;
      case 'semantic': return this.semanticKeywords;
      case 'procedural': return this.proceduralKeywords;
    }
  }

  /**
   * 分類精度の評価
   * 要件: 3.4 (分類精度目標70%以上)
   */
  async evaluateAccuracy(testSamples: LabeledSample[]): Promise<AccuracyMetrics> {
    if (testSamples.length === 0) {
      return {
        overall: 0,
        perType: {
          episodic: 0,
          semantic: 0,
          procedural: 0,
        },
        confusionMatrix: [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
      };
    }

    let correctCount = 0;
    const perTypeCorrect: Record<MemoryType, number> = {
      episodic: 0,
      semantic: 0,
      procedural: 0,
    };
    const perTypeTotal: Record<MemoryType, number> = {
      episodic: 0,
      semantic: 0,
      procedural: 0,
    };

    // 混同行列の初期化 (3x3)
    const confusionMatrix: number[][] = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const typeIndex: Record<MemoryType, number> = {
      episodic: 0,
      semantic: 1,
      procedural: 2,
    };

    // 各サンプルで分類実行
    for (const sample of testSamples) {
      const result = await this.classifyContent(sample.content);
      const predicted = result.primaryType;
      const actual = sample.trueType;

      // 混同行列を更新
      const actualIndex = typeIndex[actual]!;
      const predictedIndex = typeIndex[predicted]!;
      confusionMatrix[actualIndex]![predictedIndex] = (confusionMatrix[actualIndex]![predictedIndex] || 0) + 1;

      // 正解カウント
      perTypeTotal[actual]++;
      if (predicted === actual) {
        correctCount++;
        perTypeCorrect[actual]++;
      }
    }

    // 全体精度
    const overall = correctCount / testSamples.length;

    // タイプ別精度
    const perType: Record<MemoryType, number> = {
      episodic: perTypeTotal.episodic > 0 ? perTypeCorrect.episodic / perTypeTotal.episodic : 0,
      semantic: perTypeTotal.semantic > 0 ? perTypeCorrect.semantic / perTypeTotal.semantic : 0,
      procedural:
        perTypeTotal.procedural > 0 ? perTypeCorrect.procedural / perTypeTotal.procedural : 0,
    };

    return {
      overall,
      perType,
      confusionMatrix,
    };
  }

  /**
   * 分類統計情報の取得
   * 要件: 3.4 (ユーザー修正率15%以下の監視)
   */
  async getClassificationStats(): Promise<ClassificationStats> {
    const totalClassified = this.classificationHistory.length;

    if (totalClassified === 0) {
      return {
        totalClassified: 0,
        userOverrideRate: 0,
        averageConfidence: 0,
        lowConfidenceCount: 0,
      };
    }

    // 平均信頼度の計算
    const sumConfidence = this.classificationHistory.reduce(
      (sum, record) => sum + record.classification.confidence,
      0
    );
    const averageConfidence = sumConfidence / totalClassified;

    // 低信頼度（< 0.6）のカウント
    const lowConfidenceCount = this.classificationHistory.filter(
      (record) => record.classification.confidence < 0.6
    ).length;

    return {
      totalClassified,
      userOverrideRate: 0, // Phase 4.2 で実装予定
      averageConfidence,
      lowConfidenceCount,
    };
  }

  /**
   * 特徴量抽出（時間表現、キーワード、構文パターン）
   * 要件: 3.4 (分類アルゴリズム詳細)
   */
  private extractFeatures(content: string) {
    const detectedKeywords: string[] = [];

    // エピソード記憶のキーワード検出
    const episodicMatches = Array.from(this.episodicKeywords).filter((keyword) => content.includes(keyword));
    detectedKeywords.push(...episodicMatches);

    // 意味記憶のキーワード検出
    const semanticMatches = Array.from(this.semanticKeywords).filter((keyword) => content.includes(keyword));
    detectedKeywords.push(...semanticMatches);

    // 手続き記憶のキーワード検出
    const proceduralMatches = Array.from(this.proceduralKeywords).filter((keyword) => content.includes(keyword));
    detectedKeywords.push(...proceduralMatches);

    // ルールベーススコアの計算（キーワードマッチ度）
    const ruleBasedScore = Math.min(detectedKeywords.length / 5, 1.0); // 5個以上で最大スコア

    return {
      detectedKeywords,
      ruleBasedScore,
      embeddingScore: 0.0, // Will be calculated per type
      episodicMatches,
      semanticMatches,
      proceduralMatches,
    };
  }

  /**
   * エピソード記憶のスコア計算（ハイブリッド方式）
   * 最終スコア = 0.6 * ルールベース + 0.4 * 埋め込みベース
   * 埋め込みが利用できない場合はルールベースのみを使用
   */
  private async calculateEpisodicScore(features: ReturnType<typeof this.extractFeatures>, content: string): Promise<number> {
    const matchCount = features.episodicMatches.length;

    // ルールベーススコア
    let ruleScore = 0.0;
    if (matchCount >= 3) {
      ruleScore = 1.0;
    } else if (matchCount >= 2) {
      ruleScore = 0.8;
    } else if (matchCount >= 1) {
      ruleScore = 0.6;
    }

    // 埋め込みベーススコア
    const embeddingScore = await this.calculateEmbeddingScore(content, 'episodic');

    // 埋め込みが利用できない場合(embeddingScore === null)はルールベースのみを使用
    if (embeddingScore === null) {
      return ruleScore;
    }

    // ハイブリッドスコア
    return 0.6 * ruleScore + 0.4 * embeddingScore;
  }

  /**
   * 意味記憶のスコア計算（ハイブリッド方式）
   * 埋め込みが利用できない場合はルールベースのみを使用
   */
  private async calculateSemanticScore(features: ReturnType<typeof this.extractFeatures>, content: string): Promise<number> {
    const matchCount = features.semanticMatches.length;

    let ruleScore = 0.0;
    if (matchCount >= 3) {
      ruleScore = 1.0;
    } else if (matchCount >= 2) {
      ruleScore = 0.8;
    } else if (matchCount >= 1) {
      ruleScore = 0.6;
    }

    const embeddingScore = await this.calculateEmbeddingScore(content, 'semantic');

    // 埋め込みが利用できない場合はルールベースのみを使用
    if (embeddingScore === null) {
      return ruleScore;
    }

    return 0.6 * ruleScore + 0.4 * embeddingScore;
  }

  /**
   * 手続き記憶のスコア計算（ハイブリッド方式）
   * 埋め込みが利用できない場合はルールベースのみを使用
   */
  private async calculateProceduralScore(features: ReturnType<typeof this.extractFeatures>, content: string): Promise<number> {
    const matchCount = features.proceduralMatches.length;

    let ruleScore = 0.0;
    if (matchCount >= 3) {
      ruleScore = 1.0;
    } else if (matchCount >= 2) {
      ruleScore = 0.8;
    } else if (matchCount >= 1) {
      ruleScore = 0.6;
    }

    const embeddingScore = await this.calculateEmbeddingScore(content, 'procedural');

    // 埋め込みが利用できない場合はルールベースのみを使用
    if (embeddingScore === null) {
      return ruleScore;
    }

    return 0.6 * ruleScore + 0.4 * embeddingScore;
  }

  /**
   * 埋め込みベースのスコア計算（centroidとのコサイン類似度）
   * 失敗時はnullを返し、呼び出し側でrule-basedスコアのみを使用する
   */
  private async calculateEmbeddingScore(content: string, type: MemoryType): Promise<number | null> {
    if (!this.pool || !this.openaiClient) {
      return null; // Fallback to rule-based only
    }

    try {
      // コンテンツの埋め込みを生成
      const contentEmbedding = await this.generateEmbedding(content);

      // Embedding generation failed, fallback to rule-based only
      if (contentEmbedding === null) {
        return null;
      }

      // DBからcentroidを取得
      const result = await this.pool.query(
        `SELECT centroid FROM classifier_centroids WHERE memory_type = $1`,
        [type]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const centroidData = result.rows[0]?.centroid;
      if (!centroidData) return null;

      // pgvectorの文字列または配列をパース
      const centroid = this.parsePgvector(centroidData);

      // コサイン類似度を計算
      const similarity = this.calculateCosineSimilarity(contentEmbedding, centroid);

      // 0-1の範囲に正規化（コサイン類似度は-1~1なので、0~1にマップ）
      return Math.max(0, Math.min(1, (similarity + 1) / 2));
    } catch (error) {
      console.error(`Failed to calculate embedding score for ${type}:`, error);
      return null;
    }
  }

  /**
   * centroidを計算（平均ベクトル）
   */
  private calculateCentroid(embeddings: number[][]): number[] {
    if (embeddings.length === 0) {
      return new Array(1536).fill(0);
    }

    const dimension = embeddings[0]!.length;
    // 次元の一致を検証
    for (const embedding of embeddings) {
      if (embedding.length !== dimension) {
        throw new Error(`Dimension mismatch in embeddings: expected ${dimension}, got ${embedding.length}`);
      }
    }
    const centroid = new Array(dimension).fill(0);

    for (const embedding of embeddings) {
      for (let i = 0; i < dimension; i++) {
        centroid[i] += embedding[i]!;
      }
    }

    for (let i = 0; i < dimension; i++) {
      centroid[i] /= embeddings.length;
    }

    return centroid;
  }

  /**
   * コサイン類似度を計算
   */
  private calculateCosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) {
      throw new Error(`Vector dimensions mismatch: ${vec1.length} vs ${vec2.length}`);
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i]! * vec2[i]!;
      norm1 += vec1[i]! * vec1[i]!;
      norm2 += vec2[i]! * vec2[i]!;
    }

    const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
    if (denominator === 0) {
      return 0;
    }

    return dotProduct / denominator;
  }

  /**
   * pgvectorをパース
   */
  private parsePgvector(value: unknown): number[] {
    if (Array.isArray(value)) {
      return value.map((n) => {
        const num = Number(n);
        if (!Number.isFinite(num)) {
          throw new Error(`Invalid number in pgvector array: ${n}`);
        }
        return num;
      });
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      const body =
        trimmed.startsWith('[') && trimmed.endsWith(']')
          ? trimmed.slice(1, -1)
          : trimmed;

      if (!body) {
        throw new Error(`Empty pgvector string found, cannot parse embedding. Raw value: "${value}"`);
      }

      return body.split(',').map((x) => {
        const num = Number(x.trim());
        if (!Number.isFinite(num)) {
          throw new Error(`Invalid number in pgvector string: ${x}`);
        }
        return num;
      });
    }

    throw new Error(`Invalid embedding type from database: ${typeof value}`);
  }

  /**
   * ベクトルをpgvector形式の文字列に変換
   */
  private toPgvector(vector: number[]): string {
    return `[${vector.join(',')}]`;
  }

  /**
   * 低信頼度のデフォルト分類を作成
   */
  private createLowConfidenceClassification(): MemoryClassification {
    return {
      primaryType: 'semantic', // デフォルトは semantic
      confidence: 0,
      suggestedTypes: [
        { type: 'episodic', confidence: 0 },
        { type: 'procedural', confidence: 0 },
      ],
      features: {
        ruleBasedScore: 0,
        embeddingScore: 0,
        detectedKeywords: [],
      },
    };
  }
}
