/**
 * UUID-based Edge ID Tests
 *
 * UUIDベースのエッジID生成とユニーク制約のテスト
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GraphStoreAdapter } from '../../storage/graph-store-adapter';
import { randomUUID } from 'crypto';

describe('UUID-based Edge IDs', () => {
  let adapter: GraphStoreAdapter;
  const testDbName = process.env.NEO4J_DATABASE || 'neo4j';

  beforeAll(async () => {
    adapter = new GraphStoreAdapter({
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USER || 'neo4j',
      password: process.env.NEO4J_PASSWORD || 'password',
      database: testDbName,
    });

    // 制約を初期化
    await adapter.initializeConstraints();
  });

  afterAll(async () => {
    await adapter.close();
  });

  beforeEach(async () => {
    // テスト用ノードをクリーンアップ
    // ※本来はbeforeEachで全削除するが、簡略化のためスキップ
  });

  describe('Edge ID generation', () => {
    it('エッジIDはUUID v4形式である', async () => {
      const node1Id = randomUUID();
      const node2Id = randomUUID();

      await adapter.createNode('Memory', { id: node1Id, name: 'Node 1' });
      await adapter.createNode('Memory', { id: node2Id, name: 'Node 2' });

      const edgeId = await adapter.createRelationship(node1Id, node2Id, 'REFERENCES');

      // UUID v4 の形式を検証
      const uuidV4Pattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(edgeId).toMatch(uuidV4Pattern);
    });

    it('同じノード間・同じタイプで複数のエッジを作成できる（マルチエッジ）', async () => {
      const node1Id = randomUUID();
      const node2Id = randomUUID();

      await adapter.createNode('Memory', { id: node1Id, name: 'Multi Node 1' });
      await adapter.createNode('Memory', { id: node2Id, name: 'Multi Node 2' });

      // 同じノード間・同じタイプで3つのエッジを作成
      const edge1Id = await adapter.createRelationship(node1Id, node2Id, 'REFERENCES', {
        context: 'first reference',
      });
      const edge2Id = await adapter.createRelationship(node1Id, node2Id, 'REFERENCES', {
        context: 'second reference',
      });
      const edge3Id = await adapter.createRelationship(node1Id, node2Id, 'REFERENCES', {
        context: 'third reference',
      });

      // すべてのエッジIDがユニークであることを確認
      expect(edge1Id).not.toBe(edge2Id);
      expect(edge2Id).not.toBe(edge3Id);
      expect(edge1Id).not.toBe(edge3Id);

      // すべてのエッジが取得できることを確認
      const relationships = await adapter.getNodeRelationships(node1Id, 'outgoing', 'REFERENCES');
      expect(relationships).toHaveLength(3);

      // 各エッジのコンテキストが異なることを確認
      const contexts = relationships.map((r) => r.properties?.context);
      expect(contexts).toContain('first reference');
      expect(contexts).toContain('second reference');
      expect(contexts).toContain('third reference');
    });

    it('エッジIDで個別のエッジを識別できる', async () => {
      const node1Id = randomUUID();
      const node2Id = randomUUID();

      await adapter.createNode('Memory', { id: node1Id, name: 'Identify Node 1' });
      await adapter.createNode('Memory', { id: node2Id, name: 'Identify Node 2' });

      const edge1Id = await adapter.createRelationship(node1Id, node2Id, 'SUPPORTS', {
        strength: 0.8,
      });
      const edge2Id = await adapter.createRelationship(node1Id, node2Id, 'SUPPORTS', {
        strength: 0.6,
      });

      // 各エッジを個別に取得
      const edge1 = await adapter.getRelationship(edge1Id);
      const edge2 = await adapter.getRelationship(edge2Id);

      expect(edge1).not.toBeNull();
      expect(edge2).not.toBeNull();
      expect(edge1?.id).toBe(edge1Id);
      expect(edge2?.id).toBe(edge2Id);
      expect(edge1?.properties?.strength).toBe(0.8);
      expect(edge2?.properties?.strength).toBe(0.6);
    });

    it('エッジIDで個別のエッジを削除できる', async () => {
      const node1Id = randomUUID();
      const node2Id = randomUUID();

      await adapter.createNode('Memory', { id: node1Id, name: 'Delete Node 1' });
      await adapter.createNode('Memory', { id: node2Id, name: 'Delete Node 2' });

      const edge1Id = await adapter.createRelationship(node1Id, node2Id, 'PREREQUISITE', {
        order: 1,
      });
      const edge2Id = await adapter.createRelationship(node1Id, node2Id, 'PREREQUISITE', {
        order: 2,
      });
      const edge3Id = await adapter.createRelationship(node1Id, node2Id, 'PREREQUISITE', {
        order: 3,
      });

      // 中間のエッジだけを削除
      const deleted = await adapter.deleteRelationship(edge2Id);
      expect(deleted).toBe(true);

      // edge1とedge3は残っている
      const edge1Check = await adapter.getRelationship(edge1Id);
      const edge3Check = await adapter.getRelationship(edge3Id);
      expect(edge1Check).not.toBeNull();
      expect(edge3Check).not.toBeNull();

      // edge2は削除されている
      const edge2Check = await adapter.getRelationship(edge2Id);
      expect(edge2Check).toBeNull();

      // 残りのエッジは2つ
      const relationships = await adapter.getNodeRelationships(node1Id, 'outgoing', 'PREREQUISITE');
      expect(relationships).toHaveLength(2);
    });
  });
});
