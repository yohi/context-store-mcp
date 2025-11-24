import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryClassifier } from '../../memory/memory-classifier.js';
import type { MemoryType } from '../../memory/types.js';

describe('MemoryClassifier Training', () => {
  let classifier: MemoryClassifier;

  beforeEach(() => {
    classifier = new MemoryClassifier();
  });

  it('should improve classification accuracy after training', async () => {
    // 未知の単語を含むサンプル
    const unknownContent = 'このガジェットのフラボズルを調整した。';
    
    // 学習前は信頼度が低いはず
    const beforeResult = await classifier.classifyContent(unknownContent);
    
    // 学習データを準備
    // "フラボズル" と "調整" を手続き記憶（procedural）として学習させる
    const samples = [
      { content: 'フラボズルを起動する。', trueType: 'procedural' as MemoryType },
      { content: 'フラボズルを確認してください。', trueType: 'procedural' as MemoryType },
      { content: 'フラボズルの設定を変更します。', trueType: 'procedural' as MemoryType },
      { content: 'システムを調整する。', trueType: 'procedural' as MemoryType },
    ];

    // 学習実行
    await classifier.trainClassifier(samples);

    // 学習後は信頼度が上がるはず
    const afterResult = await classifier.classifyContent(unknownContent);
    
    // 学習前よりスコアが向上していることを確認
    // もしくは、少なくとも 'procedural' として分類されることを確認
    expect(afterResult.primaryType).toBe('procedural');
    
    // もし学習前が既に procedural だったとしても、スコアや検出キーワードが増えているはず
    if (beforeResult.primaryType === 'procedural') {
      // キーワード検出数が増えているか、スコアが上がっているか
      // Note: extractFeaturesの実装依存だが、学習によってキーワードリストが更新されれば検出されるはず
      const beforeKeywords = beforeResult.features.detectedKeywords.length;
      const afterKeywords = afterResult.features.detectedKeywords.length;
      expect(afterKeywords).toBeGreaterThan(beforeKeywords);
    } else {
      // 以前は procedural でなかったなら、正しく分類されるようになった
      expect(afterResult.primaryType).toBe('procedural');
    }
  });

  it('should extract new keywords from training samples', async () => {
    const samples = [
      { content: 'ユニークな単語Xを使用する。', trueType: 'procedural' as MemoryType },
      { content: 'ユニークな単語Xを設定する。', trueType: 'procedural' as MemoryType },
      { content: 'ユニークな単語X。', trueType: 'procedural' as MemoryType },
    ];

    await classifier.trainClassifier(samples);

    const result = await classifier.classifyContent('ユニークな単語Xをテストする。');
    // Tokenizer splits "ユニークな単語X" into "ユニーク", "な", "単語", "X"
    // "ユニーク" and "単語" should be learned as keywords (>1 char)
    expect(result.features.detectedKeywords).toContain('ユニーク');
    expect(result.features.detectedKeywords).toContain('単語');
  });
});
