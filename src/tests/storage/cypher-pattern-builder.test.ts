/**
 * CypherPatternBuilder Test Suite
 *
 * Cypherインジェクション防止とパターンビルダーの動作を検証
 */

import { describe, it, expect } from 'vitest';
import { CypherPatternBuilder } from '../../storage/graph-store-adapter';

describe('CypherPatternBuilder', () => {
  describe('基本的なパターン構築', () => {
    it('リレーションシップタイプなしのパターンを構築できる', () => {
      const pattern = new CypherPatternBuilder().build();

      expect(pattern.pattern).toBe('-[*1..5]-(end)');
      expect(pattern.parameters).toEqual({});
    });

    it('outgoing方向のリレーションシップパターンを構築できる', () => {
      const pattern = new CypherPatternBuilder().relationship('REFERENCES', 'outgoing').build();

      expect(pattern.pattern).toBe('-[:REFERENCES*1..5]->(end)');
      expect(pattern.parameters).toEqual({});
    });

    it('incoming方向のリレーションシップパターンを構築できる', () => {
      const pattern = new CypherPatternBuilder().relationship('DERIVED_FROM', 'incoming').build();

      expect(pattern.pattern).toBe('<-[:DERIVED_FROM*1..5]-(end)');
      expect(pattern.parameters).toEqual({});
    });

    it('both方向のリレーションシップパターンを構築できる', () => {
      const pattern = new CypherPatternBuilder().relationship('SUPPORTS', 'both').build();

      expect(pattern.pattern).toBe('-[:SUPPORTS*1..5]-(end)');
      expect(pattern.parameters).toEqual({});
    });

    it('デフォルトの方向はbothである', () => {
      const pattern = new CypherPatternBuilder().relationship('REFERENCES').build();

      expect(pattern.pattern).toBe('-[:REFERENCES*1..5]-(end)');
    });
  });

  describe('ノードラベルの設定', () => {
    it('単一のノードラベルを設定できる', () => {
      const pattern = new CypherPatternBuilder().nodeLabel('Memory').build();

      expect(pattern.pattern).toBe('-[*1..5]-(end:Memory)');
      expect(pattern.parameters).toEqual({});
    });

    it('複数のノードラベルを設定できる', () => {
      const pattern = new CypherPatternBuilder()
        .nodeLabel('Memory')
        .nodeLabel('Episodic')
        .build();

      expect(pattern.pattern).toBe('-[*1..5]-(end:Memory:Episodic)');
      expect(pattern.parameters).toEqual({});
    });

    it('リレーションシップとノードラベルを組み合わせて設定できる', () => {
      const pattern = new CypherPatternBuilder()
        .relationship('REFERENCES', 'outgoing')
        .nodeLabel('Memory')
        .build();

      expect(pattern.pattern).toBe('-[:REFERENCES*1..5]->(end:Memory)');
      expect(pattern.parameters).toEqual({});
    });
  });

  describe('WHERE条件の設定', () => {
    it('単一のWHERE条件を設定できる', () => {
      const pattern = new CypherPatternBuilder().where({ type: 'semantic' }).build();

      expect(pattern.pattern).toBe('-[*1..5]-(end)');
      expect(pattern.parameters).toEqual({ type: 'semantic' });
    });

    it('複数のWHERE条件を設定できる', () => {
      const pattern = new CypherPatternBuilder()
        .where({ type: 'semantic', category: 'knowledge' })
        .build();

      expect(pattern.pattern).toBe('-[*1..5]-(end)');
      expect(pattern.parameters).toEqual({
        type: 'semantic',
        category: 'knowledge',
      });
    });

    it('複数回where()を呼び出して条件を追加できる', () => {
      const pattern = new CypherPatternBuilder()
        .where({ type: 'semantic' })
        .where({ category: 'knowledge' })
        .build();

      expect(pattern.pattern).toBe('-[*1..5]-(end)');
      expect(pattern.parameters).toEqual({
        type: 'semantic',
        category: 'knowledge',
      });
    });
  });

  describe('探索深度の設定', () => {
    it('最大探索深度を設定できる', () => {
      const pattern = new CypherPatternBuilder().maxDepth(3).build();

      expect(pattern.pattern).toBe('-[*1..3]-(end)');
    });

    it('最小探索深度を設定できる', () => {
      const pattern = new CypherPatternBuilder().minDepth(2).build();

      expect(pattern.pattern).toBe('-[*2..5]-(end)');
    });

    it('最小と最大の探索深度を両方設定できる', () => {
      const pattern = new CypherPatternBuilder().minDepth(2).maxDepth(8).build();

      expect(pattern.pattern).toBe('-[*2..8]-(end)');
    });

    it('最大深度は1から15の範囲である必要がある', () => {
      expect(() => new CypherPatternBuilder().maxDepth(0).build()).toThrow(
        'maxDepth must be an integer between 1 and 15'
      );

      expect(() => new CypherPatternBuilder().maxDepth(16).build()).toThrow(
        'maxDepth must be an integer between 1 and 15'
      );

      expect(() => new CypherPatternBuilder().maxDepth(1.5).build()).toThrow(
        'maxDepth must be an integer between 1 and 15'
      );
    });

    it('最小深度は1から15の範囲である必要がある', () => {
      expect(() => new CypherPatternBuilder().minDepth(0).build()).toThrow(
        'minDepth must be an integer between 1 and 15'
      );

      expect(() => new CypherPatternBuilder().minDepth(16).build()).toThrow(
        'minDepth must be an integer between 1 and 15'
      );

      expect(() => new CypherPatternBuilder().minDepth(2.5).build()).toThrow(
        'minDepth must be an integer between 1 and 15'
      );
    });

    it('minDepthがmaxDepthより大きい場合はエラーをスローする', () => {
      expect(() => new CypherPatternBuilder().minDepth(10).maxDepth(5).build()).toThrow(
        'minDepthValue (10) cannot be greater than maxDepthValue (5)'
      );

      expect(() => new CypherPatternBuilder().minDepth(8).maxDepth(3).build()).toThrow(
        'minDepthValue (8) cannot be greater than maxDepthValue (3)'
      );
    });

    it('minDepthとmaxDepthが同じ値の場合は許容される', () => {
      const pattern = new CypherPatternBuilder().minDepth(3).maxDepth(3).build();

      expect(pattern.pattern).toBe('-[*3..3]-(end)');
    });
  });

  describe('複合パターンの構築', () => {
    it('すべての設定を組み合わせた複雑なパターンを構築できる', () => {
      const pattern = new CypherPatternBuilder()
        .relationship('REFERENCES', 'outgoing')
        .nodeLabel('Memory')
        .nodeLabel('Semantic')
        .where({ type: 'concept', importance: 'high' })
        .minDepth(2)
        .maxDepth(4)
        .build();

      expect(pattern.pattern).toBe('-[:REFERENCES*2..4]->(end:Memory:Semantic)');
      expect(pattern.parameters).toEqual({
        type: 'concept',
        importance: 'high',
      });
    });

    it('ノードにendエイリアスが付与される', () => {
      const pattern = new CypherPatternBuilder().build();

      expect(pattern.pattern).toContain('(end)');
    });

    it('ラベル付きノードにもendエイリアスが付与される', () => {
      const pattern = new CypherPatternBuilder().nodeLabel('Memory').build();

      expect(pattern.pattern).toContain('(end:Memory)');
    });
  });

  describe('メソッドチェーンのサポート', () => {
    it('すべてのメソッドがthisを返し、チェーン可能である', () => {
      const builder = new CypherPatternBuilder();

      expect(builder.relationship('REFERENCES')).toBe(builder);
      expect(builder.nodeLabel('Memory')).toBe(builder);
      expect(builder.where({ type: 'semantic' })).toBe(builder);
      expect(builder.maxDepth(3)).toBe(builder);
      expect(builder.minDepth(1)).toBe(builder);
    });
  });

  describe('セキュリティ: Cypherインジェクション防止', () => {
    describe('リレーションシップタイプのバリデーション', () => {
      it('有効なリレーションシップタイプを受け入れる', () => {
        expect(() =>
          new CypherPatternBuilder().relationship('VALID_TYPE').build()
        ).not.toThrow();

        expect(() => new CypherPatternBuilder().relationship('ValidType123').build()).not.toThrow();

        expect(() => new CypherPatternBuilder().relationship('_ValidType').build()).not.toThrow();
      });

      it('セミコロンを含むリレーションシップタイプを拒否する', () => {
        expect(() =>
          new CypherPatternBuilder().relationship('REFERENCES; DROP TABLE users--').build()
        ).toThrow('Invalid relationship type');
      });

      it('特殊文字を含むリレーションシップタイプを拒否する', () => {
        expect(() =>
          new CypherPatternBuilder().relationship('REFERENCES-MALICIOUS').build()
        ).toThrow('Invalid relationship type');

        expect(() => new CypherPatternBuilder().relationship('REFERENCES.BAD').build()).toThrow(
          'Invalid relationship type'
        );

        expect(() => new CypherPatternBuilder().relationship('REFERENCES$BAD').build()).toThrow(
          'Invalid relationship type'
        );
      });

      it('Cypherキーワードを含むタイプを拒否する', () => {
        expect(() => new CypherPatternBuilder().relationship('MATCH').build()).not.toThrow(); // MATCH自体は有効な識別子

        // ただし、注意すべきパターンは拒否される
        expect(() =>
          new CypherPatternBuilder().relationship('MATCH (n) RETURN n').build()
        ).toThrow('Invalid relationship type');
      });

      it('数字で始まるタイプを拒否する', () => {
        expect(() => new CypherPatternBuilder().relationship('123REFERENCES').build()).toThrow(
          'Invalid relationship type'
        );
      });

      it('空文字列を拒否する', () => {
        expect(() => new CypherPatternBuilder().relationship('').build()).toThrow(
          'Invalid relationship type'
        );
      });
    });

    describe('ノードラベルのバリデーション', () => {
      it('有効なノードラベルを受け入れる', () => {
        expect(() => new CypherPatternBuilder().nodeLabel('Memory').build()).not.toThrow();

        expect(() => new CypherPatternBuilder().nodeLabel('Memory123').build()).not.toThrow();

        expect(() => new CypherPatternBuilder().nodeLabel('_Memory').build()).not.toThrow();
      });

      it('セミコロンを含むノードラベルを拒否する', () => {
        expect(() =>
          new CypherPatternBuilder().nodeLabel('Memory; DROP TABLE users--').build()
        ).toThrow('Invalid node label');
      });

      it('特殊文字を含むノードラベルを拒否する', () => {
        expect(() => new CypherPatternBuilder().nodeLabel('Memory-Bad').build()).toThrow(
          'Invalid node label'
        );

        expect(() => new CypherPatternBuilder().nodeLabel('Memory.Bad').build()).toThrow(
          'Invalid node label'
        );

        expect(() => new CypherPatternBuilder().nodeLabel('Memory$Bad').build()).toThrow(
          'Invalid node label'
        );
      });

      it('数字で始まるラベルを拒否する', () => {
        expect(() => new CypherPatternBuilder().nodeLabel('123Memory').build()).toThrow(
          'Invalid node label'
        );
      });

      it('空文字列を拒否する', () => {
        expect(() => new CypherPatternBuilder().nodeLabel('').build()).toThrow('Invalid node label');
      });
    });

    describe('プロパティ名のバリデーション', () => {
      it('有効なプロパティ名を受け入れる', () => {
        expect(() => new CypherPatternBuilder().where({ validName: 'value' }).build()).not.toThrow();

        expect(() =>
          new CypherPatternBuilder().where({ validName123: 'value' }).build()
        ).not.toThrow();

        expect(() => new CypherPatternBuilder().where({ _validName: 'value' }).build()).not.toThrow();
      });

      it('セミコロンを含むプロパティ名を拒否する', () => {
        expect(() =>
          new CypherPatternBuilder().where({ 'name; DROP TABLE users--': 'value' }).build()
        ).toThrow('Invalid property name in WHERE clause');
      });

      it('特殊文字を含むプロパティ名を拒否する', () => {
        expect(() => new CypherPatternBuilder().where({ 'name-bad': 'value' }).build()).toThrow(
          'Invalid property name in WHERE clause'
        );

        expect(() => new CypherPatternBuilder().where({ 'name.bad': 'value' }).build()).toThrow(
          'Invalid property name in WHERE clause'
        );

        expect(() => new CypherPatternBuilder().where({ 'name$bad': 'value' }).build()).toThrow(
          'Invalid property name in WHERE clause'
        );
      });

      it('数字で始まるプロパティ名を拒否する', () => {
        expect(() => new CypherPatternBuilder().where({ '123name': 'value' }).build()).toThrow(
          'Invalid property name in WHERE clause'
        );
      });

      it('空文字列のプロパティ名を拒否する', () => {
        expect(() => new CypherPatternBuilder().where({ '': 'value' }).build()).toThrow(
          'Invalid property name in WHERE clause'
        );
      });
    });

    describe('インジェクション攻撃パターンの防止', () => {
      it('SQLインジェクションスタイルの攻撃を防ぐ', () => {
        expect(() =>
          new CypherPatternBuilder()
            .relationship("REFERENCES'; DROP TABLE memories; --")
            .build()
        ).toThrow();
      });

      it('MATCH句の注入を防ぐ', () => {
        expect(() =>
          new CypherPatternBuilder().nodeLabel('Memory) MATCH (n) DELETE n //')
        ).toThrow();
      });

      it('RETURN句の注入を防ぐ', () => {
        expect(() =>
          new CypherPatternBuilder().relationship('REFERENCES) RETURN * //')
        ).toThrow();
      });

      it('DELETE句の注入を防ぐ', () => {
        expect(() =>
          new CypherPatternBuilder().where({ 'type) DELETE (n': 'value' }).build()
        ).toThrow();
      });

      it('CREATE句の注入を防ぐ', () => {
        expect(() =>
          new CypherPatternBuilder().nodeLabel('Memory) CREATE (evil:Backdoor) //')
        ).toThrow();
      });
    });
  });

  describe('パラメータ化されたクエリの生成', () => {
    it('WHERE条件がパラメータとして返される', () => {
      const pattern = new CypherPatternBuilder()
        .where({ type: 'semantic', importance: 'high' })
        .build();

      expect(pattern.parameters).toEqual({
        type: 'semantic',
        importance: 'high',
      });
    });

    it('プロパティ値にSQL/Cypherインジェクションが含まれていても安全', () => {
      // プロパティ値はバリデーションされない (パラメータ化されるため安全)
      const pattern = new CypherPatternBuilder()
        .where({ type: "'; DROP TABLE users; --" })
        .build();

      expect(pattern.parameters).toEqual({
        type: "'; DROP TABLE users; --",
      });
    });
  });
});
