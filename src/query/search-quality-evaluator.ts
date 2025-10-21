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

    // k <= 0 のガード
    if (k <= 0) {
      return 0;
    }

    // O(1)検索のためにSetに変換
    const relevantSet = new Set(relevant);

    const topK = retrieved.slice(0, k);
    const relevantInTopK = topK.filter((id) => relevantSet.has(id));
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

    // O(1)検索のためにSetに変換
    const relevantSet = new Set(relevant);

    let sumPrecision = 0;
    let relevantCount = 0;

    for (let k = 1; k <= retrieved.length; k++) {
      if (relevantSet.has(retrieved[k - 1])) {
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
   * クエリごとのF1スコアを収集し、Welchのt検定で統計的有意性を評価します。
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
    // クエリごとのメトリクスを収集
    const controlF1Scores: number[] = [];
    const experimentF1Scores: number[] = [];
    const controlPrecisionScores: number[] = [];
    const experimentPrecisionScores: number[] = [];
    const controlRecallScores: number[] = [];
    const experimentRecallScores: number[] = [];

    // 各クエリで両方のバリアントを評価
    for (const query of testSet.queries) {
      // コントロールバリアント
      const controlResults = await searchFn(query.query, 50, controlVariant);
      const controlRetrieved = controlResults.map((m) => m.id);
      const controlPrecision = this.calculatePrecisionAtK(controlRetrieved, query.relevantMemoryIds, 10);
      const controlRecall = this.calculateRecallAtK(controlRetrieved, query.relevantMemoryIds, 50);
      const controlF1 = this.calculateF1Score(controlPrecision, controlRecall);
      controlF1Scores.push(controlF1);
      controlPrecisionScores.push(controlPrecision);
      controlRecallScores.push(controlRecall);

      // 実験バリアント
      const experimentResults = await searchFn(query.query, 50, experimentVariant);
      const experimentRetrieved = experimentResults.map((m) => m.id);
      const experimentPrecision = this.calculatePrecisionAtK(experimentRetrieved, query.relevantMemoryIds, 10);
      const experimentRecall = this.calculateRecallAtK(experimentRetrieved, query.relevantMemoryIds, 50);
      const experimentF1 = this.calculateF1Score(experimentPrecision, experimentRecall);
      experimentF1Scores.push(experimentF1);
      experimentPrecisionScores.push(experimentPrecision);
      experimentRecallScores.push(experimentRecall);
    }

    // 集約メトリクスを計算
    const avgControlPrecision = controlPrecisionScores.reduce((sum, p) => sum + p, 0) / controlPrecisionScores.length;
    const avgControlRecall = controlRecallScores.reduce((sum, r) => sum + r, 0) / controlRecallScores.length;
    const avgControlF1 = controlF1Scores.reduce((sum, f1) => sum + f1, 0) / controlF1Scores.length;

    const avgExperimentPrecision =
      experimentPrecisionScores.reduce((sum, p) => sum + p, 0) / experimentPrecisionScores.length;
    const avgExperimentRecall = experimentRecallScores.reduce((sum, r) => sum + r, 0) / experimentRecallScores.length;
    const avgExperimentF1 = experimentF1Scores.reduce((sum, f1) => sum + f1, 0) / experimentF1Scores.length;

    const controlMetrics: SearchQualityMetrics = {
      precisionAt10: avgControlPrecision,
      recallAt50: avgControlRecall,
      f1Score: avgControlF1,
      meanAveragePrecision: 0, // 簡易実装のため省略
      evaluatedAt: new Date(),
      testSetSize: testSet.queries.length,
      passedThresholds: {
        precisionAt10Passed: avgControlPrecision >= 0.8,
        recallAt50Passed: avgControlRecall >= 0.7,
        f1ScorePassed: avgControlF1 >= 0.75,
      },
    };

    const experimentMetrics: SearchQualityMetrics = {
      precisionAt10: avgExperimentPrecision,
      recallAt50: avgExperimentRecall,
      f1Score: avgExperimentF1,
      meanAveragePrecision: 0, // 簡易実装のため省略
      evaluatedAt: new Date(),
      testSetSize: testSet.queries.length,
      passedThresholds: {
        precisionAt10Passed: avgExperimentPrecision >= 0.8,
        recallAt50Passed: avgExperimentRecall >= 0.7,
        f1ScorePassed: avgExperimentF1 >= 0.75,
      },
    };

    // Welchのt検定による統計的有意性検定
    const pValue = this.calculateWelchTTest(controlF1Scores, experimentF1Scores);

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
   * Welchのt検定によるp値計算
   *
   * 不等分散を仮定した2標本t検定。クエリごとのF1スコア配列から統計的有意性を評価します。
   *
   * 実装の特徴:
   * - 不等分散を考慮（Welch-Satterthwaiteの自由度補正）
   * - クエリ単位のスコアのばらつきを正しく評価
   * - 両側検定（差の方向は問わない）
   *
   * 制限事項:
   * - サンプルサイズが小さい（n < 30）場合、正規分布の仮定が崩れる可能性があります
   * - t分布のp値はerf関数による近似計算（厳密な累積分布関数ではありません）
   *
   * @param controlScores - コントロールバリアントのクエリごとF1スコア配列
   * @param experimentScores - 実験バリアントのクエリごとF1スコア配列
   * @returns p値 (0.0 - 1.0) - 両側検定
   */
  private calculateWelchTTest(controlScores: number[], experimentScores: number[]): number {
    const n1 = controlScores.length;
    const n2 = experimentScores.length;

    // サンプルサイズチェック
    if (n1 < 2 || n2 < 2) {
      return 1.0; // 検定不可能
    }

    // 平均と分散を計算
    const mean1 = controlScores.reduce((sum, x) => sum + x, 0) / n1;
    const mean2 = experimentScores.reduce((sum, x) => sum + x, 0) / n2;

    const variance1 = controlScores.reduce((sum, x) => sum + Math.pow(x - mean1, 2), 0) / (n1 - 1);
    const variance2 = experimentScores.reduce((sum, x) => sum + Math.pow(x - mean2, 2), 0) / (n2 - 1);

    // Welch-Satterthwaiteの自由度
    const numerator = Math.pow(variance1 / n1 + variance2 / n2, 2);
    const denominator = Math.pow(variance1 / n1, 2) / (n1 - 1) + Math.pow(variance2 / n2, 2) / (n2 - 1);

    if (denominator === 0) {
      return 1.0; // 分散がゼロの場合
    }

    const df = numerator / denominator;

    // t統計量
    const standardError = Math.sqrt(variance1 / n1 + variance2 / n2);

    if (standardError === 0) {
      return mean1 === mean2 ? 1.0 : 0.0;
    }

    const t = Math.abs(mean1 - mean2) / standardError;

    // t分布のp値近似（両側検定）
    return this.tDistributionPValue(t, df);
  }

  /**
   * t分布のp値を近似計算
   *
   * ⚠️ 注意: この実装は簡易的な近似です。厳密な計算には外部ライブラリ（jstatなど）の使用を推奨します。
   *
   * @param t - t統計量（絶対値）
   * @param df - 自由度
   * @returns 両側検定のp値
   */
  private tDistributionPValue(t: number, df: number): number {
    // 自由度が大きい場合は正規分布で近似
    if (df > 30) {
      return 2 * (1 - this.standardNormalCDF(t));
    }

    // 小サンプルの場合の簡易近似（Hill's approximation）
    const x = df / (df + t * t);
    const a = df / 2;
    const b = 0.5;

    // 不完全ベータ関数の近似（簡易実装）
    const betaApprox = this.incompleteBetaApprox(x, a, b);

    return betaApprox;
  }

  /**
   * 標準正規分布の累積分布関数（CDF）
   *
   * erf関数を用いた近似計算
   */
  private standardNormalCDF(z: number): number {
    return 0.5 * (1 + this.erf(z / Math.sqrt(2)));
  }

  /**
   * 誤差関数（Error Function）の近似
   *
   * Abramowitz and Stegun の近似式を使用
   */
  private erf(x: number): number {
    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);

    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const t = 1 / (1 + p * x);
    const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return sign * y;
  }

  /**
   * 不完全ベータ関数の近似
   *
   * ⚠️ 簡易実装: 厳密な計算には外部ライブラリを推奨
   */
  private incompleteBetaApprox(x: number, _a: number, _b: number): number {
    // 極端なケース
    if (x <= 0) return 0;
    if (x >= 1) return 1;

    // 自由度が小さい場合の簡易近似
    // t値が大きい場合は有意（p値小）、小さい場合は非有意（p値大）
    if (x > 0.5) {
      return 2 * (1 - x); // p値の粗い近似
    } else {
      return 2 * x;
    }
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
