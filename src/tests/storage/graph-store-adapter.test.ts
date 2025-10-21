/**
 * Graph Store Adapter Tests
 *
 * タスク6.1: グラフストレージアダプターの基本実装
 * - Neo4jグラフデータベース接続管理
 * - ノードの作成、更新、削除
 * - プロパティの管理と検証
 * - トランザクション処理
 * - エラーハンドリングとリトライ
 *
 * TDDアプローチ: RED → GREEN → REFACTOR
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import neo4j, { Driver, Session } from 'neo4j-driver';
import {
  GraphStoreAdapter,
  CypherPatternBuilder,
  type GraphStoreConfig,
  type NodeId,
  type NodeProperties,
} from '../../storage/graph-store-adapter';

describe('GraphStoreAdapter', () => {
  let driver: Driver;
  let adapter: GraphStoreAdapter;
  let session: Session;

  // テスト用の接続設定
  const testConfig: GraphStoreConfig = {
    uri: process.env.NEO4J_URI || 'neo4j://localhost:7687',
    username: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'changeme',
    database: process.env.NEO4J_DATABASE || 'neo4j',
  };

  beforeAll(async () => {
    // テスト用Neo4jドライバーを初期化
    driver = neo4j.driver(
      testConfig.uri,
      neo4j.auth.basic(testConfig.username, testConfig.password)
    );

    // 接続確認
    await driver.verifyConnectivity();

    // GraphStoreAdapter初期化
    adapter = new GraphStoreAdapter(testConfig);
  });

  beforeEach(async () => {
    // 各テストの前にテストデータをクリア
    session = driver.session({ database: testConfig.database });
    await session.run('MATCH (n) DETACH DELETE n');
    await session.close();
  });

  afterAll(async () => {
    // 接続をクローズ
    if (adapter) {
      await adapter.close();
    }
    if (driver) {
      await driver.close();
    }
  });

  describe('接続管理', () => {
    it('Neo4jデータベースへの接続を確立できる', async () => {
      // アダプターが正常に初期化されていることを確認
      expect(adapter).toBeDefined();

      // 接続確認クエリを実行
      const session = driver.session({ database: testConfig.database });
      const result = await session.run('RETURN 1 AS number');
      await session.close();

      expect(result.records).toHaveLength(1);
      // Neo4jはInteger型を返すため、toNumber()で変換
      const numberValue = result.records[0]?.get('number');
      expect(numberValue.toNumber()).toBe(1);
    });

    it('close()で接続を正常にクローズできる', async () => {
      // 新しいアダプターを作成
      const tempAdapter = new GraphStoreAdapter(testConfig);

      // クローズ前は接続が有効
      expect(tempAdapter).toBeDefined();

      // クローズを実行
      await tempAdapter.close();

      // クローズ後に操作を試みるとエラー (idを含めてバリデーションを通過させる)
      await expect(
        tempAdapter.createNode('Test', { id: 'test-id', name: 'test' })
      ).rejects.toThrow('GraphStoreAdapter has been closed');
    });

    it('無効な接続設定でエラーをスローする', async () => {
      const invalidConfig: GraphStoreConfig = {
        uri: 'neo4j://invalid-host:7687',
        username: 'invalid',
        password: 'invalid',
        database: 'neo4j',
      };

      const invalidAdapter = new GraphStoreAdapter(invalidConfig);

      // 接続試行時にエラーをスロー (idを含めてバリデーションを通過させる)
      await expect(
        invalidAdapter.createNode('Test', { id: 'test-id', name: 'test' })
      ).rejects.toThrow();

      await invalidAdapter.close();
    });
  });

  describe('ノード作成', () => {
    it('基本的なプロパティを持つノードを作成できる', async () => {
      const properties: NodeProperties = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Node',
        type: 'episodic',
      };

      const nodeId = await adapter.createNode('Memory', properties);

      expect(nodeId).toBe(properties.id);

      // ノードが実際に作成されたことを確認
      const session = driver.session({ database: testConfig.database });
      const result = await session.run('MATCH (n:Memory {id: $id}) RETURN n', { id: nodeId });
      await session.close();

      expect(result.records).toHaveLength(1);
      const node = result.records[0]?.get('n');
      expect(node.properties.id).toBe(properties.id);
      expect(node.properties.name).toBe(properties.name);
      expect(node.properties.type).toBe(properties.type);
    });

    it('複数のラベルを持つノードを作成できる', async () => {
      const properties: NodeProperties = {
        id: '123e4567-e89b-12d3-a456-426614174001',
        name: 'Multi Label Node',
      };

      const nodeId = await adapter.createNode(['Memory', 'Episodic'], properties);

      expect(nodeId).toBe(properties.id);

      // ラベルを確認
      const session = driver.session({ database: testConfig.database });
      const result = await session.run('MATCH (n) WHERE n.id = $id RETURN labels(n) AS labels', {
        id: nodeId,
      });
      await session.close();

      const labels = result.records[0]?.get('labels');
      expect(labels).toContain('Memory');
      expect(labels).toContain('Episodic');
    });

    it('idプロパティが必須である', async () => {
      const properties: NodeProperties = {
        name: 'No ID Node',
      };

      await expect(adapter.createNode('Memory', properties)).rejects.toThrow(
        'Node properties must include "id" field'
      );
    });

    it('空のプロパティでエラーをスローする', async () => {
      await expect(adapter.createNode('Memory', {})).rejects.toThrow(
        'Node properties must include "id" field'
      );
    });
  });

  describe('ノード取得', () => {
    it('IDでノードを取得できる', async () => {
      // テストノードを作成
      const properties: NodeProperties = {
        id: '123e4567-e89b-12d3-a456-426614174002',
        name: 'Retrievable Node',
        type: 'semantic',
      };
      await adapter.createNode('Memory', properties);

      // ノードを取得
      const node = await adapter.getNode(properties.id);

      expect(node).toBeDefined();
      expect(node.id).toBe(properties.id);
      expect(node.labels).toContain('Memory');
      expect(node.properties.name).toBe(properties.name);
      expect(node.properties.type).toBe(properties.type);
    });

    it('存在しないIDでnullを返す', async () => {
      const node = await adapter.getNode('non-existent-id');
      expect(node).toBeNull();
    });
  });

  describe('ノード更新', () => {
    it('既存ノードのプロパティを更新できる', async () => {
      // テストノードを作成
      const properties: NodeProperties = {
        id: '123e4567-e89b-12d3-a456-426614174003',
        name: 'Original Name',
        type: 'episodic',
      };
      await adapter.createNode('Memory', properties);

      // プロパティを更新
      const updates: Partial<NodeProperties> = {
        name: 'Updated Name',
        description: 'New description',
      };
      const success = await adapter.updateNode(properties.id, updates);

      expect(success).toBe(true);

      // 更新を確認
      const node = await adapter.getNode(properties.id);
      expect(node?.properties.name).toBe('Updated Name');
      expect(node?.properties.description).toBe('New description');
      expect(node?.properties.type).toBe('episodic'); // 既存のプロパティは維持
    });

    it('存在しないノードの更新でfalseを返す', async () => {
      const success = await adapter.updateNode('non-existent-id', { name: 'Test' });
      expect(success).toBe(false);
    });

    it('idプロパティの更新を拒否する', async () => {
      // テストノードを作成
      const properties: NodeProperties = {
        id: '123e4567-e89b-12d3-a456-426614174004',
        name: 'Test Node',
      };
      await adapter.createNode('Memory', properties);

      // idの更新を試みる
      await expect(adapter.updateNode(properties.id, { id: 'new-id' })).rejects.toThrow(
        'Cannot update "id" property'
      );
    });
  });

  describe('ノード削除', () => {
    it('ノードを削除できる', async () => {
      // テストノードを作成
      const properties: NodeProperties = {
        id: '123e4567-e89b-12d3-a456-426614174005',
        name: 'To Be Deleted',
      };
      await adapter.createNode('Memory', properties);

      // 削除を実行
      const success = await adapter.deleteNode(properties.id);
      expect(success).toBe(true);

      // ノードが存在しないことを確認
      const node = await adapter.getNode(properties.id);
      expect(node).toBeNull();
    });

    it('存在しないノードの削除でfalseを返す', async () => {
      const success = await adapter.deleteNode('non-existent-id');
      expect(success).toBe(false);
    });
  });

  describe('トランザクション処理', () => {
    it('トランザクション内で複数の操作を実行できる', async () => {
      const nodeId = await adapter.executeTransaction(async (tx) => {
        // トランザクション内で複数のノードを作成
        const id1 = '123e4567-e89b-12d3-a456-426614174006';
        const id2 = '123e4567-e89b-12d3-a456-426614174007';

        await tx.run('CREATE (n:Memory {id: $id, name: $name})', { id: id1, name: 'Node 1' });
        await tx.run('CREATE (n:Memory {id: $id, name: $name})', { id: id2, name: 'Node 2' });

        return id1;
      });

      expect(nodeId).toBe('123e4567-e89b-12d3-a456-426614174006');

      // 両方のノードが作成されたことを確認
      const node1 = await adapter.getNode('123e4567-e89b-12d3-a456-426614174006');
      const node2 = await adapter.getNode('123e4567-e89b-12d3-a456-426614174007');

      expect(node1).toBeDefined();
      expect(node2).toBeDefined();
    });

    it('トランザクション内のエラーで全体をロールバックする', async () => {
      const nodeId = '123e4567-e89b-12d3-a456-426614174008';

      await expect(
        adapter.executeTransaction(async (tx) => {
          // 最初の操作は成功
          await tx.run('CREATE (n:Memory {id: $id, name: $name})', { id: nodeId, name: 'Node 1' });

          // 2番目の操作でエラー（無効なCypher）
          await tx.run('INVALID CYPHER QUERY');

          return nodeId;
        })
      ).rejects.toThrow();

      // ロールバックされたため、ノードは作成されていない
      const node = await adapter.getNode(nodeId);
      expect(node).toBeNull();
    });
  });

  describe('エラーハンドリングとリトライ', () => {
    it('一時的なエラーで自動リトライを実行する', async () => {
      let attemptCount = 0;

      const properties: NodeProperties = {
        id: '123e4567-e89b-12d3-a456-426614174009',
        name: 'Retry Test Node',
      };

      // session.run() をモック: 最初の2回は一時的なエラーをスロー、3回目で成功
      const mockRun = vi.fn().mockImplementation(async () => {
        attemptCount++;
        if (attemptCount <= 2) {
          // Neo4jドライバー互換の一時的なエラー（code, name プロパティ付き）
          const err = Object.assign(
            new Error('ServiceUnavailable: database unavailable - temporary connection issue'),
            {
              code: 'ServiceUnavailable',
              name: 'Neo4jError',
            }
          );
          throw err;
        }
        // 3回目は成功（CREATE クエリなので戻り値は空でOKだが、形状は実装に合わせる）
        return Promise.resolve({ records: [], summary: {} });
      });

      // driver.session() をモック
      const mockClose = vi.fn().mockResolvedValue(undefined);
      const mockSession = {
        run: mockRun,
        close: mockClose,
      };

      // テスト専用の新しいドライバーとアダプターを作成
      const testDriver = neo4j.driver(
        testConfig.uri,
        neo4j.auth.basic(testConfig.username, testConfig.password)
      );

      // driver.session() をスパイ
      const sessionSpy = vi.spyOn(testDriver, 'session').mockReturnValue(mockSession as unknown as Session);

      // テスト専用アダプター(内部で testDriver を使う)
      const testAdapter = new GraphStoreAdapter(testConfig);
      // アダプターの内部ドライバーをモックしたドライバーに差し替え
      // @ts-expect-error - private field access for testing
      testAdapter.driver = testDriver;

      try {
        // createNode を実行 - 内部でリトライが発生するはず
        const nodeId = await testAdapter.createNode('Memory', properties);

        // 結果の検証
        expect(nodeId).toBe(properties.id);
        expect(attemptCount).toBe(3); // 3回試行されたことを確認
        expect(mockRun).toHaveBeenCalledTimes(3); // session.run が3回呼ばれたことを確認
        expect(sessionSpy).toHaveBeenCalledTimes(3); // session が3回作成されたことを確認
      } finally {
        // モックをクリーンアップ
        sessionSpy.mockRestore();
        await testDriver.close();
      }
    });

    it('永続的なエラーで即座に失敗する', async () => {
      // 無効なラベル名（数字で開始）でエラーをスロー
      await expect(adapter.createNode('123InvalidLabel', { id: 'test-id' })).rejects.toThrow();
    });
  });

  // タスク6.2: 関係性の管理とグラフトラバーサル
  describe('リレーションシップ管理', () => {
    let node1Id: string;
    let node2Id: string;
    let node3Id: string;

    beforeEach(async () => {
      // テスト用ノードを作成
      node1Id = await adapter.createNode('Memory', {
        id: '123e4567-e89b-12d3-a456-426614174010',
        name: 'Node 1',
      });
      node2Id = await adapter.createNode('Memory', {
        id: '123e4567-e89b-12d3-a456-426614174011',
        name: 'Node 2',
      });
      node3Id = await adapter.createNode('Memory', {
        id: '123e4567-e89b-12d3-a456-426614174012',
        name: 'Node 3',
      });
    });

    it('リレーションシップを作成できる', async () => {
      const edgeId = await adapter.createRelationship(node1Id, node2Id, 'REFERENCES', {
        strength: 0.8,
        reasoning: 'Test relationship',
      });

      expect(edgeId).toBeDefined();
      expect(typeof edgeId).toBe('string');
    });

    it('リレーションシップを取得できる', async () => {
      const edgeId = await adapter.createRelationship(node1Id, node2Id, 'DERIVED_FROM', {
        strength: 0.9,
      });

      const relationship = await adapter.getRelationship(edgeId);

      expect(relationship).not.toBeNull();
      expect(relationship?.fromNodeId).toBe(node1Id);
      expect(relationship?.toNodeId).toBe(node2Id);
      expect(relationship?.type).toBe('DERIVED_FROM');
      expect(relationship?.properties.strength).toBe(0.9);
    });

    it('存在しないリレーションシップでnullを返す', async () => {
      const relationship = await adapter.getRelationship('non-existent-edge-id');
      expect(relationship).toBeNull();
    });

    it('ノードの出力方向のリレーションシップを取得できる', async () => {
      await adapter.createRelationship(node1Id, node2Id, 'REFERENCES');
      await adapter.createRelationship(node1Id, node3Id, 'DERIVED_FROM');

      const relationships = await adapter.getNodeRelationships(node1Id, 'outgoing');

      expect(relationships).toHaveLength(2);
      expect(relationships.every((r) => r.fromNodeId === node1Id)).toBe(true);
    });

    it('ノードの入力方向のリレーションシップを取得できる', async () => {
      await adapter.createRelationship(node1Id, node2Id, 'REFERENCES');
      await adapter.createRelationship(node3Id, node2Id, 'SUPPORTS');

      const relationships = await adapter.getNodeRelationships(node2Id, 'incoming');

      expect(relationships).toHaveLength(2);
      expect(relationships.every((r) => r.toNodeId === node2Id)).toBe(true);
    });

    it('ノードの両方向のリレーションシップを取得できる', async () => {
      await adapter.createRelationship(node1Id, node2Id, 'REFERENCES');
      await adapter.createRelationship(node2Id, node3Id, 'DERIVED_FROM');

      const relationships = await adapter.getNodeRelationships(node2Id, 'both');

      expect(relationships).toHaveLength(2);
    });

    it('タイプでリレーションシップをフィルタできる', async () => {
      await adapter.createRelationship(node1Id, node2Id, 'REFERENCES');
      await adapter.createRelationship(node1Id, node3Id, 'DERIVED_FROM');

      const relationships = await adapter.getNodeRelationships(node1Id, 'outgoing', 'REFERENCES');

      expect(relationships).toHaveLength(1);
      expect(relationships[0]?.type).toBe('REFERENCES');
    });

    it('リレーションシップを削除できる', async () => {
      const edgeId = await adapter.createRelationship(node1Id, node2Id, 'REFERENCES');

      const success = await adapter.deleteRelationship(edgeId);
      expect(success).toBe(true);

      const relationship = await adapter.getRelationship(edgeId);
      expect(relationship).toBeNull();
    });

    it('存在しないリレーションシップの削除でfalseを返す', async () => {
      const success = await adapter.deleteRelationship('non-existent-edge-id');
      expect(success).toBe(false);
    });
  });

  describe('グラフトラバーサル', () => {
    let node1Id: string;
    let node2Id: string;
    let node3Id: string;
    let node4Id: string;

    beforeEach(async () => {
      // テスト用ノードとリレーションシップのグラフを構築
      // node1 -> node2 -> node3
      //   |               ^
      //   +-> node4 ------+
      node1Id = await adapter.createNode('Memory', {
        id: '123e4567-e89b-12d3-a456-426614174020',
        name: 'Node 1',
      });
      node2Id = await adapter.createNode('Memory', {
        id: '123e4567-e89b-12d3-a456-426614174021',
        name: 'Node 2',
      });
      node3Id = await adapter.createNode('Memory', {
        id: '123e4567-e89b-12d3-a456-426614174022',
        name: 'Node 3',
      });
      node4Id = await adapter.createNode('Memory', {
        id: '123e4567-e89b-12d3-a456-426614174023',
        name: 'Node 4',
      });

      await adapter.createRelationship(node1Id, node2Id, 'REFERENCES');
      await adapter.createRelationship(node2Id, node3Id, 'DERIVED_FROM');
      await adapter.createRelationship(node1Id, node4Id, 'SUPPORTS');
      await adapter.createRelationship(node4Id, node3Id, 'PREREQUISITE');
    });

    it('Cypherパターンでグラフを探索できる', async () => {
      // node1から1ホップの関係を取得
      const pattern = new CypherPatternBuilder().maxDepth(1).build();
      const results = await adapter.traverseGraph(node1Id, pattern);

      expect(results).toHaveLength(2); // node2 と node4
      expect(results.some((r) => r.nodes.some((n) => n.id === node2Id))).toBe(true);
      expect(results.some((r) => r.nodes.some((n) => n.id === node4Id))).toBe(true);
    });

    it('2ホップのグラフ探索ができる', async () => {
      // node1から2ホップの関係を取得
      const pattern = new CypherPatternBuilder().minDepth(1).maxDepth(2).build();
      const results = await adapter.traverseGraph(node1Id, pattern);

      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.some((r) => r.nodes.some((n) => n.id === node3Id))).toBe(true);
    });

    it('最短パスを検索できる', async () => {
      const path = await adapter.findShortestPath(node1Id, node3Id);

      expect(path).not.toBeNull();
      expect(path?.nodes).toHaveLength(3); // node1 -> node2 -> node3
      expect(path?.relationships).toHaveLength(2);
      expect(path?.length).toBe(2);
    });

    it('パスが存在しない場合nullを返す', async () => {
      // 別のグラフを作成
      const isolatedNodeId = await adapter.createNode('Memory', {
        id: '123e4567-e89b-12d3-a456-426614174024',
        name: 'Isolated Node',
      });

      const path = await adapter.findShortestPath(node1Id, isolatedNodeId);
      expect(path).toBeNull();
    });

    it('最大深さを超えるパスでnullを返す', async () => {
      const path = await adapter.findShortestPath(node1Id, node3Id, 1);
      expect(path).toBeNull();
    });
  });

  describe('グラフ分析', () => {
    beforeEach(async () => {
      // 中心性計算用のグラフ構造を構築
      // 中央ノード (hub) に多くのリレーションシップを持たせる
      const hubId = await adapter.createNode('Memory', {
        id: '123e4567-e89b-12d3-a456-426614174030',
        name: 'Hub Node',
      });

      for (let i = 0; i < 5; i++) {
        const leafId = await adapter.createNode('Memory', {
          id: `123e4567-e89b-12d3-a456-42661417403${i + 1}`,
          name: `Leaf Node ${i + 1}`,
        });
        await adapter.createRelationship(hubId, leafId, 'REFERENCES');
      }
    });

    it('ノードの中心性を計算できる', async () => {
      const hubId = '123e4567-e89b-12d3-a456-426614174030';
      const centrality = await adapter.calculateCentrality(hubId);

      expect(centrality).toBeGreaterThan(0);
      expect(centrality).toBeLessThanOrEqual(1);
    });

    it('孤立ノードの中心性は低い', async () => {
      const isolatedId = await adapter.createNode('Memory', {
        id: '123e4567-e89b-12d3-a456-426614174040',
        name: 'Isolated Node',
      });

      const centrality = await adapter.calculateCentrality(isolatedId);
      expect(centrality).toBe(0);
    });
  });

  describe('コミュニティ検出', () => {
    beforeEach(async () => {
      // 2つのコミュニティを作成
      // Community 1: nodes 1-3
      const comm1Nodes = [];
      for (let i = 0; i < 3; i++) {
        const nodeId = await adapter.createNode('Memory', {
          id: `123e4567-e89b-12d3-a456-42661417405${i}`,
          name: `Community 1 Node ${i + 1}`,
        });
        comm1Nodes.push(nodeId);
      }
      // Community 1のノード同士を結合
      await adapter.createRelationship(comm1Nodes[0]!, comm1Nodes[1]!, 'REFERENCES');
      await adapter.createRelationship(comm1Nodes[1]!, comm1Nodes[2]!, 'REFERENCES');
      await adapter.createRelationship(comm1Nodes[2]!, comm1Nodes[0]!, 'REFERENCES');

      // Community 2: nodes 4-6
      const comm2Nodes = [];
      for (let i = 0; i < 3; i++) {
        const nodeId = await adapter.createNode('Memory', {
          id: `123e4567-e89b-12d3-a456-42661417406${i}`,
          name: `Community 2 Node ${i + 1}`,
        });
        comm2Nodes.push(nodeId);
      }
      // Community 2のノード同士を結合
      await adapter.createRelationship(comm2Nodes[0]!, comm2Nodes[1]!, 'REFERENCES');
      await adapter.createRelationship(comm2Nodes[1]!, comm2Nodes[2]!, 'REFERENCES');
      await adapter.createRelationship(comm2Nodes[2]!, comm2Nodes[0]!, 'REFERENCES');
    });

    it('コミュニティを検出できる', async () => {
      const communities = await adapter.findCommunities();

      expect(communities.length).toBeGreaterThanOrEqual(2);
      expect(communities.every((c) => c.size > 0)).toBe(true);
      expect(communities.every((c) => c.memberIds.length === c.size)).toBe(true);
    });
  });

  describe('ラベルバリデーション（Cypherインジェクション防止）', () => {
    describe('有効なラベル', () => {
      it('英字で始まるラベルを受け入れる', async () => {
        const properties: NodeProperties = { id: 'test-valid-1' };
        const nodeId = await adapter.createNode('ValidLabel', properties);
        expect(nodeId).toBe(properties.id);
      });

      it('アンダースコアで始まるラベルを受け入れる', async () => {
        const properties: NodeProperties = { id: 'test-valid-2' };
        const nodeId = await adapter.createNode('_ValidLabel', properties);
        expect(nodeId).toBe(properties.id);
      });

      it('英数字とアンダースコアを含むラベルを受け入れる', async () => {
        const properties: NodeProperties = { id: 'test-valid-3' };
        const nodeId = await adapter.createNode('Valid_Label_123', properties);
        expect(nodeId).toBe(properties.id);
      });

      it('複数の有効なラベルを受け入れる', async () => {
        const properties: NodeProperties = { id: 'test-valid-4' };
        const nodeId = await adapter.createNode(['Memory', 'Episodic_2023'], properties);
        expect(nodeId).toBe(properties.id);
      });

      it('大文字小文字混在のラベルを受け入れる', async () => {
        const properties: NodeProperties = { id: 'test-valid-5' };
        const nodeId = await adapter.createNode('CamelCaseLabel', properties);
        expect(nodeId).toBe(properties.id);
      });
    });

    describe('無効なラベル（Cypherインジェクション対策）', () => {
      it('数字で始まるラベルを拒否する', async () => {
        await expect(
          adapter.createNode('123Invalid', { id: 'test-invalid-1' })
        ).rejects.toThrow(/Invalid label.*123Invalid/);
      });

      it('ハイフンを含むラベルを拒否する', async () => {
        await expect(
          adapter.createNode('Invalid-Label', { id: 'test-invalid-2' })
        ).rejects.toThrow(/Invalid label.*Invalid-Label/);
      });

      it('スペースを含むラベルを拒否する', async () => {
        await expect(
          adapter.createNode('Invalid Label', { id: 'test-invalid-3' })
        ).rejects.toThrow(/Invalid label.*Invalid Label/);
      });

      it('特殊文字を含むラベルを拒否する（Cypherインジェクション防止）', async () => {
        await expect(
          adapter.createNode('Label;DROP TABLE', { id: 'test-invalid-4' })
        ).rejects.toThrow(/Invalid label/);
      });

      it('引用符を含むラベルを拒否する', async () => {
        await expect(
          adapter.createNode("Label'OR'1'='1", { id: 'test-invalid-5' })
        ).rejects.toThrow(/Invalid label/);
      });

      it('バッククォートを含むラベルを拒否する', async () => {
        await expect(
          adapter.createNode('Label`malicious`', { id: 'test-invalid-6' })
        ).rejects.toThrow(/Invalid label/);
      });

      it('コロンを含むラベルを拒否する', async () => {
        await expect(
          adapter.createNode('Label:Injection', { id: 'test-invalid-7' })
        ).rejects.toThrow(/Invalid label/);
      });

      it('カンマを含むラベルを拒否する', async () => {
        await expect(
          adapter.createNode('Label,Another', { id: 'test-invalid-8' })
        ).rejects.toThrow(/Invalid label/);
      });

      it('括弧を含むラベルを拒否する', async () => {
        await expect(
          adapter.createNode('Label()', { id: 'test-invalid-9' })
        ).rejects.toThrow(/Invalid label/);
      });

      it('ドットを含むラベルを拒否する', async () => {
        await expect(
          adapter.createNode('Label.Property', { id: 'test-invalid-10' })
        ).rejects.toThrow(/Invalid label/);
      });

      it('空文字列ラベルを拒否する', async () => {
        await expect(adapter.createNode('', { id: 'test-invalid-11' })).rejects.toThrow(
          /Invalid label/
        );
      });

      it('複数ラベルに1つでも無効なものがあれば拒否する', async () => {
        await expect(
          adapter.createNode(['ValidLabel', 'Invalid-Label'], { id: 'test-invalid-12' })
        ).rejects.toThrow(/Invalid label.*Invalid-Label/);
      });

      it('Cypherコマンドを含むラベルを拒否する', async () => {
        await expect(
          adapter.createNode('Label MATCH (n) DELETE n', { id: 'test-invalid-13' })
        ).rejects.toThrow(/Invalid label/);
      });

      it('改行文字を含むラベルを拒否する', async () => {
        await expect(
          adapter.createNode('Label\nMATCH', { id: 'test-invalid-14' })
        ).rejects.toThrow(/Invalid label/);
      });

      it('タブ文字を含むラベルを拒否する', async () => {
        await expect(
          adapter.createNode('Label\tInjection', { id: 'test-invalid-15' })
        ).rejects.toThrow(/Invalid label/);
      });
    });

    describe('エラーメッセージの明確性', () => {
      it('無効なラベルに対して明確なエラーメッセージを返す', async () => {
        try {
          await adapter.createNode('123Invalid', { id: 'test-error-msg' });
          expect.fail('Should have thrown an error');
        } catch (error) {
          const err = error as Error;
          expect(err.message).toContain('Invalid label');
          expect(err.message).toContain('123Invalid');
          expect(err.message).toContain('must start with a letter or underscore');
          expect(err.message).toContain('contain only letters, numbers, and underscores');
        }
      });
    });
  });
});
