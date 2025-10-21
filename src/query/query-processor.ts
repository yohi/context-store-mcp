/**
 * Query Processor Implementation
 *
 * Task 7.1: クエリプロセッサーの基本機能
 * - 自然言語クエリの解析
 * - 時間フィルタの解釈と適用
 * - タグとメタデータフィルタリング
 * - クエリプランの生成と最適化
 * - 検索戦略の自動選択
 *
 * Requirements: 2.2, 2.4, 2.6
 */

import type {
  SearchQuery,
  ParsedQuery,
  QueryIntent,
  TimeFilter,
  RelativeTimeValue,
  TimeRange,
  MetadataFilter,
  QueryPlan,
  QueryStep,
  SearchStrategy,
  OptimizedQueryPlan,
} from './types';
import type { MemoryType } from '../memory/types';

import type { LRUCache } from '../mcp/lru-cache';
import { createHash } from 'crypto';

/**
 * クエリプロセッサー
 *
 * Task 7.2: ハイブリッド検索とキャッシング機能を追加
 */
export class QueryProcessor {
  private cache?: LRUCache<any>;
  private cacheHits: number = 0;
  private cacheMisses: number = 0;

  /**
   * コンストラクタ
   *
   * @param options 設定オプション
   */
  constructor(options?: { cache?: LRUCache<any> }) {
    if (options?.cache) {
      this.cache = options.cache;
    }
  }

  /**
   * クエリを解析する
   */
  async parseQuery(query: SearchQuery): Promise<ParsedQuery> {
    // 空のクエリチェック
    if (!query.query || query.query.trim() === '') {
      throw new Error('Query cannot be empty');
    }

    const rawQuery = query.query.trim();

    // クエリの意図を推論
    const intent = this.inferIntent(rawQuery);

    // キーワード抽出
    const keywords = this.extractKeywords(rawQuery);

    // 時間フィルタの抽出
    const timeFilter = this.extractTimeFilter(rawQuery, query.filters?.timeRange);

    // タグの抽出
    const tags = query.filters?.tags || this.extractTags(rawQuery);

    // 記憶タイプの推論
    const memoryTypes = query.filters?.memoryTypes || this.inferMemoryTypes(rawQuery);

    return {
      rawQuery,
      intent,
      keywords,
      timeFilter,
      tags,
      memoryTypes,
    };
  }

  /**
   * クエリの意図を推論する
   */
  private inferIntent(query: string): QueryIntent {
    const lowerQuery = query.toLowerCase();

    // 関連性検索
    if (lowerQuery.includes('関連') || lowerQuery.includes('つながり')) {
      return 'find_related';
    }

    // シーケンス検索
    if (
      lowerQuery.includes('手順') ||
      lowerQuery.includes('ステップ') ||
      lowerQuery.includes('次の')
    ) {
      return 'find_sequence';
    }

    // 矛盾検索
    if (lowerQuery.includes('矛盾') || lowerQuery.includes('対立')) {
      return 'find_contradiction';
    }

    // 時系列検索
    if (
      lowerQuery.includes('時系列') ||
      lowerQuery.includes('タイムライン') ||
      lowerQuery.includes('履歴')
    ) {
      return 'timeline';
    }

    // デフォルトは一般的な検索
    return 'search';
  }

  /**
   * キーワードを抽出する
   */
  private extractKeywords(query: string): string[] {
    // 簡易的なキーワード抽出
    // ストップワードを除去し、意味のある単語のみを抽出
    const stopWords = new Set([
      'の',
      'に',
      'を',
      'は',
      'が',
      'で',
      'と',
      'から',
      'まで',
      'や',
      'な',
      'する',
      'ある',
      'いる',
      'この',
      'その',
      'あの',
      'どの',
    ]);

    // 複合語を認識するための前処理
    // 例: "セットアップ方法" → ["セットアップ", "方法"]
    const compoundWords = query
      .replace(/[、。]/g, ' ')
      // 助詞で分割
      .split(/[のにをはがでとからまでやな]/)
      .filter((word) => word.trim().length > 0);

    const keywords: string[] = [];

    for (const word of compoundWords) {
      // 空白で分割
      const subWords = word.trim().split(/\s+/);
      for (const subWord of subWords) {
        if (subWord.length > 0 && !stopWords.has(subWord)) {
          keywords.push(subWord);
        }
      }
    }

    return keywords;
  }

  /**
   * クエリから時間フィルタを抽出する
   */
  private extractTimeFilter(
    query: string,
    explicitFilter?: TimeFilter
  ): TimeFilter | undefined {
    // 明示的なフィルタがあればそれを使用
    if (explicitFilter) {
      return explicitFilter;
    }

    const lowerQuery = query.toLowerCase();

    // 相対時間表現の検出
    if (lowerQuery.includes('昨日')) {
      return { type: 'relative', value: 'yesterday' };
    }
    if (lowerQuery.includes('先週') || lowerQuery.includes('前週')) {
      return { type: 'relative', value: 'last_week' };
    }
    if (lowerQuery.includes('先月') || lowerQuery.includes('前月')) {
      return { type: 'relative', value: 'last_month' };
    }
    if (lowerQuery.includes('過去7日') || lowerQuery.includes('この1週間')) {
      return { type: 'relative', value: 'last_7_days' };
    }
    if (lowerQuery.includes('過去30日') || lowerQuery.includes('この1ヶ月')) {
      return { type: 'relative', value: 'last_30_days' };
    }

    // 絶対日時の検出 (例: 2024年1月)
    const yearMonthPattern = /(\d{4})年(\d{1,2})月/;
    const match = query.match(yearMonthPattern);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);

      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0, 23, 59, 59, 999);

      return { type: 'absolute', start, end };
    }

    return undefined;
  }

  /**
   * クエリからタグを抽出する
   */
  private extractTags(query: string): string[] | undefined {
    // クエリからタグを推論
    // 例: 「バグ修正」→ ['bug', 'fix']
    const tagKeywords: Record<string, string[]> = {
      バグ: ['bug'],
      修正: ['fix'],
      機能: ['feature'],
      リファクタ: ['refactor'],
      ドキュメント: ['docs'],
      テスト: ['test'],
    };

    const tags: string[] = [];
    for (const [keyword, tagList] of Object.entries(tagKeywords)) {
      if (query.includes(keyword)) {
        tags.push(...tagList);
      }
    }

    return tags.length > 0 ? tags : undefined;
  }

  /**
   * クエリから記憶タイプを推論する
   */
  private inferMemoryTypes(query: string): MemoryType[] | undefined {
    const lowerQuery = query.toLowerCase();
    const types: MemoryType[] = [];

    // エピソード記憶のシグナル
    if (
      lowerQuery.includes('会議') ||
      lowerQuery.includes('議論') ||
      lowerQuery.includes('話した') ||
      lowerQuery.includes('過去の') ||
      lowerQuery.includes('記録')
    ) {
      types.push('episodic');
    }

    // 意味記憶のシグナル
    if (
      lowerQuery.includes('仕様') ||
      lowerQuery.includes('定義') ||
      lowerQuery.includes('ルール') ||
      lowerQuery.includes('概念')
    ) {
      types.push('semantic');
    }

    // 手続き記憶のシグナル (より詳細なパターンマッチング)
    const proceduralPatterns = [
      '手順',
      '方法',
      'やり方',
      '解決策',
      'ステップ',
      '実装',
    ];

    // 関連性キーワードの検出
    // 「関連」が含まれていても、手続き記憶のキーワードがなければ手続き記憶とは判定しない
    let hasProceduralKeyword = false;
    for (const pattern of proceduralPatterns) {
      if (lowerQuery.includes(pattern)) {
        hasProceduralKeyword = true;
        break;
      }
    }

    if (hasProceduralKeyword) {
      types.push('procedural');
    }

    return types.length > 0 ? types : undefined;
  }

  /**
   * 時間フィルタを解釈して日時範囲に変換する
   */
  interpretTimeFilter(timeFilter: TimeFilter): TimeRange {
    if (timeFilter.type === 'absolute') {
      // 絶対日時はそのまま使用
      if (timeFilter.start >= timeFilter.end) {
        throw new Error('Invalid time range: start must be before end');
      }
      return {
        start: timeFilter.start,
        end: timeFilter.end,
      };
    }

    // 相対日時を絶対日時に変換
    return this.convertRelativeTime(timeFilter.value);
  }

  /**
   * 相対時間を絶対時間に変換する
   */
  private convertRelativeTime(value: RelativeTimeValue): TimeRange {
    const now = new Date();
    let start: Date;
    let end: Date = now;

    switch (value) {
      case 'today':
        start = new Date(now);
        start.setHours(0, 0, 0, 0);
        break;

      case 'yesterday':
        start = new Date(now);
        start.setDate(start.getDate() - 1);
        start.setHours(0, 0, 0, 0);

        end = new Date(start);
        end.setHours(23, 59, 59, 999);
        break;

      case 'last_week':
        start = new Date(now);
        start.setDate(start.getDate() - 7);
        start.setHours(0, 0, 0, 0);
        break;

      case 'last_month':
        start = new Date(now);
        start.setMonth(start.getMonth() - 1);
        start.setHours(0, 0, 0, 0);
        break;

      case 'last_7_days':
        start = new Date(now);
        start.setDate(start.getDate() - 7);
        start.setHours(0, 0, 0, 0);
        break;

      case 'last_30_days':
        start = new Date(now);
        start.setDate(start.getDate() - 30);
        start.setHours(0, 0, 0, 0);
        break;

      case 'last_90_days':
        start = new Date(now);
        start.setDate(start.getDate() - 90);
        start.setHours(0, 0, 0, 0);
        break;

      default:
        throw new Error('Unsupported relative time value');
    }

    return { start, end };
  }

  /**
   * メタデータフィルタを構築する
   */
  buildMetadataFilter(params: {
    tags?: string[];
    memoryTypes?: MemoryType[];
    timeRange?: TimeRange;
    source?: string;
  }): MetadataFilter {
    const filter: MetadataFilter = {};

    if (params.tags) {
      filter.tags = params.tags;
    }

    if (params.memoryTypes) {
      filter.memoryTypes = params.memoryTypes;
    }

    if (params.timeRange) {
      filter.createdAfter = params.timeRange.start;
      filter.createdBefore = params.timeRange.end;
    }

    if (params.source) {
      filter.source = params.source;
    }

    return filter;
  }

  /**
   * クエリプランを生成する
   */
  async generateQueryPlan(query: SearchQuery): Promise<QueryPlan> {
    // クエリを解析
    const parsed = await this.parseQuery(query);

    // 検索戦略を選択
    const strategy = await this.selectSearchStrategy(query);

    // ステップを生成
    const steps = this.generateSteps(strategy, parsed);

    // フィルタを構築
    const filters = this.buildMetadataFilter({
      tags: parsed.tags,
      memoryTypes: parsed.memoryTypes,
      timeRange: parsed.timeFilter
        ? this.interpretTimeFilter(parsed.timeFilter)
        : undefined,
    });

    // 予想実行時間を計算
    const estimatedTime = steps.reduce((sum, step) => sum + (step.estimatedTime || 0), 0);

    return {
      strategy,
      steps,
      filters,
      estimatedTime,
    };
  }

  /**
   * 検索戦略を選択する
   */
  async selectSearchStrategy(query: SearchQuery): Promise<SearchStrategy> {
    const parsed = await this.parseQuery(query);

    // タグフィルタが多い場合、メタデータフィルタリング優先
    if (parsed.tags && parsed.tags.length >= 4) {
      return 'metadata_filtering';
    }

    // 関連性検索やシーケンス検索の場合、ハイブリッド
    // (手続き記憶への優先度より高い)
    if (parsed.intent === 'find_related' || parsed.intent === 'find_sequence') {
      return 'hybrid';
    }

    // 手続き記憶に限定する場合で、関連性検索でない場合、グラフ優先
    if (parsed.memoryTypes?.includes('procedural')) {
      return 'graph_priority';
    }

    // デフォルトはベクトル検索のみ
    return 'vector_only';
  }

  /**
   * クエリステップを生成する
   */
  private generateSteps(strategy: SearchStrategy, parsed: ParsedQuery): QueryStep[] {
    const steps: QueryStep[] = [];

    switch (strategy) {
      case 'vector_only':
        steps.push({
          type: 'vector_search',
          params: { query: parsed.rawQuery },
          estimatedTime: 500,
        });
        break;

      case 'graph_only':
        steps.push({
          type: 'graph_search',
          params: { query: parsed.rawQuery },
          estimatedTime: 800,
        });
        break;

      case 'hybrid':
        // ベクトル検索
        steps.push({
          type: 'vector_search',
          params: { query: parsed.rawQuery },
          estimatedTime: 500,
        });

        // グラフ検索
        steps.push({
          type: 'graph_search',
          params: { query: parsed.rawQuery },
          estimatedTime: 800,
        });

        // 結果のマージ
        steps.push({
          type: 'merge_results',
          params: { weights: { semantic: 0.7, structural: 0.3 } },
          estimatedTime: 100,
        });

        // ランキング
        steps.push({
          type: 'rank_results',
          estimatedTime: 50,
        });
        break;

      case 'graph_priority':
        // グラフ検索を優先
        steps.push({
          type: 'graph_search',
          params: { query: parsed.rawQuery },
          estimatedTime: 800,
        });

        // 必要に応じてベクトル検索で補完
        steps.push({
          type: 'vector_search',
          params: { query: parsed.rawQuery },
          estimatedTime: 500,
        });

        steps.push({
          type: 'merge_results',
          params: { weights: { semantic: 0.3, structural: 0.7 } },
          estimatedTime: 100,
        });
        break;

      case 'metadata_filtering':
        // メタデータフィルタを先に適用
        steps.push({
          type: 'metadata_filter',
          filters: this.buildMetadataFilter({
            tags: parsed.tags,
            memoryTypes: parsed.memoryTypes,
          }),
          estimatedTime: 200,
        });

        // フィルタ後にベクトル検索
        steps.push({
          type: 'vector_search',
          params: { query: parsed.rawQuery },
          estimatedTime: 300,
        });
        break;
    }

    return steps;
  }

  /**
   * クエリプランを最適化する
   */
  optimizeQueryPlan(plan: QueryPlan): OptimizedQueryPlan {
    const optimizations: string[] = [];
    const originalEstimatedTime = plan.estimatedTime || 0;
    let optimizedSteps = [...plan.steps];

    // 最適化1: フィルタの早期適用
    if (plan.filters.memoryTypes && plan.filters.memoryTypes.length > 0) {
      // 記憶タイプフィルタを最初のステップに適用
      optimizedSteps = optimizedSteps.map((step, index) => {
        if (index === 0 && step.type !== 'cache_lookup') {
          return {
            ...step,
            filters: { ...step.filters, memoryTypes: plan.filters.memoryTypes },
          };
        }
        return step;
      });
      optimizations.push('Early filter application for memory types');
    }

    // 最適化2: 時間範囲フィルタの早期適用
    if (plan.filters.createdAfter || plan.filters.createdBefore) {
      optimizedSteps = optimizedSteps.map((step, index) => {
        if (index === 0 && step.type !== 'cache_lookup') {
          return {
            ...step,
            filters: {
              ...step.filters,
              createdAfter: plan.filters.createdAfter,
              createdBefore: plan.filters.createdBefore,
            },
          };
        }
        return step;
      });
      optimizations.push('Early filter application for time range');
    }

    // 最適化3: キャッシュルックアップの追加
    if (!optimizedSteps.some((step) => step.type === 'cache_lookup')) {
      optimizedSteps.unshift({
        type: 'cache_lookup',
        estimatedTime: 10,
      });
      optimizations.push('Added cache lookup step');
    }

    // 予想実行時間を再計算
    const estimatedTime = optimizedSteps.reduce(
      (sum, step) => sum + (step.estimatedTime || 0),
      0
    );

    // 改善率を計算
    const improvementRate =
      originalEstimatedTime > 0
        ? (originalEstimatedTime - estimatedTime) / originalEstimatedTime
        : 0;

    return {
      ...plan,
      steps: optimizedSteps,
      estimatedTime,
      optimizations,
      originalEstimatedTime,
      improvementRate,
    };
  }

  /**
   * Task 7.2: ハイブリッド検索とキャッシング
   */

  /**
   * ハイブリッド検索 - ベクトル検索とグラフ検索の結果を統合
   *
   * design.md のハイブリッド検索スコアリング詳細に準拠:
   * - 最終スコア = w_semantic * semantic_score + w_structural * structural_score
   * - デフォルト重み: semantic = 0.7, structural = 0.3
   * - グラフスコア正規化: structural_score = exp(-α * path_length), α = 1.0
   */
  async hybridSearch(
    _query: string,
    options?: {
      weights?: { semantic: number; structural: number };
      limit?: number;
    }
  ): Promise<any[]> {
    // デフォルトパラメータ
    const weights = options?.weights || { semantic: 0.7, structural: 0.3 };

    // 重みの正規化 (合計が1.0でない場合)
    const totalWeight = weights.semantic + weights.structural;
    // 将来の実装で使用予定
    void totalWeight; // Suppress unused variable warning

    // TODO: VectorStoreAdapter と GraphStoreAdapter の統合
    // 現在はスタブ実装
    return [];
  }

  /**
   * クエリハッシュを生成
   *
   * 同一のクエリ + フィルタに対して決定的なハッシュを生成
   */
  generateQueryHash(query: string, filters?: any): string {
    // 決定的なシリアライゼーションのためにオブジェクトキーを再帰的にソート
    const canonicalize = (obj: any): any => {
      if (obj === null || obj === undefined) {
        return null;
      }
      if (typeof obj !== 'object') {
        return obj;
      }
      if (Array.isArray(obj)) {
        return obj.map(canonicalize);
      }
      // オブジェクトのキーをソートして新しいオブジェクトを作成
      const sortedKeys = Object.keys(obj).sort();
      const result: Record<string, any> = {};
      for (const key of sortedKeys) {
        result[key] = canonicalize(obj[key]);
      }
      return result;
    };

    const queryData = JSON.stringify({
      query,
      filters: canonicalize(filters || {}),
    });

    return createHash('sha256').update(queryData).digest('hex');
  }

  /**
   * 検索結果をキャッシュに保存
   *
   * @param queryHash クエリハッシュ
   * @param results 検索結果
   */
  cacheSearchResult(queryHash: string, results: any): void {
    if (!this.cache) {
      return;
    }

    this.cache.set(queryHash, results);
  }

  /**
   * キャッシュから結果を取得
   *
   * @param queryHash クエリハッシュ
   * @returns キャッシュされた結果（存在しない場合はundefined）
   */
  getCachedResult(queryHash: string): any | undefined {
    if (!this.cache) {
      this.cacheMisses++;
      return undefined;
    }

    const cached = this.cache.get(queryHash);

    if (cached) {
      this.cacheHits++;
      return cached;
    } else {
      this.cacheMisses++;
      return undefined;
    }
  }

  /**
   * キャッシュを無効化
   *
   * @param key 無効化するキャッシュキー（省略時は全キャッシュをクリア）
   */
  invalidateCache(key?: string): void {
    if (!this.cache) {
      return;
    }

    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  /**
   * タグに基づいてキャッシュを無効化
   *
   * @param _tags 無効化対象のタグ
   */
  invalidateCacheByTags(_tags: string[]): void {
    if (!this.cache) {
      return;
    }

    // キャッシュキーにタグ情報が含まれていれば削除
    // TODO: より効率的な実装（キャッシュメタデータの活用）
    this.cache.clear();
  }

  /**
   * 記憶タイプに基づいてキャッシュを無効化
   *
   * @param _memoryType 無効化対象の記憶タイプ
   */
  invalidateCacheByMemoryType(_memoryType: MemoryType): void {
    if (!this.cache) {
      return;
    }

    // TODO: より効率的な実装（キャッシュメタデータの活用）
    this.cache.clear();
  }

  /**
   * 全キャッシュをクリア
   */
  clearCache(): void {
    if (!this.cache) {
      return;
    }

    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * キャッシュヒット率を取得
   *
   * @returns ヒット率 (0.0 - 1.0)
   */
  getCacheHitRate(): number {
    const total = this.cacheHits + this.cacheMisses;

    if (total === 0) {
      return 0;
    }

    return this.cacheHits / total;
  }
}
