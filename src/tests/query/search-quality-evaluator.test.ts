import { describe, it, expect, beforeEach } from 'vitest';
import { SearchQualityEvaluator } from '../../query/search-quality-evaluator';
import type {
  SearchEvaluationDataset,
  SearchQualityMetrics,
  AnnotationTask,
  RelevanceFeedback,
  SearchVariant,
} from '../../query/types';

describe('SearchQualityEvaluator', () => {
  let evaluator: SearchQualityEvaluator;

  beforeEach(() => {
    evaluator = new SearchQualityEvaluator();
  });

  describe('Precision calculation', () => {
    it('should calculate Precision@K correctly', () => {
      const retrieved = ['mem1', 'mem2', 'mem3', 'mem4', 'mem5'];
      const relevant = ['mem1', 'mem3', 'mem5'];

      const precision = evaluator.calculatePrecisionAtK(retrieved, relevant, 5);
      expect(precision).toBe(0.6); // 3 relevant out of 5
    });

    it('should handle empty retrieved set', () => {
      const retrieved: string[] = [];
      const relevant = ['mem1', 'mem2'];

      const precision = evaluator.calculatePrecisionAtK(retrieved, relevant, 10);
      expect(precision).toBe(0);
    });

    it('should handle K larger than retrieved count', () => {
      const retrieved = ['mem1', 'mem2'];
      const relevant = ['mem1'];

      const precision = evaluator.calculatePrecisionAtK(retrieved, relevant, 10);
      expect(precision).toBe(0.1); // 1 relevant out of 10
    });

    it('should calculate Precision@10 with perfect results', () => {
      const retrieved = Array.from({ length: 10 }, (_, i) => `mem${i + 1}`);
      const relevant = Array.from({ length: 10 }, (_, i) => `mem${i + 1}`);

      const precision = evaluator.calculatePrecisionAtK(retrieved, relevant, 10);
      expect(precision).toBe(1.0);
    });
  });

  describe('Recall calculation', () => {
    it('should calculate Recall@K correctly', () => {
      const retrieved = ['mem1', 'mem2', 'mem3', 'mem4', 'mem5'];
      const relevant = ['mem1', 'mem3', 'mem5', 'mem7', 'mem9'];

      const recall = evaluator.calculateRecallAtK(retrieved, relevant, 5);
      expect(recall).toBe(0.6); // 3 out of 5 relevant memories found
    });

    it('should handle empty relevant set', () => {
      const retrieved = ['mem1', 'mem2'];
      const relevant: string[] = [];

      const recall = evaluator.calculateRecallAtK(retrieved, relevant, 5);
      expect(recall).toBe(0);
    });

    it('should calculate Recall@50 with partial coverage', () => {
      const retrieved = Array.from({ length: 50 }, (_, i) => `mem${i + 1}`);
      const relevant = Array.from({ length: 20 }, (_, i) => `mem${i * 2 + 1}`);

      const recall = evaluator.calculateRecallAtK(retrieved, relevant, 50);
      expect(recall).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe('F1 Score calculation', () => {
    it('should calculate F1 score correctly', () => {
      const precision = 0.8;
      const recall = 0.7;

      const f1 = evaluator.calculateF1Score(precision, recall);
      expect(f1).toBeCloseTo(0.747, 2);
    });

    it('should return 0 when both precision and recall are 0', () => {
      const f1 = evaluator.calculateF1Score(0, 0);
      expect(f1).toBe(0);
    });

    it('should handle perfect scores', () => {
      const f1 = evaluator.calculateF1Score(1.0, 1.0);
      expect(f1).toBe(1.0);
    });
  });

  describe('Average Precision calculation', () => {
    it('should calculate Average Precision correctly', () => {
      const retrieved = ['mem1', 'mem2', 'mem3', 'mem4', 'mem5'];
      const relevant = ['mem1', 'mem3', 'mem5'];

      const ap = evaluator.calculateAveragePrecision(retrieved, relevant);
      // AP = (1/1 + 2/3 + 3/5) / 3 = (1.0 + 0.667 + 0.6) / 3 ≈ 0.756
      expect(ap).toBeCloseTo(0.756, 2);
    });

    it('should return 0 for no relevant results', () => {
      const retrieved = ['mem1', 'mem2', 'mem3'];
      const relevant: string[] = [];

      const ap = evaluator.calculateAveragePrecision(retrieved, relevant);
      expect(ap).toBe(0);
    });

    it('should handle all relevant results at top', () => {
      const retrieved = ['mem1', 'mem2', 'mem3'];
      const relevant = ['mem1', 'mem2', 'mem3'];

      const ap = evaluator.calculateAveragePrecision(retrieved, relevant);
      expect(ap).toBe(1.0);
    });
  });

  describe('Mean Average Precision calculation', () => {
    it('should calculate MAP across multiple queries', () => {
      const queries = [
        {
          retrieved: ['mem1', 'mem2', 'mem3'],
          relevant: ['mem1', 'mem3'],
        },
        {
          retrieved: ['mem4', 'mem5', 'mem6'],
          relevant: ['mem4', 'mem6'],
        },
      ];

      const map = evaluator.calculateMAP(queries);
      expect(map).toBeGreaterThan(0);
      expect(map).toBeLessThanOrEqual(1.0);
    });

    it('should return 0 for empty queries', () => {
      const queries: Array<{ retrieved: string[]; relevant: string[] }> = [];
      const map = evaluator.calculateMAP(queries);
      expect(map).toBe(0);
    });
  });

  describe('Search quality evaluation', () => {
    it('should evaluate search quality against dataset', async () => {
      const dataset: SearchEvaluationDataset = {
        queries: Array.from({ length: 100 }, (_, i) => ({
          query: `test query ${i}`,
          relevantMemoryIds: ['mem1', 'mem2', 'mem3'],
          annotators: ['expert1', 'expert2'],
          interAnnotatorAgreement: 0.8,
        })),
        metadata: {
          createdAt: new Date(),
          version: '1.0.0',
          totalQueries: 100,
          minimumQueries: 100,
        },
      };

      // Mock search function
      const mockSearch = async (query: string, limit: number) => {
        return ['mem1', 'mem2', 'mem4', 'mem5'].map(id => ({ id }));
      };

      const metrics = await evaluator.evaluateSearchQuality(dataset, mockSearch);

      expect(metrics).toHaveProperty('precisionAt10');
      expect(metrics).toHaveProperty('recallAt50');
      expect(metrics).toHaveProperty('f1Score');
      expect(metrics).toHaveProperty('meanAveragePrecision');
      expect(metrics).toHaveProperty('evaluatedAt');
      expect(metrics).toHaveProperty('testSetSize');
      expect(metrics).toHaveProperty('passedThresholds');
    });

    it('should check thresholds correctly', async () => {
      const dataset: SearchEvaluationDataset = {
        queries: Array.from({ length: 100 }, (_, i) => ({
          query: `test query ${i}`,
          relevantMemoryIds: Array.from({ length: 10 }, (_, j) => `mem${j + 1}`),
          annotators: ['expert1', 'expert2'],
          interAnnotatorAgreement: 0.8,
        })),
        metadata: {
          createdAt: new Date(),
          version: '1.0.0',
          totalQueries: 100,
          minimumQueries: 100,
        },
      };

      // Mock perfect search
      const mockSearch = async (query: string, limit: number) => {
        return Array.from({ length: limit }, (_, i) => ({ id: `mem${i + 1}` }));
      };

      const metrics = await evaluator.evaluateSearchQuality(dataset, mockSearch);

      expect(metrics.passedThresholds.precisionAt10Passed).toBe(true);
      expect(metrics.passedThresholds.recallAt50Passed).toBe(true);
      expect(metrics.passedThresholds.f1ScorePassed).toBe(true);
    });
  });

  describe('Fleiss Kappa calculation', () => {
    it('should calculate inter-annotator agreement', () => {
      const annotations = [
        {
          queryId: 'q1',
          query: 'test',
          candidateMemories: [],
          annotatorJudgments: [
            { annotator: 'expert1', judgments: [{ memoryId: 'mem1', relevanceLevel: 3 }] },
            { annotator: 'expert2', judgments: [{ memoryId: 'mem1', relevanceLevel: 3 }] },
          ],
        },
      ];

      const kappa = evaluator.calculateFleissKappa(annotations);
      expect(kappa).toBeGreaterThanOrEqual(0);
      expect(kappa).toBeLessThanOrEqual(1.0);
    });

    it('should return high kappa for perfect agreement', () => {
      const annotations = [
        {
          queryId: 'q1',
          query: 'test',
          candidateMemories: [],
          annotatorJudgments: [
            { annotator: 'expert1', judgments: [{ memoryId: 'mem1', relevanceLevel: 3 }] },
            { annotator: 'expert2', judgments: [{ memoryId: 'mem1', relevanceLevel: 3 }] },
            { annotator: 'expert3', judgments: [{ memoryId: 'mem1', relevanceLevel: 3 }] },
          ],
        },
      ];

      const kappa = evaluator.calculateFleissKappa(annotations);
      expect(kappa).toBeGreaterThanOrEqual(0.8);
    });
  });

  describe('Dataset validation', () => {
    it('should validate minimum query count', () => {
      const dataset: SearchEvaluationDataset = {
        queries: Array.from({ length: 50 }, (_, i) => ({
          query: `query ${i}`,
          relevantMemoryIds: [],
          annotators: ['expert1', 'expert2'],
        })),
        metadata: {
          createdAt: new Date(),
          version: '1.0.0',
          totalQueries: 50,
          minimumQueries: 100,
        },
      };

      expect(() => evaluator.validateDataset(dataset)).toThrow(
        'Dataset must contain at least 100 queries'
      );
    });

    it('should validate minimum annotator count', () => {
      const dataset: SearchEvaluationDataset = {
        queries: Array.from({ length: 100 }, () => ({
          query: 'test',
          relevantMemoryIds: [],
          annotators: ['expert1'], // Only 1 annotator
          interAnnotatorAgreement: 0.8,
        })),
        metadata: {
          createdAt: new Date(),
          version: '1.0.0',
          totalQueries: 100,
          minimumQueries: 100,
        },
      };

      expect(() => evaluator.validateDataset(dataset)).toThrow(
        'Each query must have at least 2 annotators'
      );
    });

    it('should validate inter-annotator agreement threshold', () => {
      const dataset: SearchEvaluationDataset = {
        queries: Array.from({ length: 100 }, (_, i) => ({
          query: `query ${i}`,
          relevantMemoryIds: [],
          annotators: ['expert1', 'expert2'],
          interAnnotatorAgreement: 0.5, // Below threshold
        })),
        metadata: {
          createdAt: new Date(),
          version: '1.0.0',
          totalQueries: 100,
          minimumQueries: 100,
        },
      };

      expect(() => evaluator.validateDataset(dataset)).toThrow(
        'Inter-annotator agreement must be at least 0.6'
      );
    });

    it('should accept valid dataset', () => {
      const dataset: SearchEvaluationDataset = {
        queries: Array.from({ length: 100 }, (_, i) => ({
          query: `query ${i}`,
          relevantMemoryIds: [],
          annotators: ['expert1', 'expert2'],
          interAnnotatorAgreement: 0.8,
        })),
        metadata: {
          createdAt: new Date(),
          version: '1.0.0',
          totalQueries: 100,
          minimumQueries: 100,
        },
      };

      expect(() => evaluator.validateDataset(dataset)).not.toThrow();
    });
  });

  describe('Search log recording', () => {
    it('should record search results with user feedback', async () => {
      const query = 'test query';
      const results = [
        { id: 'mem1', content: 'test', relevanceScore: 0.9 },
        { id: 'mem2', content: 'test2', relevanceScore: 0.8 },
      ];
      const feedback: RelevanceFeedback = {
        userId: 'user1',
        relevanceJudgments: [
          { memoryId: 'mem1', isRelevant: true, relevanceLevel: 3 },
          { memoryId: 'mem2', isRelevant: false, relevanceLevel: 0 },
        ],
        timestamp: new Date(),
      };

      await expect(
        evaluator.logSearchResult(query, results, feedback)
      ).resolves.not.toThrow();
    });

    it('should record search results without feedback', async () => {
      const query = 'test query';
      const results = [{ id: 'mem1', content: 'test', relevanceScore: 0.9 }];

      await expect(evaluator.logSearchResult(query, results)).resolves.not.toThrow();
    });
  });

  describe('A/B testing framework', () => {
    it('should run A/B test comparing two variants', async () => {
      const controlVariant: SearchVariant = {
        name: 'control',
        embeddingModel: 'text-embedding-3-small',
        similarityThreshold: 0.7,
      };

      const experimentVariant: SearchVariant = {
        name: 'experiment',
        embeddingModel: 'text-embedding-3-large',
        similarityThreshold: 0.75,
      };

      const testSet: SearchEvaluationDataset = {
        queries: Array.from({ length: 100 }, (_, i) => ({
          query: `query ${i}`,
          relevantMemoryIds: [`mem${i}`],
          annotators: ['expert1', 'expert2'],
          interAnnotatorAgreement: 0.8,
        })),
        metadata: {
          createdAt: new Date(),
          version: '1.0.0',
          totalQueries: 100,
          minimumQueries: 100,
        },
      };

      const mockSearchFn = async (query: string, limit: number, variant?: SearchVariant) => {
        return [{ id: 'mem1' }];
      };

      const result = await evaluator.runABTest(
        controlVariant,
        experimentVariant,
        testSet,
        mockSearchFn
      );

      expect(result).toHaveProperty('winner');
      expect(result).toHaveProperty('controlMetrics');
      expect(result).toHaveProperty('experimentMetrics');
      expect(result).toHaveProperty('pValue');
      expect([controlVariant, experimentVariant]).toContain(result.winner);
    });

    it('should select experiment when statistically significant improvement', async () => {
      const controlVariant: SearchVariant = { name: 'control' };
      const experimentVariant: SearchVariant = { name: 'experiment' };

      const testSet: SearchEvaluationDataset = {
        queries: Array.from({ length: 100 }, (_, i) => ({
          query: `query ${i}`,
          relevantMemoryIds: [`mem${i}`],
          annotators: ['expert1', 'expert2'],
          interAnnotatorAgreement: 0.8,
        })),
        metadata: {
          createdAt: new Date(),
          version: '1.0.0',
          totalQueries: 100,
          minimumQueries: 100,
        },
      };

      const mockSearchFn = async (query: string, limit: number, variant?: SearchVariant) => {
        // Experiment returns better results
        if (variant?.name === 'experiment') {
          return [{ id: query.replace('query ', 'mem') }]; // Perfect match
        }
        return [{ id: 'wrong' }];
      };

      const result = await evaluator.runABTest(
        controlVariant,
        experimentVariant,
        testSet,
        mockSearchFn
      );

      expect(result.winner).toBe(experimentVariant);
      expect(result.pValue).toBeLessThan(0.05);
    });
  });

  describe('Improvement plan generation', () => {
    it('should generate plan for low precision', async () => {
      const metrics: SearchQualityMetrics = {
        precisionAt10: 0.6, // Below threshold
        recallAt50: 0.8,
        f1Score: 0.7,
        meanAveragePrecision: 0.65,
        evaluatedAt: new Date(),
        testSetSize: 100,
        passedThresholds: {
          precisionAt10Passed: false,
          recallAt50Passed: true,
          f1ScorePassed: false,
        },
      };

      const plan = await evaluator.generateImprovementPlan(metrics);

      expect(plan).toContain('埋め込みモデルの変更');
      expect(plan).toContain('類似度閾値の調整');
    });

    it('should generate plan for low recall', async () => {
      const metrics: SearchQualityMetrics = {
        precisionAt10: 0.85,
        recallAt50: 0.6, // Below threshold
        f1Score: 0.7,
        meanAveragePrecision: 0.7,
        evaluatedAt: new Date(),
        testSetSize: 100,
        passedThresholds: {
          precisionAt10Passed: true,
          recallAt50Passed: false,
          f1ScorePassed: false,
        },
      };

      const plan = await evaluator.generateImprovementPlan(metrics);

      expect(plan).toContain('検索対象の拡大');
      expect(plan).toContain('クエリ拡張');
    });

    it('should generate plan for low F1', async () => {
      const metrics: SearchQualityMetrics = {
        precisionAt10: 0.82,
        recallAt50: 0.72,
        f1Score: 0.7, // Below threshold
        meanAveragePrecision: 0.75,
        evaluatedAt: new Date(),
        testSetSize: 100,
        passedThresholds: {
          precisionAt10Passed: true,
          recallAt50Passed: true,
          f1ScorePassed: false,
        },
      };

      const plan = await evaluator.generateImprovementPlan(metrics);

      expect(plan).toContain('ハイブリッド検索の重み調整');
      expect(plan).toContain('ランキングアルゴリズムの改善');
    });
  });
});
