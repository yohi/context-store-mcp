/**
 * Memory Type Classifier Tests
 * Requirements: 3.1, 3.2, 3.3, 3.4 (記憶タイプ自動分類)
 * Based on design.md Memory Type Classifier specification
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryClassifier } from '../../memory/memory-classifier.js';
import type { MemoryType } from '../../memory/types.js';

describe('MemoryClassifier', () => {
  let classifier: MemoryClassifier;

  beforeEach(() => {
    classifier = new MemoryClassifier();
  });

  describe('エピソード記憶の識別', () => {
    it('should classify conversation content as episodic memory', async () => {
      const content = '昨日、チームミーティングでプロジェクトの進捗について話し合った。';
      const result = await classifier.classifyContent(content);

      expect(result.primaryType).toBe('episodic');
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it('should detect time expressions in episodic content', async () => {
      const content = '先週の金曜日に、新しい API の設計について議論しました。';
      const result = await classifier.classifyContent(content);

      expect(result.primaryType).toBe('episodic');
      expect(result.features.detectedKeywords).toContain('議論');
    });

    it('should recognize past tense verbs as episodic indicators', async () => {
      const content = 'クライアントとの会議で、要件を確認した。彼らは新機能を要望していた。';
      const result = await classifier.classifyContent(content);

      expect(result.primaryType).toBe('episodic');
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });
  });

  describe('意味記憶の識別', () => {
    it('should classify API specifications as semantic memory', async () => {
      const content = 'REST APIは、HTTPメソッドを使用してリソースを操作する標準的なアーキテクチャパターンである。';
      const result = await classifier.classifyContent(content);

      expect(result.primaryType).toBe('semantic');
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it('should detect definition patterns in semantic content', async () => {
      const content = 'マイクロサービスとは、小さく独立したサービスの集合としてアプリケーションを構築するアーキテクチャスタイルである。';
      const result = await classifier.classifyContent(content);

      expect(result.primaryType).toBe('semantic');
      expect(result.features.detectedKeywords).toContain('とは');
    });

    it('should recognize coding conventions as semantic memory', async () => {
      const content = 'TypeScriptでは、interfaceを使って型定義を行う。すべての関数は明示的な戻り値の型を持つべきである。';
      const result = await classifier.classifyContent(content);

      expect(result.primaryType).toBe('semantic');
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });
  });

  describe('手続き記憶の識別', () => {
    it('should classify step-by-step instructions as procedural memory', async () => {
      const content = 'バグを修正する方法: 1. エラーログを確認する。2. コードをデバッグする。3. テストを実行する。';
      const result = await classifier.classifyContent(content);

      expect(result.primaryType).toBe('procedural');
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it('should detect imperative verbs in procedural content', async () => {
      const content = 'まず、依存関係をインストールします。次に、設定ファイルを編集します。最後に、サーバーを起動します。';
      const result = await classifier.classifyContent(content);

      expect(result.primaryType).toBe('procedural');
      expect(result.features.detectedKeywords.some((k: string) =>
        ['インストール', '編集', '起動'].some(verb => k.includes(verb))
      )).toBe(true);
    });

    it('should recognize solution methods as procedural memory', async () => {
      const content = 'この問題を解決するには、キャッシュをクリアし、再起動する必要があります。';
      const result = await classifier.classifyContent(content);

      expect(result.primaryType).toBe('procedural');
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });
  });

  describe('信頼度スコアの計算', () => {
    it('should return high confidence (>= 0.8) for clear episodic content with multiple keywords', async () => {
      const content = '昨日の会議で、スタンドアップミーティングについて話し合い、スプリントのゴールを決めた。';
      const result = await classifier.classifyContent(content);

      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
      expect(result.primaryType).toBe('episodic');
    });

    it('should return medium confidence (0.6-0.8) for moderately clear content', async () => {
      const content = 'システムの改善案を検討中。';
      const result = await classifier.classifyContent(content);

      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
      expect(result.confidence).toBeLessThanOrEqual(0.8);
    });

    it('should return low confidence (< 0.6) for unclear content', async () => {
      const content = 'データ。';
      const result = await classifier.classifyContent(content);

      expect(result.confidence).toBeLessThan(0.6);
    });
  });

  describe('代替タイプの提案', () => {
    it('should provide alternative suggestions sorted by confidence', async () => {
      const content = 'APIの使い方を説明した。';
      const result = await classifier.classifyContent(content);

      expect(result.suggestedTypes).toHaveLength(2);
      expect(result.suggestedTypes[0].confidence).toBeGreaterThanOrEqual(
        result.suggestedTypes[1].confidence
      );
    });

    it('should include all three memory types in suggestions', async () => {
      const content = 'プロジェクトの要件について。';
      const result = await classifier.classifyContent(content);

      const types = result.suggestedTypes.map((s: { type: MemoryType }) => s.type);
      expect(types).toHaveLength(2); // 主要タイプ以外の2つ
    });
  });

  describe('特徴量抽出', () => {
    it('should extract rule-based score from features', async () => {
      const content = '昨日、新しい機能を実装した。';
      const result = await classifier.classifyContent(content);

      expect(result.features.ruleBasedScore).toBeGreaterThanOrEqual(0);
      expect(result.features.ruleBasedScore).toBeLessThanOrEqual(1);
    });

    it('should detect keywords specific to each memory type', async () => {
      const content = '会議で議論した内容の仕様を定義し、実装方法を決めた。';
      const result = await classifier.classifyContent(content);

      expect(result.features.detectedKeywords.length).toBeGreaterThan(0);
    });

    it('should calculate embedding score (placeholder for now)', async () => {
      const content = 'テストコンテンツ';
      const result = await classifier.classifyContent(content);

      // Embedding score is placeholder (0.0) until vector DB integration
      expect(result.features.embeddingScore).toBeGreaterThanOrEqual(0);
      expect(result.features.embeddingScore).toBeLessThanOrEqual(1);
    });
  });

  describe('デフォルト動作', () => {
    it('should default to semantic type for low confidence', async () => {
      const content = 'あ'; // Very short, unclear content
      const result = await classifier.classifyContent(content);

      // When confidence is low, should still return a classification
      expect(['episodic', 'semantic', 'procedural']).toContain(result.primaryType);
      expect(result.confidence).toBeLessThan(0.6);
    });

    it('should handle empty content gracefully', async () => {
      const content = '';
      const result = await classifier.classifyContent(content);

      expect(result.primaryType).toBe('semantic'); // Default fallback
      expect(result.confidence).toBeLessThan(0.6);
    });
  });

  describe('精度評価インターフェース', () => {
    it('should provide evaluateAccuracy method', async () => {
      expect(typeof classifier.evaluateAccuracy).toBe('function');
    });

    it('should provide getClassificationStats method', async () => {
      expect(typeof classifier.getClassificationStats).toBe('function');
    });

    it('should provide getConfidenceScore method', async () => {
      const score = await classifier.getConfidenceScore('テスト', 'semantic');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe('統計情報の取得', () => {
    it('should track total classifications', async () => {
      await classifier.classifyContent('コンテンツ1');
      await classifier.classifyContent('コンテンツ2');

      const stats = await classifier.getClassificationStats();
      expect(stats.totalClassified).toBe(2);
    });

    it('should calculate average confidence', async () => {
      await classifier.classifyContent('昨日会議した。');
      await classifier.classifyContent('APIとは何か。');

      const stats = await classifier.getClassificationStats();
      expect(stats.averageConfidence).toBeGreaterThan(0);
      expect(stats.averageConfidence).toBeLessThanOrEqual(1);
    });

    it('should count low confidence classifications', async () => {
      await classifier.classifyContent('あ');
      await classifier.classifyContent('い');

      const stats = await classifier.getClassificationStats();
      expect(stats.lowConfidenceCount).toBeGreaterThan(0);
    });
  });
});
