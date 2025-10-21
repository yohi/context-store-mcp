/**
 * Search Quality Evaluator
 *
 * Task 7.3: 検索品質評価システムの実装
 * design.md の Search Quality Evaluation セクションに基づく実装
 */

import type {
  SearchEvaluationDataset,
  SearchQualityMetrics,
  AnnotationTask,
  RelevanceFeedback,
  SearchVariant,
  ABTestResult,
  SearchLogEntry,
  UserFeedbackLog,
} from './types';
import type { Memory } from '../memory/types';

/**
 * 検索品質評価クラス
 *
 * 検索システムの品質を継続的に測定・改善するための機能を提供します。
 * Precision@10 ≥ 0.8、Recall@50 ≥ 0.7、F1スコア ≥ 0.75 の目標達成を支援します。
 */
export class SearchQualityEvaluator {
  private searchLogs: SearchLogEntry[] = [];
  private feedbackLogs: UserFeedbackLog[] = [];

  /**
   * Precision@K を計算
   *
   * @param retrieved - 検索結果のメモリID一覧
   * @param relevant - 正解となる関連メモリID一覧
   * @param k - 上位K件
   * @returns Precision@K (0.0 - 1.0)
   */
  calculatePrecisionAtK(retrieved: string[], relevant: string[], k: number): number {
    // k <= 0 のガード
    if (k <= 0) {
      return 0;
    }

    // kをretrievedの長さでクランプ（オプション、正確な計算のため）
    const effectiveK = Math.min(k, retrieved.length);

    // O(1)検索のためにSetに変換
    const relevantSet = new Set(relevant);

    const topK = retrieved.slice(0, effectiveK);
    const relevantInTopK = topK.filter((id) => relevantSet.has(id));

    return relevantInTopK.length / k;
  }

  /**
   * Recall@K を計算
   *
   * @param retrieved - 検索結果のメモリID一覧
   * @param relevant - 正解となる関連メモリID一覧
   * @param k - 上位K件
   * @returns Recall@K (0.0 - 1.0)
   */
  calculateRecallAtK(retrieved: string[], relevant: string[], k: number): number {
    if (relevant.length === 0) {
      return 0;
    }

    const topK = retrieved.slice(0, k);
    const relevantInTopK = topK.filter((id) => relevant.includes(id));
    return relevantInTopK.length / relevant.length;
  }

  /**
   * F1スコアを計算
   *
   * @param precision - Precision値
   * @param recall - Recall値
   * @returns F1スコア (0.0 - 1.0)
   */
  calculateF1Score(precision: number, recall: number): number {
    if (precision + recall === 0) {
      return 0;
    }
    return (2 * precision * recall) / (precision + recall);
  }

  /**
   * Average Precisionを計算
   *
   * @param retrieved - 検索結果のメモリID一覧
   * @param relevant - 正解となる関連メモリID一覧
   * @returns Average Precision (0.0 - 1.0)
   */
  calculateAveragePrecision(retrieved: string[], relevant: string[]): number {
    if (relevant.length === 0) {
      return 0;
    }

    let sumPrecision = 0;
    let relevantCount = 0;

    for (let k = 1; k <= retrieved.length; k++) {
      if (relevant.includes(retrieved[k - 1])) {
        relevantCount++;
        const precision = relevantCount / k;
        sumPrecision += precision;
      }
    }

    return sumPrecision / relevant.length;
  }

  /**
   * Mean Average Precision (MAP) を計算
   *
   * @param queries - クエリと検索結果のペア一覧
   * @returns MAP (0.0 - 1.0)
   */
  calculateMAP(queries: Array<{ retrieved: string[]; relevant: string[] }>): number {
    if (queries.length === 0) {
      return 0;
    }

    const avgPrecisions = queries.map((q) => this.calculateAveragePrecision(q.retrieved, q.relevant));
    return avgPrecisions.reduce((sum, ap) => sum + ap, 0) / queries.length;
  }

  /**
   * 検索品質を評価
   *
   * @param dataset - 評価データセット
   * @param searchFn - 検索関数
   * @returns 検索品質メトリクス
   */
  async evaluateSearchQuality(
    dataset: SearchEvaluationDataset,
    searchFn: (query: string, limit: number) => Promise<Array<{ id: string }>>
  ): Promise<SearchQualityMetrics> {
    // データセット検証
    this.validateDataset(dataset);

    const results: Array<{
      retrieved: string[];
      relevant: string[];
    }> = [];

    // 各クエリで検索実行
    for (const query of dataset.queries) {
      const searchResults = await searchFn(query.query, 50);
      results.push({
        retrieved: searchResults.map((m) => m.id),
        relevant: query.relevantMemoryIds,
      });
    }

    // メトリクス計算
    const precisionAt10Values = results.map((r) => this.calculatePrecisionAtK(r.retrieved, r.relevant, 10));
    const recallAt50Values = results.map((r) => this.calculateRecallAtK(r.retrieved, r.relevant, 50));

    const avgPrecisionAt10 = precisionAt10Values.reduce((sum, p) => sum + p, 0) / results.length;
    const avgRecallAt50 = recallAt50Values.reduce((sum, r) => sum + r, 0) / results.length;
    const f1 = this.calculateF1Score(avgPrecisionAt10, avgRecallAt50);
    const map = this.calculateMAP(results);

    const metrics: SearchQualityMetrics = {
      precisionAt10: avgPrecisionAt10,
      recallAt50: avgRecallAt50,
      f1Score: f1,
      meanAveragePrecision: map,
      evaluatedAt: new Date(),
      testSetSize: dataset.queries.length,
      passedThresholds: {
        precisionAt10Passed: avgPrecisionAt10 >= 0.8,
        recallAt50Passed: avgRecallAt50 >= 0.7,
        f1ScorePassed: f1 >= 0.75,
      },
    };

    return metrics;
  }

  /**
   * Fleiss' Kappa係数を計算 (アノテーター間一致度)
   *
   * カテゴリ数 k=4 (relevanceLevel: 0, 1, 2, 3) に対する真のFleiss' Kappa実装
   *
   * @param annotations - アノテーションタスク一覧
   * @returns Fleiss' Kappa係数 (-1.0 - 1.0、通常は 0.0 - 1.0)
   */
  calculateFleissKappa(annotations: AnnotationTask[]): number {
    if (annotations.length === 0) {
      return 0;
    }

    const NUM_CATEGORIES = 4; // カテゴリ: 0, 1, 2, 3
    const items: Map<string, number[]> = new Map(); // memoryId -> カテゴリごとの投票数 [n_i0, n_i1, n_i2, n_i3]

    // Step 1: 各アイテム(memoryId)に対する各カテゴリへの投票数を集計
    for (const annotation of annotations) {
      const judgments = annotation.annotatorJudgments;
      if (judgments.length < 2) continue;

      const memoryIds = new Set(judgments.flatMap((j) => j.judgments.map((jg) => jg.memoryId)));

      for (const memoryId of memoryIds) {
        const levels = judgments
          .map((j) => j.judgments.find((jg) => jg.memoryId === memoryId)?.relevanceLevel)
          .filter((level): level is number => level !== undefined);

        if (levels.length >= 2) {
          const categoryCounts = new Array(NUM_CATEGORIES).fill(0);
          for (const level of levels) {
            if (level >= 0 && level < NUM_CATEGORIES) {
              categoryCounts[level]++;
            }
          }
          items.set(memoryId, categoryCounts);
        }
      }
    }

    if (items.size === 0) {
      return 0;
    }

    const N = items.size; // アイテム数
    let totalAnnotatorAssignments = 0;

    // Step 2: 各カテゴリの周辺比率 p_j = (1/(N*n)) * sum_i n_ij を計算
    const categoryTotals = new Array(NUM_CATEGORIES).fill(0);

    for (const categoryCounts of items.values()) {
      const n_i = categoryCounts.reduce((sum, count) => sum + count, 0);
      totalAnnotatorAssignments += n_i;

      for (let j = 0; j < NUM_CATEGORIES; j++) {
        categoryTotals[j] += categoryCounts[j];
      }
    }

    const marginalProportions = categoryTotals.map((total) => total / totalAnnotatorAssignments);

    // Step 3: 各アイテムの観測一致度 P_i を計算
    let sumP_i = 0;

    for (const categoryCounts of items.values()) {
      const n_i = categoryCounts.reduce((sum, count) => sum + count, 0);

      if (n_i <= 1) continue; // アノテーター1人以下の場合はスキップ

      let sumPairwiseAgreement = 0;
      for (let j = 0; j < NUM_CATEGORIES; j++) {
        sumPairwiseAgreement += categoryCounts[j] * (categoryCounts[j] - 1);
      }

      const P_i = sumPairwiseAgreement / (n_i * (n_i - 1));
      sumP_i += P_i;
    }

    const P_bar = sumP_i / N; // 平均観測一致度

    // Step 4: 期待一致度 P_e = sum_j p_j^2 を計算
    const P_e = marginalProportions.reduce((sum, p_j) => sum + p_j * p_j, 0);

    // Step 5: Kappa = (P_bar - P_e) / (1 - P_e)
    if (1 - P_e === 0) {
      // 完全にランダムな場合（ゼロ除算回避）
      return 0;
    }

    const kappa = (P_bar - P_e) / (1 - P_e);
    return kappa;
  }

  /**
   * 最頻値を計算
   */
  private mode(arr: number[]): number {
    const counts: Record<number, number> = {};
    let maxCount = 0;
    let modeValue = arr[0];

    for (const num of arr) {
      counts[num] = (counts[num] || 0) + 1;
      if (counts[num] > maxCount) {
        maxCount = counts[num];
        modeValue = num;
      }
    }

    return modeValue;
  }

  /**
   * データセットの検証
   *
   * @param dataset - 評価データセット
   * @throws エラー - 検証失敗時
   */
  validateDataset(dataset: SearchEvaluationDataset): void {
    // 最低クエリ数の確認
    if (dataset.queries.length < dataset.metadata.minimumQueries) {
      throw new Error(`Dataset must contain at least ${dataset.metadata.minimumQueries} queries`);
    }

    // 各クエリのアノテーター数確認
    for (const query of dataset.queries) {
      if (query.annotators.length < 2) {
        throw new Error('Each query must have at least 2 annotators');
      }

      // アノテーター間一致度の確認
      if (query.interAnnotatorAgreement !== undefined && query.interAnnotatorAgreement < 0.6) {
        throw new Error('Inter-annotator agreement must be at least 0.6 (Fleiss\' Kappa)');
      }
    }
  }

  /**
   * 検索結果をログに記録
   *
   * @param query - クエリ文字列
   * @param results - 検索結果
   * @param feedback - ユーザーフィードバック (オプション)
   */
  async logSearchResult(
    query: string,
    results: Array<{ id: string; content: string; relevanceScore?: number }>,
    feedback?: RelevanceFeedback
  ): Promise<void> {
    // 検索結果を記録
    for (const result of results) {
      const logEntry: SearchLogEntry = {
        id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        memoryId: result.id,
        query,
        relevanceScore: result.relevanceScore,
        searchedAt: new Date(),
      };
      this.searchLogs.push(logEntry);
    }

    // ユーザーフィードバックを記録
    if (feedback) {
      const feedbackLog: UserFeedbackLog = {
        id: `feedback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId: feedback.userId,
        query,
        judgments: feedback.relevanceJudgments,
        feedbackAt: feedback.timestamp,
      };
      this.feedbackLogs.push(feedbackLog);
    }
  }

  /**
   * A/Bテストを実行
   *
   * @param controlVariant - コントロールバリアント
   * @param experimentVariant - 実験バリアント
   * @param testSet - テストセット
   * @param searchFn - 検索関数
   * @returns A/Bテスト結果
   */
  async runABTest(
    controlVariant: SearchVariant,
    experimentVariant: SearchVariant,
    testSet: SearchEvaluationDataset,
    searchFn: (query: string, limit: number, variant?: SearchVariant) => Promise<Array<{ id: string }>>
  ): Promise<ABTestResult> {
    // コントロールバリアントで評価
    const controlMetrics = await this.evaluateSearchQuality(testSet, (query, limit) =>
      searchFn(query, limit, controlVariant)
    );

    // 実験バリアントで評価
    const experimentMetrics = await this.evaluateSearchQuality(testSet, (query, limit) =>
      searchFn(query, limit, experimentVariant)
    );

    // 統計的有意性検定 (簡易実装: F1スコアの差)
    const f1Diff = Math.abs(experimentMetrics.f1Score - controlMetrics.f1Score);
    const pValue = this.calculatePValue(controlMetrics.f1Score, experimentMetrics.f1Score, testSet.queries.length);

    // 勝者判定
    const winner =
      pValue < 0.05 && experimentMetrics.f1Score > controlMetrics.f1Score ? experimentVariant : controlVariant;

    return {
      winner,
      controlMetrics,
      experimentMetrics,
      pValue,
      significanceLevel: 0.05,
    };
  }

  /**
   * p値を計算 (簡易実装 - ヒューリスティック近似)
   *
   * ⚠️ 警告: この実装は段階的z-scoreしきい値による簡易近似であり、真の統計的有意性検定ではありません。
   * 検定の前提（独立性、分散の等質性、正規分布）を満たしておらず、本番環境での意思決定には使用しないでください。
   *
   * 本番品質評価には以下の実装への置き換えが必要:
   * - ブートストラップ法による平均差の推定
   * - Welch's t-test (不等分散を考慮したt検定)
   * - クエリ単位のF1スコア配列を用いた two-sample test
   *
   * @param controlScore - コントロールスコア (単一の集約スコア)
   * @param experimentScore - 実験スコア (単一の集約スコア)
   * @param sampleSize - サンプルサイズ
   * @returns 近似p値 (0.01, 0.04, 0.1, 0.5のいずれか) - 真のp値ではない
   */
  private calculatePValue(controlScore: number, experimentScore: number, sampleSize: number): number {
    // 簡易実装: スコア差とサンプルサイズから近似的なz-scoreを計算
    const diff = Math.abs(experimentScore - controlScore);
    const variance = (controlScore * (1 - controlScore) + experimentScore * (1 - experimentScore)) / 2;
    const standardError = Math.sqrt(variance / sampleSize);

    if (standardError === 0) {
      return diff === 0 ? 1.0 : 0.0;
    }

    const zScore = diff / standardError;

    // 段階的しきい値による離散的p値近似 (真の統計的p値ではない)
    // z > 1.96 なら p < 0.05 相当
    // z > 2.58 なら p < 0.01 相当
    if (zScore > 2.58) return 0.01;
    if (zScore > 1.96) return 0.04;
    if (zScore > 1.64) return 0.1;
    return 0.5;
  }

  /**
   * 改善計画を生成
   *
   * @param metrics - 検索品質メトリクス
   * @returns 改善計画 (マークダウン形式)
   */
  async generateImprovementPlan(metrics: SearchQualityMetrics): Promise<string> {
    const plans: string[] = [];

    if (metrics.precisionAt10 < 0.8) {
      plans.push('- 埋め込みモデルの変更（text-embedding-3-large への切り替え）');
      plans.push('- 類似度閾値の調整（0.7 → 0.75）');
    }

    if (metrics.recallAt50 < 0.7) {
      plans.push('- 検索対象の拡大（全文検索との併用）');
      plans.push('- クエリ拡張（同義語、関連語の追加）');
    }

    if (metrics.f1Score < 0.75) {
      plans.push('- ハイブリッド検索の重み調整');
      plans.push('- ランキングアルゴリズムの改善');
    }

    if (plans.length === 0) {
      return '現在の検索品質は目標を達成しています。';
    }

    return `## 検索品質改善計画\n\n${plans.join('\n')}`;
  }
}
