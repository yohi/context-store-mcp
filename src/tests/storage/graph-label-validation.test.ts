/**
 * Graph Label Validation Tests
 *
 * Cypherインジェクション防止のためのラベルバリデーションテスト
 * - ホワイトリスト方式によるラベル検証
 * - 無効なラベルの拒否
 * - エラーメッセージの明確性
 */

import { describe, it, expect } from 'vitest';

// formatLabelsメソッドのテスト用に、検証ロジックを抽出してテスト
describe('Graph Label Validation (Cypher Injection Prevention)', () => {
  /**
   * ラベル名が安全かどうかを検証
   * Cypherインジェクション防止のため、ホワイトリスト方式で検証
   * 有効なラベル: 英数字とアンダースコア、先頭は英字またはアンダースコア
   */
  const isValidLabel = (label: string): boolean => {
    // Cypher仕様に準拠: 先頭は英字またはアンダースコア、2文字目以降は英数字またはアンダースコア
    const SAFE_LABEL_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
    return SAFE_LABEL_PATTERN.test(label);
  };

  /**
   * ノードラベルをCypherクエリ用の文字列に変換
   * Cypherインジェクション防止のため、ラベルを検証してから変換
   */
  const formatLabels = (label: string | string[]): string => {
    const labels = Array.isArray(label) ? label : [label];

    // すべてのラベルを検証
    for (const l of labels) {
      if (!isValidLabel(l)) {
        throw new Error(
          `Invalid label: "${l}". Labels must start with a letter or underscore, ` +
            `and contain only letters, numbers, and underscores.`
        );
      }
    }

    // 検証済みのラベルを安全に結合
    return labels.map((l) => `:${l}`).join('');
  };

  describe('有効なラベル', () => {
    it('英字で始まるラベルを受け入れる', () => {
      expect(isValidLabel('ValidLabel')).toBe(true);
      expect(formatLabels('ValidLabel')).toBe(':ValidLabel');
    });

    it('アンダースコアで始まるラベルを受け入れる', () => {
      expect(isValidLabel('_ValidLabel')).toBe(true);
      expect(formatLabels('_ValidLabel')).toBe(':_ValidLabel');
    });

    it('英数字とアンダースコアを含むラベルを受け入れる', () => {
      expect(isValidLabel('Valid_Label_123')).toBe(true);
      expect(formatLabels('Valid_Label_123')).toBe(':Valid_Label_123');
    });

    it('複数の有効なラベルを受け入れる', () => {
      expect(formatLabels(['Memory', 'Episodic'])).toBe(':Memory:Episodic');
      expect(formatLabels(['Memory', 'Episodic_2023'])).toBe(':Memory:Episodic_2023');
    });

    it('大文字小文字混在のラベルを受け入れる', () => {
      expect(isValidLabel('CamelCaseLabel')).toBe(true);
      expect(formatLabels('CamelCaseLabel')).toBe(':CamelCaseLabel');
    });

    it('単一文字のラベルを受け入れる', () => {
      expect(isValidLabel('A')).toBe(true);
      expect(formatLabels('A')).toBe(':A');
    });

    it('アンダースコアのみのラベルを受け入れる', () => {
      expect(isValidLabel('_')).toBe(true);
      expect(formatLabels('_')).toBe(':_');
    });

    it('長いラベル名を受け入れる', () => {
      const longLabel = 'VeryLongLabelNameWithManyCharacters_123_Test';
      expect(isValidLabel(longLabel)).toBe(true);
      expect(formatLabels(longLabel)).toBe(`:${longLabel}`);
    });
  });

  describe('無効なラベル（Cypherインジェクション対策）', () => {
    it('数字で始まるラベルを拒否する', () => {
      expect(isValidLabel('123Invalid')).toBe(false);
      expect(() => formatLabels('123Invalid')).toThrow(/Invalid label.*123Invalid/);
    });

    it('ハイフンを含むラベルを拒否する', () => {
      expect(isValidLabel('Invalid-Label')).toBe(false);
      expect(() => formatLabels('Invalid-Label')).toThrow(/Invalid label.*Invalid-Label/);
    });

    it('スペースを含むラベルを拒否する', () => {
      expect(isValidLabel('Invalid Label')).toBe(false);
      expect(() => formatLabels('Invalid Label')).toThrow(/Invalid label.*Invalid Label/);
    });

    it('セミコロンを含むラベルを拒否する（SQLインジェクション風）', () => {
      expect(isValidLabel('Label;DROP TABLE')).toBe(false);
      expect(() => formatLabels('Label;DROP TABLE')).toThrow(/Invalid label/);
    });

    it('引用符を含むラベルを拒否する', () => {
      expect(isValidLabel("Label'OR'1'='1")).toBe(false);
      expect(() => formatLabels("Label'OR'1'='1")).toThrow(/Invalid label/);
    });

    it('二重引用符を含むラベルを拒否する', () => {
      expect(isValidLabel('Label"malicious"')).toBe(false);
      expect(() => formatLabels('Label"malicious"')).toThrow(/Invalid label/);
    });

    it('バッククォートを含むラベルを拒否する', () => {
      expect(isValidLabel('Label`malicious`')).toBe(false);
      expect(() => formatLabels('Label`malicious`')).toThrow(/Invalid label/);
    });

    it('コロンを含むラベルを拒否する', () => {
      expect(isValidLabel('Label:Injection')).toBe(false);
      expect(() => formatLabels('Label:Injection')).toThrow(/Invalid label/);
    });

    it('カンマを含むラベルを拒否する', () => {
      expect(isValidLabel('Label,Another')).toBe(false);
      expect(() => formatLabels('Label,Another')).toThrow(/Invalid label/);
    });

    it('括弧を含むラベルを拒否する', () => {
      expect(isValidLabel('Label()')).toBe(false);
      expect(() => formatLabels('Label()')).toThrow(/Invalid label/);
    });

    it('波括弧を含むラベルを拒否する', () => {
      expect(isValidLabel('Label{}')).toBe(false);
      expect(() => formatLabels('Label{}')).toThrow(/Invalid label/);
    });

    it('角括弧を含むラベルを拒否する', () => {
      expect(isValidLabel('Label[]')).toBe(false);
      expect(() => formatLabels('Label[]')).toThrow(/Invalid label/);
    });

    it('ドットを含むラベルを拒否する', () => {
      expect(isValidLabel('Label.Property')).toBe(false);
      expect(() => formatLabels('Label.Property')).toThrow(/Invalid label/);
    });

    it('スラッシュを含むラベルを拒否する', () => {
      expect(isValidLabel('Label/Path')).toBe(false);
      expect(() => formatLabels('Label/Path')).toThrow(/Invalid label/);
    });

    it('バックスラッシュを含むラベルを拒否する', () => {
      expect(isValidLabel('Label\\Escape')).toBe(false);
      expect(() => formatLabels('Label\\Escape')).toThrow(/Invalid label/);
    });

    it('アットマークを含むラベルを拒否する', () => {
      expect(isValidLabel('Label@Symbol')).toBe(false);
      expect(() => formatLabels('Label@Symbol')).toThrow(/Invalid label/);
    });

    it('ドルマークを含むラベルを拒否する', () => {
      expect(isValidLabel('Label$Param')).toBe(false);
      expect(() => formatLabels('Label$Param')).toThrow(/Invalid label/);
    });

    it('パーセント記号を含むラベルを拒否する', () => {
      expect(isValidLabel('Label%Wildcard')).toBe(false);
      expect(() => formatLabels('Label%Wildcard')).toThrow(/Invalid label/);
    });

    it('アンパサンドを含むラベルを拒否する', () => {
      expect(isValidLabel('Label&Operator')).toBe(false);
      expect(() => formatLabels('Label&Operator')).toThrow(/Invalid label/);
    });

    it('等号を含むラベルを拒否する', () => {
      expect(isValidLabel('Label=Value')).toBe(false);
      expect(() => formatLabels('Label=Value')).toThrow(/Invalid label/);
    });

    it('空文字列ラベルを拒否する', () => {
      expect(isValidLabel('')).toBe(false);
      expect(() => formatLabels('')).toThrow(/Invalid label/);
    });

    it('複数ラベルに1つでも無効なものがあれば拒否する', () => {
      expect(() => formatLabels(['ValidLabel', 'Invalid-Label'])).toThrow(
        /Invalid label.*Invalid-Label/
      );
    });

    it('Cypherコマンドを含むラベルを拒否する', () => {
      expect(isValidLabel('Label MATCH (n) DELETE n')).toBe(false);
      expect(() => formatLabels('Label MATCH (n) DELETE n')).toThrow(/Invalid label/);
    });

    it('改行文字を含むラベルを拒否する', () => {
      expect(isValidLabel('Label\nMATCH')).toBe(false);
      expect(() => formatLabels('Label\nMATCH')).toThrow(/Invalid label/);
    });

    it('タブ文字を含むラベルを拒否する', () => {
      expect(isValidLabel('Label\tInjection')).toBe(false);
      expect(() => formatLabels('Label\tInjection')).toThrow(/Invalid label/);
    });

    it('キャリッジリターンを含むラベルを拒否する', () => {
      expect(isValidLabel('Label\rReturn')).toBe(false);
      expect(() => formatLabels('Label\rReturn')).toThrow(/Invalid label/);
    });

    it('ヌル文字を含むラベルを拒否する', () => {
      expect(isValidLabel('Label\0Null')).toBe(false);
      expect(() => formatLabels('Label\0Null')).toThrow(/Invalid label/);
    });
  });

  describe('Cypherインジェクション攻撃パターン', () => {
    it('MATCH文を含むラベルを拒否する', () => {
      expect(() => formatLabels('MATCH(n)')).toThrow(/Invalid label/);
    });

    it('CREATE文を含むラベルを拒否する', () => {
      expect(() => formatLabels('CREATE(n)')).toThrow(/Invalid label/);
    });

    it('DELETE文を含むラベルを拒否する', () => {
      expect(() => formatLabels('DELETE n')).toThrow(/Invalid label/);
    });

    it('WHERE句を含むラベルを拒否する', () => {
      expect(() => formatLabels('WHERE 1=1')).toThrow(/Invalid label/);
    });

    it('RETURN文を含むラベルを拒否する', () => {
      expect(() => formatLabels('RETURN *')).toThrow(/Invalid label/);
    });

    it('コメントを含むラベルを拒否する', () => {
      expect(() => formatLabels('Label//comment')).toThrow(/Invalid label/);
    });
  });

  describe('エラーメッセージの明確性', () => {
    it('無効なラベルに対して明確なエラーメッセージを返す', () => {
      try {
        formatLabels('123Invalid');
        expect.fail('Should have thrown an error');
      } catch (error) {
        const err = error as Error;
        expect(err.message).toContain('Invalid label');
        expect(err.message).toContain('123Invalid');
        expect(err.message).toContain('must start with a letter or underscore');
        expect(err.message).toContain('contain only letters, numbers, and underscores');
      }
    });

    it('特殊文字を含むラベルに対して明確なエラーメッセージを返す', () => {
      try {
        formatLabels('Label;DROP');
        expect.fail('Should have thrown an error');
      } catch (error) {
        const err = error as Error;
        expect(err.message).toContain('Invalid label');
        expect(err.message).toContain('Label;DROP');
      }
    });
  });

  describe('複数ラベルの処理', () => {
    it('すべて有効なラベルの配列を正しくフォーマットする', () => {
      expect(formatLabels(['Memory', 'Episodic', 'Important'])).toBe(
        ':Memory:Episodic:Important'
      );
    });

    it('最初のラベルが無効な場合にエラーをスローする', () => {
      expect(() => formatLabels(['123Invalid', 'Valid'])).toThrow(/Invalid label.*123Invalid/);
    });

    it('中間のラベルが無効な場合にエラーをスローする', () => {
      expect(() => formatLabels(['Valid', 'Invalid-Label', 'AlsoValid'])).toThrow(
        /Invalid label.*Invalid-Label/
      );
    });

    it('最後のラベルが無効な場合にエラーをスローする', () => {
      expect(() => formatLabels(['Valid', 'Invalid Label'])).toThrow(
        /Invalid label.*Invalid Label/
      );
    });
  });
});
