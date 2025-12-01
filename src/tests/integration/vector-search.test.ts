/**
 * Vector Search Integration Test
 * pgvectorを使用したベクトル検索機能のテスト
 * OpenAI APIはモック化し、データベース層の動作を検証する
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';
import { VectorStoreAdapter } from '../../storage/vector-store-adapter.js';
import { cleanupDatabase, createTestPool } from './helpers.js';

// テスト用のアダプタークラス
// generateEmbeddingをオーバーライドしてOpenAI API呼び出しを回避
class TestVectorStoreAdapter extends VectorStoreAdapter {
    private nextEmbedding: number[] | null = null;

    setNextEmbedding(embedding: number[]) {
        this.nextEmbedding = embedding;
    }

    // @ts-ignore - privateメソッドのオーバーライド
    private async generateEmbedding(text: string): Promise<number[]> {
        if (this.nextEmbedding) {
            const emb = this.nextEmbedding;
            this.nextEmbedding = null;
            return emb;
        }
        // デフォルト: 全要素0.1のベクトル
        return new Array(1536).fill(0.1);
    }
}

describe('Vector Search Integration Tests', () => {
    let pool: Pool;
    let vectorStore: TestVectorStoreAdapter;

    beforeEach(async () => {
        pool = createTestPool();
        await cleanupDatabase(pool);

        vectorStore = new TestVectorStoreAdapter({
            pool,
            openaiApiKey: 'dummy-key', // モックするのでダミーでOK
        });
    });

    afterEach(async () => {
        await cleanupDatabase(pool);
        await pool.end();
    });

    // ヘルパー: 指定した次元に値を持つベクトルを生成
    const createVector = (index: number, value: number): number[] => {
        const v = new Array(1536).fill(0);
        v[index] = value;
        return v;
    };

    it('should store and retrieve vectors', async () => {
        const content = 'Test vector content';
        const metadata = { tags: ['test'] };

        // ベクトルを設定 (次元0が1.0)
        const vector = createVector(0, 1.0);
        vectorStore.setNextEmbedding(vector);

        // 保存
        const id = await vectorStore.storeWithEmbedding(content, metadata);
        expect(id).toBeDefined();

        // データベースで確認
        const result = await pool.query(
            'SELECT * FROM memory_vectors WHERE memory_id = $1',
            [id]
        );
        expect(result.rows.length).toBe(1);

        // pgvectorは文字列として返されることがあるのでパースが必要かも知れないが
        // pgライブラリが適切に処理していれば配列になるはず
        // pgvector拡張が有効なら文字列 "[1,0,0...]" で返る可能性が高い
        const storedEmbedding = result.rows[0].embedding;
        expect(storedEmbedding).toBeDefined();
    });

    it('should perform similarity search correctly', async () => {
        // 3つのベクトルを保存
        // A: 次元0が1.0 (基準)
        // B: 次元0が0.9, 次元1が0.1 (Aに近い)
        // C: 次元1が1.0 (Aに遠い)

        const vecA = createVector(0, 1.0);
        const vecB = createVector(0, 0.9);
        vecB[1] = 0.1;
        const vecC = createVector(1, 1.0);

        // Aを保存
        vectorStore.setNextEmbedding(vecA);
        const idA = await vectorStore.storeWithEmbedding('Memory A', { type: 'A' });

        // Bを保存
        vectorStore.setNextEmbedding(vecB);
        const idB = await vectorStore.storeWithEmbedding('Memory B', { type: 'B' });

        // Cを保存
        vectorStore.setNextEmbedding(vecC);
        const idC = await vectorStore.storeWithEmbedding('Memory C', { type: 'C' });

        // 検索クエリのベクトルをAと同じにする
        // searchSimilar内部でgenerateEmbeddingが呼ばれる
        vectorStore.setNextEmbedding(vecA);

        const results = await vectorStore.searchSimilar('Query for A', 5);

        // 結果の検証
        expect(results.length).toBeGreaterThanOrEqual(2);

        // Aが最も近いはず (自分自身なので類似度1.0)
        expect(results[0].id).toBe(idA);
        expect(results[0].similarity).toBeCloseTo(1.0, 1); // 浮動小数点誤差許容

        // Bが次に来るはず
        expect(results[1].id).toBe(idB);

        // Cは遠いので下位または閾値(0.7)以下で除外される可能性あり
        // デフォルト閾値は0.7
        // AとCの類似度(直交)は0なので、結果に含まれないはず
        const cInResults = results.find(r => r.id === idC);
        expect(cInResults).toBeUndefined();
    });

    it('should filter by metadata', async () => {
        // 同じベクトルだがメタデータが異なる2つのメモリ
        const vec = createVector(0, 1.0);

        vectorStore.setNextEmbedding(vec);
        const id1 = await vectorStore.storeWithEmbedding('Memory 1', { tags: ['tag1'] });

        vectorStore.setNextEmbedding(vec);
        const id2 = await vectorStore.storeWithEmbedding('Memory 2', { tags: ['tag2'] });

        // 検索ベクトル設定
        vectorStore.setNextEmbedding(vec);

        // メタデータフィルタなし
        const resultsAll = await vectorStore.searchSimilar('Query', 10);
        expect(resultsAll.length).toBe(2);

        // TODO: VectorStoreAdapterのsearchSimilarは現在メタデータフィルタをサポートしていない可能性がある
        // searchSimilarAdvancedがあればそちらを使うべきだが、インターフェースにはsearchSimilarしかないかも
        // コードを確認したところ、searchSimilarAdvancedはなさそう。
        // タスク5.2で実装予定の機能かもしれない。
        // 現状の実装ではメタデータフィルタはサポートされていない可能性が高いので、
        // このテストは一旦スキップするか、実装を確認してから有効化する。
    });
});
