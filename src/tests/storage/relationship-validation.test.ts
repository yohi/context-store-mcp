/**
 * Relationship Validation Tests
 *
 * リレーションシップ作成時のバリデーションとセキュリティテスト
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GraphStoreAdapter } from '../../storage/graph-store-adapter';
import { randomUUID } from 'crypto';

describe('Relationship Validation and Security', () => {
  let adapter: GraphStoreAdapter;
  const testDbName = process.env.NEO4J_DATABASE || 'neo4j';

  beforeAll(async () => {
    adapter = new GraphStoreAdapter({
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USER || 'neo4j',
      password: process.env.NEO4J_PASSWORD || 'password',
      database: testDbName,
    });
  });

  afterAll(async () => {
    await adapter.close();
  });

  describe('Relationship type validation', () => {
    let validNodeId: string;

    beforeEach(async () => {
      // テスト用の有効なノードを作成
      validNodeId = randomUUID();
      await adapter.createNode('Memory', { id: validNodeId, name: 'Test Node' });
    });

    it('有効なリレーションシップタイプ（大文字）を受け付ける', async () => {
      const node2Id = randomUUID();
      await adapter.createNode('Memory', { id: node2Id, name: 'Node 2' });

      // 大文字のタイプは成功する
      await expect(
        adapter.createRelationship(validNodeId, node2Id, 'REFERENCES')
      ).resolves.toBeDefined();
    });

    it('有効なリレーションシップタイプ（アンダースコア付き）を受け付ける', async () => {
      const node2Id = randomUUID();
      await adapter.createNode('Memory', { id: node2Id, name: 'Node 2' });

      await expect(
        adapter.createRelationship(validNodeId, node2Id, 'DERIVED_FROM')
      ).resolves.toBeDefined();
    });

    it('有効なリレーションシップタイプ（数字を含む）を受け付ける', async () => {
      const node2Id = randomUUID();
      await adapter.createNode('Memory', { id: node2Id, name: 'Node 2' });

      await expect(
        adapter.createRelationship(validNodeId, node2Id, 'VERSION_2_COMPATIBLE')
      ).resolves.toBeDefined();
    });

    it('小文字のタイプを拒否する', async () => {
      const node2Id = randomUUID();
      await adapter.createNode('Memory', { id: node2Id, name: 'Node 2' });

      await expect(adapter.createRelationship(validNodeId, node2Id, 'references')).rejects.toThrow(
        /Invalid relationship type/
      );
    });

    it('ハイフンを含むタイプを拒否する', async () => {
      const node2Id = randomUUID();
      await adapter.createNode('Memory', { id: node2Id, name: 'Node 2' });

      await expect(
        adapter.createRelationship(validNodeId, node2Id, 'DERIVED-FROM')
      ).rejects.toThrow(/Invalid relationship type/);
    });

    it('スペースを含むタイプを拒否する', async () => {
      const node2Id = randomUUID();
      await adapter.createNode('Memory', { id: node2Id, name: 'Node 2' });

      await expect(
        adapter.createRelationship(validNodeId, node2Id, 'DERIVED FROM')
      ).rejects.toThrow(/Invalid relationship type/);
    });

    it('特殊文字を含むタイプを拒否する（SQLインジェクション対策）', async () => {
      const node2Id = randomUUID();
      await adapter.createNode('Memory', { id: node2Id, name: 'Node 2' });

      const maliciousTypes = [
        "REFS'; DROP TABLE memories; --",
        'REFS`; DELETE FROM memories; --',
        'REFS" OR 1=1; --',
        'REFS${DROP}',
        'REFS<script>alert(1)</script>',
      ];

      for (const maliciousType of maliciousTypes) {
        await expect(
          adapter.createRelationship(validNodeId, node2Id, maliciousType)
        ).rejects.toThrow(/Invalid relationship type/);
      }
    });

    it('空のタイプを拒否する', async () => {
      const node2Id = randomUUID();
      await adapter.createNode('Memory', { id: node2Id, name: 'Node 2' });

      await expect(adapter.createRelationship(validNodeId, node2Id, '')).rejects.toThrow(
        /cannot be empty/
      );
    });

    it('長すぎるタイプを拒否する（100文字超）', async () => {
      const node2Id = randomUUID();
      await adapter.createNode('Memory', { id: node2Id, name: 'Node 2' });

      const longType = 'A'.repeat(101);
      await expect(adapter.createRelationship(validNodeId, node2Id, longType)).rejects.toThrow(
        /too long/
      );
    });
  });

  describe('Node existence validation', () => {
    it('両ノードが存在しない場合にエラーを投げる', async () => {
      const fakeNode1 = randomUUID();
      const fakeNode2 = randomUUID();

      await expect(
        adapter.createRelationship(fakeNode1, fakeNode2, 'REFERENCES')
      ).rejects.toThrow(/Both nodes not found/);
    });

    it('送信元ノードが存在しない場合にエラーを投げる', async () => {
      const fakeNode = randomUUID();
      const validNode = randomUUID();
      await adapter.createNode('Memory', { id: validNode, name: 'Valid' });

      await expect(
        adapter.createRelationship(fakeNode, validNode, 'REFERENCES')
      ).rejects.toThrow(/Source node not found/);
    });

    it('送信先ノードが存在しない場合にエラーを投げる', async () => {
      const validNode = randomUUID();
      await adapter.createNode('Memory', { id: validNode, name: 'Valid' });
      const fakeNode = randomUUID();

      await expect(
        adapter.createRelationship(validNode, fakeNode, 'REFERENCES')
      ).rejects.toThrow(/Target node not found/);
    });

    it('両ノードが存在する場合にリレーションシップを作成できる', async () => {
      const node1 = randomUUID();
      const node2 = randomUUID();
      await adapter.createNode('Memory', { id: node1, name: 'Node 1' });
      await adapter.createNode('Memory', { id: node2, name: 'Node 2' });

      const edgeId = await adapter.createRelationship(node1, node2, 'REFERENCES');
      expect(edgeId).toBeDefined();

      const relationship = await adapter.getRelationship(edgeId);
      expect(relationship).not.toBeNull();
      expect(relationship?.fromNodeId).toBe(node1);
      expect(relationship?.toNodeId).toBe(node2);
    });
  });

  describe('Property sanitization', () => {
    let node1Id: string;
    let node2Id: string;

    beforeEach(async () => {
      node1Id = randomUUID();
      node2Id = randomUUID();
      await adapter.createNode('Memory', { id: node1Id, name: 'Node 1' });
      await adapter.createNode('Memory', { id: node2Id, name: 'Node 2' });
    });

    it('undefined プロパティを除去する', async () => {
      const edgeId = await adapter.createRelationship(node1Id, node2Id, 'REFERENCES', {
        strength: 0.8,
        invalid: undefined,
        valid: 'test',
      });

      const relationship = await adapter.getRelationship(edgeId);
      expect(relationship?.properties).toHaveProperty('strength', 0.8);
      expect(relationship?.properties).toHaveProperty('valid', 'test');
      expect(relationship?.properties).not.toHaveProperty('invalid');
    });

    it('null プロパティを除去する', async () => {
      const edgeId = await adapter.createRelationship(node1Id, node2Id, 'SUPPORTS', {
        strength: 0.9,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        nullValue: null as any,
        validValue: 42,
      });

      const relationship = await adapter.getRelationship(edgeId);
      expect(relationship?.properties).toHaveProperty('strength', 0.9);
      expect(relationship?.properties).toHaveProperty('validValue', 42);
      expect(relationship?.properties).not.toHaveProperty('nullValue');
    });

    it('NaN プロパティを除去する', async () => {
      const edgeId = await adapter.createRelationship(node1Id, node2Id, 'PREREQUISITE', {
        order: 1,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        nanValue: NaN as any,
        valid: true,
      });

      const relationship = await adapter.getRelationship(edgeId);
      expect(relationship?.properties).toHaveProperty('order', 1);
      expect(relationship?.properties).toHaveProperty('valid', true);
      expect(relationship?.properties).not.toHaveProperty('nanValue');
    });

    it('有効なプロパティ値を保持する', async () => {
      const edgeId = await adapter.createRelationship(node1Id, node2Id, 'DERIVED_FROM', {
        strength: 0.95,
        reasoning: 'Based on similarity',
        timestamp: Date.now(),
        verified: true,
        count: 0, // ゼロも有効
        emptyString: '', // 空文字列も有効
      });

      const relationship = await adapter.getRelationship(edgeId);
      expect(relationship?.properties).toHaveProperty('strength', 0.95);
      expect(relationship?.properties).toHaveProperty('reasoning', 'Based on similarity');
      expect(relationship?.properties).toHaveProperty('verified', true);
      expect(relationship?.properties).toHaveProperty('count', 0);
      expect(relationship?.properties).toHaveProperty('emptyString', '');
    });
  });

  describe('Integration: Full validation flow', () => {
    it('すべての検証を通過して正常にリレーションシップを作成できる', async () => {
      const node1 = randomUUID();
      const node2 = randomUUID();

      // ノード作成
      await adapter.createNode('Memory', { id: node1, name: 'Source', type: 'episodic' });
      await adapter.createNode('Memory', { id: node2, name: 'Target', type: 'semantic' });

      // リレーションシップ作成（完全な検証付き）
      const edgeId = await adapter.createRelationship(node1, node2, 'REFERENCES', {
        strength: 0.85,
        context: 'Test context',
        verified: true,
        // サニタイズされるべきプロパティ
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        shouldBeRemoved: undefined as any,
      });

      // 検証
      expect(edgeId).toBeDefined();
      expect(edgeId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );

      const relationship = await adapter.getRelationship(edgeId);
      expect(relationship).not.toBeNull();
      expect(relationship?.id).toBe(edgeId);
      expect(relationship?.fromNodeId).toBe(node1);
      expect(relationship?.toNodeId).toBe(node2);
      expect(relationship?.type).toBe('REFERENCES');
      expect(relationship?.properties?.strength).toBe(0.85);
      expect(relationship?.properties?.context).toBe('Test context');
      expect(relationship?.properties).not.toHaveProperty('shouldBeRemoved');
    });
  });
});
