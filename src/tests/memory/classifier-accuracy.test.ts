/**
 * Memory Classifier Accuracy Measurement Tests
 * Requirements: 3.4 (分類精度測定、ユーザーフィードバック、精度レポート)
 * Based on design.md Classification Accuracy specifications
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryClassifier } from '../../memory/memory-classifier.js';
import type { LabeledSample, MemoryType } from '../../memory/types.js';

describe('MemoryClassifier Accuracy Measurement', () => {
  let classifier: MemoryClassifier;

  beforeEach(() => {
    classifier = new MemoryClassifier();
  });

  describe('evaluateAccuracy', () => {
    it('should evaluate classification accuracy with test samples', async () => {
      const testSamples: LabeledSample[] = [
        // Episodic samples (3 samples)
        {
          content: '昨日、チームミーティングでプロジェクトの進捗について話し合った。',
          trueType: 'episodic',
        },
        {
          content: '先週の金曜日に、新しいAPIの設計について議論しました。',
          trueType: 'episodic',
        },
        {
          content: 'スタンドアップミーティングでゴールを決めた。',
          trueType: 'episodic',
        },

        // Semantic samples (3 samples)
        {
          content: 'REST APIは、HTTPメソッドを使用してリソースを操作する標準的なアーキテクチャパターンである。',
          trueType: 'semantic',
        },
        {
          content: 'TypeScriptでは、interfaceを使って型定義を行う。',
          trueType: 'semantic',
        },
        {
          content: 'マイクロサービスとは、小さく独立したサービスの集合である。',
          trueType: 'semantic',
        },

        // Procedural samples (3 samples)
        {
          content: 'バグを修正する方法: 1. エラーログを確認する。2. デバッグする。3. テストを実行する。',
          trueType: 'procedural',
        },
        {
          content: 'まず依存関係をインストールします。次に設定ファイルを編集します。',
          trueType: 'procedural',
        },
        {
          content: 'この問題を解決するには、キャッシュをクリアし、再起動する必要があります。',
          trueType: 'procedural',
        },
      ];

      const metrics = await classifier.evaluateAccuracy(testSamples);

      // Overall accuracy should be high for well-defined samples
      expect(metrics.overall).toBeGreaterThanOrEqual(0.7); // 70% target

      // Per-type accuracy
      expect(metrics.perType.episodic).toBeGreaterThan(0);
      expect(metrics.perType.semantic).toBeGreaterThan(0);
      expect(metrics.perType.procedural).toBeGreaterThan(0);

      // Confusion matrix should be 3x3
      expect(metrics.confusionMatrix).toHaveLength(3);
      expect(metrics.confusionMatrix[0]).toHaveLength(3);
    });

    it('should return zero metrics for empty test set', async () => {
      const metrics = await classifier.evaluateAccuracy([]);

      expect(metrics.overall).toBe(0);
      expect(metrics.perType.episodic).toBe(0);
      expect(metrics.perType.semantic).toBe(0);
      expect(metrics.perType.procedural).toBe(0);
      expect(metrics.confusionMatrix).toEqual([
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ]);
    });

    it('should calculate confusion matrix correctly', async () => {
      // Simple test: 2 episodic samples, both correctly classified
      const testSamples: LabeledSample[] = [
        {
          content: '昨日、会議でスプリントのゴールを決めた。',
          trueType: 'episodic',
        },
        {
          content: '先週、チームとミーティングして話し合った。',
          trueType: 'episodic',
        },
      ];

      const metrics = await classifier.evaluateAccuracy(testSamples);

      // Both should be correctly classified as episodic
      // confusionMatrix[0][0] = episodic → episodic (correct)
      expect(metrics.confusionMatrix[0][0]).toBe(2);

      // No misclassifications to semantic or procedural
      expect(metrics.confusionMatrix[0][1]).toBe(0); // episodic → semantic
      expect(metrics.confusionMatrix[0][2]).toBe(0); // episodic → procedural
    });

    it('should handle misclassifications in confusion matrix', async () => {
      // Test with potentially confusing samples
      const testSamples: LabeledSample[] = [
        {
          content: 'システムの仕様について話し合った。', // Could be episodic or semantic
          trueType: 'episodic',
        },
        {
          content: 'API仕様は標準的なパターンである。',
          trueType: 'semantic',
        },
      ];

      const metrics = await classifier.evaluateAccuracy(testSamples);

      // Confusion matrix should have some values
      const totalClassifications = metrics.confusionMatrix.flat().reduce((a, b) => a + b, 0);
      expect(totalClassifications).toBe(testSamples.length);
    });
  });

  describe('getClassificationStats', () => {
    it('should track total classifications', async () => {
      await classifier.classifyContent('昨日会議した。');
      await classifier.classifyContent('APIとは何か。');
      await classifier.classifyContent('手順を実行する。');

      const stats = await classifier.getClassificationStats();
      expect(stats.totalClassified).toBe(3);
    });

    it('should calculate average confidence', async () => {
      // Classify with high confidence
      await classifier.classifyContent('昨日、チームミーティングでスプリントのゴールを決めた。');
      // Classify with medium confidence
      await classifier.classifyContent('システムについて。');

      const stats = await classifier.getClassificationStats();
      expect(stats.averageConfidence).toBeGreaterThan(0);
      expect(stats.averageConfidence).toBeLessThanOrEqual(1);
    });

    it('should count low confidence classifications', async () => {
      // Low confidence samples
      await classifier.classifyContent('あ');
      await classifier.classifyContent('データ。');

      const stats = await classifier.getClassificationStats();
      expect(stats.lowConfidenceCount).toBeGreaterThan(0);
    });

    it('should return zero stats initially', async () => {
      const stats = await classifier.getClassificationStats();

      expect(stats.totalClassified).toBe(0);
      expect(stats.userOverrideRate).toBe(0);
      expect(stats.averageConfidence).toBe(0);
      expect(stats.lowConfidenceCount).toBe(0);
    });

    it('should report user override rate (placeholder)', async () => {
      await classifier.classifyContent('テストコンテンツ');

      const stats = await classifier.getClassificationStats();

      // Phase 4.2 では 0 (未実装)
      expect(stats.userOverrideRate).toBe(0);
    });
  });

  describe('Accuracy Target Validation', () => {
    it('should achieve >= 70% overall accuracy on well-balanced dataset', async () => {
      // Create a balanced dataset with clear examples
      const balancedDataset: LabeledSample[] = [
        // 10 episodic samples
        ...Array(10).fill(null).map((_, i) => ({
          content: `昨日、チームミーティングで話し合った件について${i + 1}。`,
          trueType: 'episodic' as MemoryType,
        })),

        // 10 semantic samples
        ...Array(10).fill(null).map((_, i) => ({
          content: `API仕様とは、リソースを操作する標準的なパターンである${i + 1}。`,
          trueType: 'semantic' as MemoryType,
        })),

        // 10 procedural samples
        ...Array(10).fill(null).map((_, i) => ({
          content: `この問題を解決する方法: 1. 確認する。2. 修正する。3. テストする${i + 1}。`,
          trueType: 'procedural' as MemoryType,
        })),
      ];

      const metrics = await classifier.evaluateAccuracy(balancedDataset);

      // Design.md target: Overall accuracy >= 70%
      expect(metrics.overall).toBeGreaterThanOrEqual(0.7);
    });

    it('should achieve >= 0.65 F1 score per type (requirement 3.4)', async () => {
      const testSamples: LabeledSample[] = [
        // Episodic samples
        {
          content: '昨日、スタンドアップミーティングでゴールを決めた。',
          trueType: 'episodic',
        },
        {
          content: '先週の金曜日に、チームで話し合った。',
          trueType: 'episodic',
        },

        // Semantic samples
        {
          content: 'TypeScriptとは、型定義を持つプログラミング言語である。',
          trueType: 'semantic',
        },
        {
          content: 'APIパターンは、アーキテクチャの標準的な仕様である。',
          trueType: 'semantic',
        },

        // Procedural samples
        {
          content: 'バグを修正する方法: 1. ログ確認。2. デバッグ。3. テスト実行。',
          trueType: 'procedural',
        },
        {
          content: 'この問題を解決するには、キャッシュをクリアし再起動する。',
          trueType: 'procedural',
        },
      ];

      const metrics = await classifier.evaluateAccuracy(testSamples);

      // Per-type accuracy should be at least 0.65 (design.md requirement 3.4)
      expect(metrics.perType.episodic).toBeGreaterThanOrEqual(0.65);
      expect(metrics.perType.semantic).toBeGreaterThanOrEqual(0.65);
      expect(metrics.perType.procedural).toBeGreaterThanOrEqual(0.65);
    });
  });

  describe('trainClassifier (placeholder)', () => {
    it('should accept training samples without errors', async () => {
      const trainingSamples = [
        {
          content: '昨日会議した。',
          trueType: 'episodic' as MemoryType,
          metadata: { source: 'user_feedback' },
        },
        {
          content: 'APIとは何か。',
          trueType: 'semantic' as MemoryType,
          metadata: { source: 'user_feedback' },
        },
      ];

      // Should not throw (Phase 4.2 implementation is placeholder)
      await expect(
        classifier.trainClassifier(trainingSamples)
      ).resolves.not.toThrow();
    });

    it('should log training sample count', async () => {
      const consoleSpy = vi.spyOn(console, 'log');

      await classifier.trainClassifier([
        {
          content: 'テスト',
          trueType: 'semantic',
        },
      ]);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Training with 1 samples')
      );

      consoleSpy.mockRestore();
    });
  });
});
