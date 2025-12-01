/**
 * getNodeRelationships Type Validation Tests
 *
 * getNodeRelationships でのリレーションシップタイプ検証テスト
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { GraphStoreAdapter } from '../../storage/graph-store-adapter';
import { randomUUID } from 'crypto';

// Mock neo4j-driver
vi.mock('neo4j-driver', () => {
  const mockSession = {
    run: vi.fn().mockImplementation((query) => {
      if (query.includes('RETURN r, type(r) AS relType')) {
         // Return mock relationships if needed, or empty list
         return Promise.resolve({
             records: []
         });
      }
      return Promise.resolve({ records: [] });
    }),
    close: vi.fn().mockResolvedValue(undefined),
    executeWrite: vi.fn().mockImplementation((cb) => cb(mockSession)),
  };
  const mockDriver = {
    session: vi.fn().mockReturnValue(mockSession),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    default: {
      driver: vi.fn().mockReturnValue(mockDriver),
      auth: { basic: vi.fn() },
    },
  };
});

describe('getNodeRelationships Type Validation', () => {
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

  describe('Type parameter validation', () => {
    let nodeId: string;

    beforeEach(async () => {
      // テスト用ノードを作成
      nodeId = randomUUID();
      await adapter.createNode('Memory', { id: nodeId, name: 'Test Node' });
    });

    it('有効なタイプでリレーションシップを取得できる', async () => {
      const targetId = randomUUID();
      await adapter.createNode('Memory', { id: targetId, name: 'Target' });
      await adapter.createRelationship(nodeId, targetId, 'REFERENCES');

      // タイプ指定あり
      const relationships = await adapter.getNodeRelationships(nodeId, 'outgoing', 'REFERENCES');
      expect(relationships).toHaveLength(1);
      expect(relationships[0]?.type).toBe('REFERENCES');
    });

    it('タイプ指定なしでもリレーションシップを取得できる', async () => {
      const targetId = randomUUID();
      await adapter.createNode('Memory', { id: targetId, name: 'Target' });
      await adapter.createRelationship(nodeId, targetId, 'REFERENCES');

      // タイプ指定なし
      const relationships = await adapter.getNodeRelationships(nodeId, 'outgoing');
      expect(relationships).toHaveLength(1);
    });

    it('不正なタイプを拒否する（小文字）', async () => {
      await expect(
        adapter.getNodeRelationships(nodeId, 'outgoing', 'references')
      ).rejects.toThrow(/Invalid relationship type/);
    });

    it('不正なタイプを拒否する（特殊文字）', async () => {
      await expect(
        adapter.getNodeRelationships(nodeId, 'outgoing', "REFS'; DROP--")
      ).rejects.toThrow(/Invalid relationship type/);
    });

    it('空のタイプを拒否する', async () => {
      await expect(adapter.getNodeRelationships(nodeId, 'outgoing', '')).rejects.toThrow(
        /cannot be empty/
      );
    });

    it('すべての方向でタイプ検証が機能する', async () => {
      const maliciousType = 'invalid-type';

      // outgoing
      await expect(
        adapter.getNodeRelationships(nodeId, 'outgoing', maliciousType)
      ).rejects.toThrow(/Invalid relationship type/);

      // incoming
      await expect(
        adapter.getNodeRelationships(nodeId, 'incoming', maliciousType)
      ).rejects.toThrow(/Invalid relationship type/);

      // both
      await expect(
        adapter.getNodeRelationships(nodeId, 'both', maliciousType)
      ).rejects.toThrow(/Invalid relationship type/);
    });
  });

  describe('Both direction query (otherId removed)', () => {
    it('both方向でリレーションシップを正しく取得できる', async () => {
      const node1 = randomUUID();
      const node2 = randomUUID();
      const node3 = randomUUID();

      await adapter.createNode('Memory', { id: node1, name: 'Node 1' });
      await adapter.createNode('Memory', { id: node2, name: 'Node 2' });
      await adapter.createNode('Memory', { id: node3, name: 'Node 3' });

      // node2から出ていく
      await adapter.createRelationship(node2, node1, 'REFERENCES');
      // node2に入ってくる
      await adapter.createRelationship(node3, node2, 'REFERENCES');

      const relationships = await adapter.getNodeRelationships(node2, 'both');

      expect(relationships).toHaveLength(2);

      // 両方のリレーションシップが正しく返される
      const outgoing = relationships.find((r) => r.fromNodeId === node2 && r.toNodeId === node1);
      const incoming = relationships.find((r) => r.fromNodeId === node3 && r.toNodeId === node2);

      expect(outgoing).toBeDefined();
      expect(incoming).toBeDefined();

      // edgeIdが存在する
      expect(outgoing?.id).toBeDefined();
      expect(incoming?.id).toBeDefined();

      // タイプが正しい
      expect(outgoing?.type).toBe('REFERENCES');
      expect(incoming?.type).toBe('REFERENCES');
    });

    it('both方向でタイプフィルタが機能する', async () => {
      const node1 = randomUUID();
      const node2 = randomUUID();
      const node3 = randomUUID();

      await adapter.createNode('Memory', { id: node1, name: 'Node 1' });
      await adapter.createNode('Memory', { id: node2, name: 'Node 2' });
      await adapter.createNode('Memory', { id: node3, name: 'Node 3' });

      await adapter.createRelationship(node2, node1, 'REFERENCES');
      await adapter.createRelationship(node3, node2, 'DERIVED_FROM');

      // REFERENCESのみをフィルタ
      const references = await adapter.getNodeRelationships(node2, 'both', 'REFERENCES');
      expect(references).toHaveLength(1);
      expect(references[0]?.type).toBe('REFERENCES');

      // DERIVED_FROMのみをフィルタ
      const derivedFrom = await adapter.getNodeRelationships(node2, 'both', 'DERIVED_FROM');
      expect(derivedFrom).toHaveLength(1);
      expect(derivedFrom[0]?.type).toBe('DERIVED_FROM');
    });
  });
});
