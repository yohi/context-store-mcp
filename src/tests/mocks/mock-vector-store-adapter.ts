/**
 * MockVectorStoreAdapter
 * VectorStoreAdapterのモック実装
 * テスト用途専用 - 実際の埋め込み生成なし
 */

import type { MemoryId } from '../../memory/types.js';

export interface VectorSearchResult {
    id: MemoryId;
    content: string;
    similarity: number;
    metadata: any;
    createdAt: Date;
    updatedAt: Date;
    lastAccessedAt?: Date;
    accessCount?: number;
    importanceScore?: number;
    version?: number;
}

export class MockVectorStoreAdapter {
    private vectors = new Map<MemoryId, { content: string; metadata: any; createdAt: Date }>();

    async addEmbeddingForMemory(id: MemoryId, content: string, metadata?: any): Promise<void> {
        this.vectors.set(id, {
            content,
            metadata: metadata || {},
            createdAt: new Date(),
        });
    }

    async searchSimilar(query: string, limit: number = 10): Promise<VectorSearchResult[]> {
        const results: VectorSearchResult[] = [];

        // 簡易的な類似性検索: クエリと共通の単語数でスコアリング
        for (const [id, vector] of Array.from(this.vectors.entries())) {
            const similarity = this.calculateSimpleSimilarity(query, vector.content);

            if (similarity > 0) {
                results.push({
                    id,
                    content: vector.content,
                    similarity,
                    metadata: vector.metadata,
                    createdAt: vector.createdAt,
                    updatedAt: vector.createdAt,
                    lastAccessedAt: new Date(),
                    accessCount: 0,
                    importanceScore: 0,
                    version: 1,
                });
            }
        }

        // 類似度でソート（降順）
        results.sort((a, b) => b.similarity - a.similarity);

        // 制限を適用
        return results.slice(0, limit);
    }

    async deleteVector(id: MemoryId): Promise<void> {
        this.vectors.delete(id);
    }

    /**
     * 簡易的な類似性計算
     * 実際の実装ではコサイン類似度を使用しますが、テストでは単語の重複で代用
     */
    private calculateSimpleSimilarity(query: string, content: string): number {
        const queryWords = new Set(query.toLowerCase().split(/\s+/));
        const contentWords = new Set(content.toLowerCase().split(/\s+/));

        let commonWords = 0;
        for (const word of Array.from(queryWords)) {
            if (contentWords.has(word)) {
                commonWords++;
            }
        }

        if (queryWords.size === 0) return 0;

        // Jaccard類似度の簡易版
        return commonWords / Math.max(queryWords.size, contentWords.size);
    }

    clear(): void {
        this.vectors.clear();
    }

    // テストヘルパー
    getVectorCount(): number {
        return this.vectors.size;
    }
}
