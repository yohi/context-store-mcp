/**
 * Query Processor Test Suite
 *
 * Task 7.1: クエリプロセッサーの基本機能
 * - 自然言語クエリの解析
 * - 時間フィルタの解釈と適用
 * - タグとメタデータフィルタリング
 * - クエリプランの生成と最適化
 * - 検索戦略の自動選択
 *
 * TDD: RED Phase - 失敗するテストを作成
 */

import { describe, test, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { QueryProcessor } from '../../query/query-processor';
import type {
  SearchQuery,
  QueryPlan,
  ParsedQuery,
  TimeFilter,
  SearchStrategy,
} from '../../query/types';

describe('QueryProcessor', () => {
  let processor: QueryProcessor;

  // フェイクタイマーで固定時刻を設定(タイムゾーン/DST非依存)
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2023-03-15T12:00:00Z'));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    processor = new QueryProcessor();
  });

  describe('自然言語クエリの解析', () => {
    test('単純なテキストクエリを解析できる', async () => {
      const query: SearchQuery = {
        query: 'TypeScript プロジェクトのセットアップ方法',
      };

      const parsed = await processor.parseQuery(query);

      expect(parsed).toBeDefined();
      expect(parsed.rawQuery).toBe('TypeScript プロジェクトのセットアップ方法');
      expect(parsed.intent).toBe('search'); // 検索意図
      expect(parsed.keywords).toContain('TypeScript');
      expect(parsed.keywords).toContain('セットアップ方法'); // 複合語として抽出される
    });

    test('時間表現を含むクエリから時間フィルタを抽出できる', async () => {
      const query: SearchQuery = {
        query: '先週のミーティングで話した内容',
      };

      const parsed = await processor.parseQuery(query);

      expect(parsed.timeFilter).toBeDefined();
      expect(parsed.timeFilter?.type).toBe('relative');
      expect(parsed.timeFilter?.value).toBe('last_week');
    });

    test('絶対日時を含むクエリから時間範囲を抽出できる', async () => {
      const query: SearchQuery = {
        query: '2024年1月のプロジェクト計画',
      };

      const parsed = await processor.parseQuery(query);

      expect(parsed.timeFilter).toBeDefined();
      expect(parsed.timeFilter?.type).toBe('absolute');
      expect(parsed.timeFilter?.start).toBeDefined();
      expect(parsed.timeFilter?.end).toBeDefined();
    });

    test('タグ指定を含むクエリからタグを抽出できる', async () => {
      const query: SearchQuery = {
        query: 'バグ修正に関する記憶',
        filters: {
          tags: ['bug', 'fix'],
        },
      };

      const parsed = await processor.parseQuery(query);

      expect(parsed.tags).toContain('bug');
      expect(parsed.tags).toContain('fix');
    });

    test('記憶タイプを含むクエリから記憶タイプを抽出できる', async () => {
      const query: SearchQuery = {
        query: '過去の会議の記録',
      };

      const parsed = await processor.parseQuery(query);

      // 「過去の会議」→ エピソード記憶と推論
      expect(parsed.memoryTypes).toContain('episodic');
    });
  });

  describe('時間フィルタの解釈と適用', () => {
    test('「昨日」を正しい日時範囲に変換できる', () => {
      const timeFilter: TimeFilter = {
        type: 'relative',
        value: 'yesterday',
      };

      const range = processor.interpretTimeFilter(timeFilter);

      expect(range.start).toBeDefined();
      expect(range.end).toBeDefined();

      // 固定日時(2023-03-15 12:00:00 UTC)から昨日を計算
      // 昨日 = 2023-03-14 00:00:00 UTC ~ 2023-03-15 00:00:00 UTC
      const expectedStart = new Date('2023-03-14T00:00:00.000Z');
      const expectedEnd = new Date('2023-03-15T00:00:00.000Z');

      expect(range.start.toISOString()).toBe(expectedStart.toISOString());
      expect(range.end.toISOString()).toBe(expectedEnd.toISOString());

      // 期間が正確に24時間(1日)であることを検証
      const diffHours = (range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60);
      expect(diffHours).toBe(24);
    });

    test('「先週」を正しい日時範囲に変換できる', () => {
      const timeFilter: TimeFilter = {
        type: 'relative',
        value: 'last_week',
      };

      const range = processor.interpretTimeFilter(timeFilter);

      expect(range.start).toBeDefined();
      expect(range.end).toBeDefined();

      // 7日間の範囲
      const diffDays = Math.floor(
        (range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24)
      );
      expect(diffDays).toBe(7);
    });

    test('「過去30日」を正しい日時範囲に変換できる', () => {
      const timeFilter: TimeFilter = {
        type: 'relative',
        value: 'last_30_days',
      };

      const range = processor.interpretTimeFilter(timeFilter);

      const diffDays = Math.floor(
        (range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24)
      );
      expect(diffDays).toBe(30);
    });

    test('絶対日時範囲をそのまま適用できる', () => {
      const start = new Date('2024-01-01');
      const end = new Date('2024-01-31');

      const timeFilter: TimeFilter = {
        type: 'absolute',
        start,
        end,
      };

      const range = processor.interpretTimeFilter(timeFilter);

      expect(range.start).toEqual(start);
      expect(range.end).toEqual(end);
    });
  });

  describe('タグとメタデータフィルタリング', () => {
    test('単一タグでフィルタ条件を構築できる', () => {
      const tags = ['bug'];

      const filter = processor.buildMetadataFilter({ tags });

      expect(filter.tags).toEqual(['bug']);
    });

    test('複数タグでフィルタ条件を構築できる (OR条件)', () => {
      const tags = ['bug', 'feature', 'refactor'];

      const filter = processor.buildMetadataFilter({ tags });

      expect(filter.tags).toEqual(['bug', 'feature', 'refactor']);
    });

    test('記憶タイプでフィルタ条件を構築できる', () => {
      const memoryTypes = ['episodic', 'semantic'];

      const filter = processor.buildMetadataFilter({ memoryTypes });

      expect(filter.memoryTypes).toEqual(['episodic', 'semantic']);
    });

    test('時間範囲とタグを組み合わせてフィルタ条件を構築できる', () => {
      const start = new Date('2024-01-01');
      const end = new Date('2024-01-31');
      const tags = ['project'];

      const filter = processor.buildMetadataFilter({
        timeRange: { start, end },
        tags,
      });

      expect(filter.createdAfter).toEqual(start);
      expect(filter.createdBefore).toEqual(end);
      expect(filter.tags).toEqual(['project']);
    });
  });

  describe('クエリプランの生成と最適化', () => {
    test('単純な検索クエリに対するプランを生成できる', async () => {
      const query: SearchQuery = {
        query: 'React フック',
      };

      const plan = await processor.generateQueryPlan(query);

      expect(plan).toBeDefined();
      expect(plan.strategy).toBe('vector_only'); // ベクトル検索のみ
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].type).toBe('vector_search');
    });

    test('関係性を含むクエリに対してハイブリッドプランを生成できる', async () => {
      const query: SearchQuery = {
        query: 'この問題の解決方法に関連する記憶',
      };

      const plan = await processor.generateQueryPlan(query);

      expect(plan.strategy).toBe('hybrid'); // ハイブリッド検索
      expect(plan.steps.length).toBeGreaterThan(1);

      // ベクトル検索とグラフ検索の両方を含む
      const hasVectorSearch = plan.steps.some((step) => step.type === 'vector_search');
      const hasGraphSearch = plan.steps.some((step) => step.type === 'graph_search');

      expect(hasVectorSearch).toBe(true);
      expect(hasGraphSearch).toBe(true);
    });

    test('時間フィルタを含むクエリに対して最適化されたプランを生成できる', async () => {
      const query: SearchQuery = {
        query: '先週の議論',
        filters: {
          timeRange: {
            type: 'relative',
            value: 'last_week',
          },
        },
      };

      const plan = await processor.generateQueryPlan(query);

      // 時間フィルタがプランに含まれる (createdAfter/createdBefore として)
      expect(plan.filters.createdAfter).toBeDefined();
      expect(plan.filters.createdBefore).toBeDefined();
    });

    test('クエリプランを最適化できる', async () => {
      const query: SearchQuery = {
        query: 'TypeScript エラー解決',
        filters: {
          tags: ['typescript', 'error'],
          memoryTypes: ['procedural'], // 手続き記憶に限定
        },
      };

      const plan = await processor.generateQueryPlan(query);
      const optimized = processor.optimizeQueryPlan(plan);

      // 最適化により、記憶タイプフィルタが早い段階で適用される
      // cache_lookupステップが追加されるため、インデックス1をチェック
      const firstNonCacheStep = optimized.steps.find((step) => step.type !== 'cache_lookup');
      expect(firstNonCacheStep?.filters?.memoryTypes).toBeDefined();
    });
  });

  describe('検索戦略の自動選択', () => {
    test('意味的検索のみが適切なクエリでvector_onlyを選択', async () => {
      const query: SearchQuery = {
        query: 'PostgreSQL のパフォーマンスチューニング',
      };

      const strategy = await processor.selectSearchStrategy(query);

      expect(strategy).toBe('vector_only');
    });

    test('関係性を含むクエリでhybridを選択', async () => {
      const query: SearchQuery = {
        query: 'この仕様に関連する実装手順',
      };

      const strategy = await processor.selectSearchStrategy(query);

      expect(strategy).toBe('hybrid');
    });

    test('手続き記憶を対象とするクエリでgraph_priorityを選択', async () => {
      const query: SearchQuery = {
        query: 'デプロイの方法',
        filters: {
          memoryTypes: ['procedural'],
        },
      };

      const strategy = await processor.selectSearchStrategy(query);

      expect(strategy).toBe('graph_priority');
    });

    test('タグフィルタが多い場合にmetadata_filteringを選択', async () => {
      const query: SearchQuery = {
        query: 'バグ修正',
        filters: {
          tags: ['bug', 'critical', 'production', 'hotfix'],
        },
      };

      const strategy = await processor.selectSearchStrategy(query);

      // タグが多い場合、メタデータフィルタリングを優先
      expect(strategy).toBe('metadata_filtering');
    });
  });

  describe('エッジケースとエラーハンドリング', () => {
    test('空のクエリに対してエラーを返す', async () => {
      const query: SearchQuery = {
        query: '',
      };

      await expect(processor.parseQuery(query)).rejects.toThrow('Query cannot be empty');
    });

    test('不正な時間フィルタに対してエラーを返す', () => {
      const timeFilter: TimeFilter = {
        type: 'absolute',
        start: new Date('2024-01-31'),
        end: new Date('2024-01-01'), // start > end
      };

      expect(() => processor.interpretTimeFilter(timeFilter)).toThrow(
        'Invalid time range: start must be before end'
      );
    });

    test('サポートされていない相対時間表現に対してエラーを返す', () => {
      const timeFilter: TimeFilter = {
        type: 'relative',
        value: 'next_week' as any, // 未来の時間はサポート外
      };

      expect(() => processor.interpretTimeFilter(timeFilter)).toThrow(
        'Unsupported relative time value'
      );
    });
  });
});
