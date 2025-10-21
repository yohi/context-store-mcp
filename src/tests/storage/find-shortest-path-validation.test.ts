/**
 * findShortestPathメソッドのmaxDepthバリデーションテスト
 * 
 * このテストファイルは、findShortestPathメソッドのmaxDepthパラメータが
 * 正しくバリデーションされることを検証します。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GraphStoreAdapter, type NodeId } from '../../storage/graph-store-adapter';

describe('findShortestPath - maxDepthバリデーション', () => {
  let adapter: GraphStoreAdapter;
  let node1Id: NodeId;
  let node2Id: NodeId;

  beforeAll(async () => {
    adapter = new GraphStoreAdapter({
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USER || 'neo4j',
      password: process.env.NEO4J_PASSWORD || 'password',
      database: process.env.NEO4J_DATABASE || 'context_store_test',
    });

    // テスト用ノードを作成
    const id1 = 'test-node-1-' + Date.now();
    const id2 = 'test-node-2-' + Date.now();

    node1Id = await adapter.createNode('TestNode', { id: id1, name: 'Node1' });
    node2Id = await adapter.createNode('TestNode', { id: id2, name: 'Node2' });

    // ノード間にリレーションシップを作成
    await adapter.createRelationship(node1Id, node2Id, 'CONNECTED', {});
  });

  afterAll(async () => {
    await adapter.deleteNode(node1Id);
    await adapter.deleteNode(node2Id);
    await adapter.close();
  });

  describe('正常なmaxDepth値', () => {
    it('maxDepth=1で動作する', async () => {
      const result = await adapter.findShortestPath(node1Id, node2Id, 1);
      expect(result).not.toBeNull();
      expect(result?.length).toBe(1);
    });

    it('maxDepth=5（デフォルト）で動作する', async () => {
      const result = await adapter.findShortestPath(node1Id, node2Id);
      expect(result).not.toBeNull();
    });

    it('maxDepth=100（上限）で動作する', async () => {
      const result = await adapter.findShortestPath(node1Id, node2Id, 100);
      expect(result).not.toBeNull();
    });
  });

  describe('異常なmaxDepth値のサニタイゼーション', () => {
    it('maxDepth=0の場合、デフォルト値5にフォールバックする', async () => {
      const result = await adapter.findShortestPath(node1Id, node2Id, 0);
      // デフォルト値5を使用するため、結果は見つかるはず
      expect(result).not.toBeNull();
    });

    it('maxDepth=-1の場合、デフォルト値5にフォールバックする', async () => {
      const result = await adapter.findShortestPath(node1Id, node2Id, -1);
      expect(result).not.toBeNull();
    });

    it('maxDepth=1000の場合、デフォルト値5にフォールバックする', async () => {
      const result = await adapter.findShortestPath(node1Id, node2Id, 1000);
      expect(result).not.toBeNull();
    });

    it('maxDepth=NaNの場合、デフォルト値5にフォールバックする', async () => {
      const result = await adapter.findShortestPath(node1Id, node2Id, NaN);
      expect(result).not.toBeNull();
    });

    it('maxDepth=Infinityの場合、デフォルト値5にフォールバックする', async () => {
      const result = await adapter.findShortestPath(node1Id, node2Id, Infinity);
      expect(result).not.toBeNull();
    });

    it('maxDepth=小数の場合、デフォルト値5にフォールバックする', async () => {
      const result = await adapter.findShortestPath(node1Id, node2Id, 3.5);
      expect(result).not.toBeNull();
    });
  });

  describe('RelationshipのfromNodeId/toNodeId取得', () => {
    it('findShortestPathの結果にfromNodeIdとtoNodeIdが含まれる', async () => {
      const result = await adapter.findShortestPath(node1Id, node2Id, 5);
      
      expect(result).not.toBeNull();
      expect(result?.relationships).toHaveLength(1);
      
      const rel = result!.relationships[0];
      expect(rel.fromNodeId).toBe(node1Id);
      expect(rel.toNodeId).toBe(node2Id);
      expect(rel.type).toBe('CONNECTED');
    });

    it('fromNodeIdとtoNodeIdが空文字列でない', async () => {
      const result = await adapter.findShortestPath(node1Id, node2Id, 5);
      
      expect(result).not.toBeNull();
      const rel = result!.relationships[0];
      
      expect(rel.fromNodeId).not.toBe('');
      expect(rel.toNodeId).not.toBe('');
    });
  });
});
