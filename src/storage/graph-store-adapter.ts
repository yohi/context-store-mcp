/**
 * Graph Store Adapter
 *
 * タスク6.1: グラフストレージアダプターの基本実装
 * - Neo4jグラフデータベース接続管理
 * - ノードの作成、更新、削除
 * - プロパティの管理と検証
 * - トランザクション処理
 * - エラーハンドリングとリトライ
 *
 * design.md の GraphStoreAdapter インターフェースに準拠
 */

import neo4j, { Driver, ManagedTransaction } from 'neo4j-driver';

/**
 * ノードID (通常はUUID)
 */
export type NodeId = string;

/**
 * ノードプロパティの型定義
 */
export interface NodeProperties {
  /** ノードID (必須、PostgreSQLのmemoriesテーブルのidと同一) */
  id: NodeId;
  /** その他の任意のプロパティ */
  [key: string]: unknown;
}

/**
 * ノード情報
 */
export interface Node {
  /** ノードID */
  id: NodeId;
  /** ノードのラベル */
  labels: string[];
  /** ノードのプロパティ */
  properties: NodeProperties;
}

/**
 * エッジ (リレーションシップ) ID
 */
export type EdgeId = string;

/**
 * リレーションシップのプロパティ
 */
export interface RelationshipProperties {
  /** リレーションシップの強度 (0.0 - 1.0) */
  strength?: number;
  /** 作成日時 */
  createdAt?: Date;
  /** 作成者 */
  createdBy?: string;
  /** 理由 */
  reasoning?: string;
  /** その他のプロパティ */
  [key: string]: unknown;
}

/**
 * リレーションシップ情報
 */
export interface Relationship {
  /** リレーションシップID */
  id: EdgeId;
  /** 開始ノードID */
  fromNodeId: NodeId;
  /** 終了ノードID */
  toNodeId: NodeId;
  /** リレーションシップタイプ */
  type: string;
  /** プロパティ */
  properties: RelationshipProperties;
}

/**
 * パス情報
 */
export interface Path {
  /** パスに含まれるノード */
  nodes: Node[];
  /** パスに含まれるリレーションシップ */
  relationships: Relationship[];
  /** パスの長さ (ホップ数) */
  length: number;
}

/**
 * グラフトラバーサル結果
 */
export interface GraphResult {
  /** ノード */
  nodes: Node[];
  /** リレーションシップ */
  relationships: Relationship[];
  /** パス (パス探索時のみ) */
  path?: Path;
}

/**
 * コミュニティ情報
 */
export interface Community {
  /** コミュニティID */
  id: string;
  /** コミュニティに属するノードID */
  memberIds: NodeId[];
  /** コミュニティのサイズ */
  size: number;
}

/**
 * Cypherパターン (文字列型) */
export type CypherPattern = string;

/**
 * Graph Store Adapter Configuration
 */
export interface GraphStoreConfig {
  /** Neo4j接続URI */
  uri: string;
  /** ユーザー名 */
  username: string;
  /** パスワード */
  password: string;
  /** データベース名 (デフォルト: neo4j) */
  database?: string;
  /** 最大接続プールサイズ (デフォルト: 50) */
  maxConnectionPoolSize?: number;
  /** 接続タイムアウト (ミリ秒, デフォルト: 30000) */
  connectionTimeout?: number;
}

/**
 * Graph Store Adapter Interface
 *
 * design.md の GraphStoreAdapter インターフェースに準拠
 */
export interface IGraphStoreAdapter {
  /**
   * ノードを作成
   *
   * @param label - ノードのラベル（単一または配列）
   * @param properties - ノードのプロパティ（idは必須）
   * @returns 作成されたノードのID
   */
  createNode(label: string | string[], properties: NodeProperties): Promise<NodeId>;

  /**
   * ノードを取得
   *
   * @param id - ノードID
   * @returns ノード情報、存在しない場合はnull
   */
  getNode(id: NodeId): Promise<Node | null>;

  /**
   * ノードを更新
   *
   * @param id - ノードID
   * @param properties - 更新するプロパティ（部分更新）
   * @returns 更新成功時 true、ノードが存在しない場合 false
   */
  updateNode(id: NodeId, properties: Partial<NodeProperties>): Promise<boolean>;

  /**
   * ノードを削除
   *
   * @param id - ノードID
   * @returns 削除成功時 true、ノードが存在しない場合 false
   */
  deleteNode(id: NodeId): Promise<boolean>;

  /**
   * トランザクションを実行
   *
   * @param work - トランザクション内で実行する処理
   * @returns 処理の結果
   */
  executeTransaction<T>(work: (tx: ManagedTransaction) => Promise<T>): Promise<T>;

  /**
   * 接続をクローズ
   */
  close(): Promise<void>;

  // タスク6.2: 関係性の管理とグラフトラバーサル

  /**
   * リレーションシップを作成
   *
   * @param from - 開始ノードID
   * @param to - 終了ノードID
   * @param type - リレーションシップのタイプ
   * @param properties - リレーションシップのプロパティ (オプション)
   * @returns 作成されたリレーションシップのID
   */
  createRelationship(
    from: NodeId,
    to: NodeId,
    type: string,
    properties?: RelationshipProperties
  ): Promise<EdgeId>;

  /**
   * リレーションシップを取得
   *
   * @param id - リレーションシップID
   * @returns リレーションシップ情報、存在しない場合はnull
   */
  getRelationship(id: EdgeId): Promise<Relationship | null>;

  /**
   * ノードのリレーションシップを取得
   *
   * @param nodeId - ノードID
   * @param direction - リレーションシップの方向 ('outgoing' | 'incoming' | 'both')
   * @param type - リレーションシップのタイプでフィルタ (オプション)
   * @returns リレーションシップの配列
   */
  getNodeRelationships(
    nodeId: NodeId,
    direction?: 'outgoing' | 'incoming' | 'both',
    type?: string
  ): Promise<Relationship[]>;

  /**
   * リレーションシップを削除
   *
   * @param id - リレーションシップID
   * @returns 削除成功時 true、リレーションシップが存在しない場合 false
   */
  deleteRelationship(id: EdgeId): Promise<boolean>;

  /**
   * グラフトラバーサル (Cypherパターンマッチング)
   *
   * @param startNode - 開始ノードID
   * @param pattern - Cypherパターン文字列
   * @param params - クエリパラメータ (オプション)
   * @returns グラフトラバーサル結果
   */
  traverseGraph(
    startNode: NodeId,
    pattern: CypherPattern,
    params?: Record<string, unknown>
  ): Promise<GraphResult[]>;

  /**
   * 2ノード間の最短パスを検索
   *
   * @param from - 開始ノードID
   * @param to - 終了ノードID
   * @param maxDepth - 最大深さ (デフォルト: 5)
   * @returns パス情報、存在しない場合はnull
   */
  findShortestPath(from: NodeId, to: NodeId, maxDepth?: number): Promise<Path | null>;

  /**
   * ノードの中心性を計算
   *
   * @param nodeId - ノードID
   * @returns 中心性スコア (0.0 - 1.0)
   */
  calculateCentrality(nodeId: NodeId): Promise<number>;

  /**
   * コミュニティ検出 (Louvainアルゴリズム)
   *
   * @returns コミュニティの配列
   */
  findCommunities(): Promise<Community[]>;
}

/**
 * Graph Store Adapter Implementation
 */
export class GraphStoreAdapter implements IGraphStoreAdapter {
  private driver: Driver;
  private database: string;
  private closed: boolean = false;

  // リトライポリシー設定
  private static readonly MAX_RETRIES = 3;
  private static readonly INITIAL_DELAY = 100; // ms
  private static readonly MAX_DELAY = 5000; // ms
  private static readonly MULTIPLIER = 2.0;

  constructor(config: GraphStoreConfig) {
    this.database = config.database || 'neo4j';
    this.driver = neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password), {
      maxConnectionPoolSize: config.maxConnectionPoolSize || 50,
      connectionTimeout: config.connectionTimeout || 30000,
    });
  }

  /**
   * ノードラベルをCypherクエリ用の文字列に変換
   */
  private formatLabels(label: string | string[]): string {
    const labels = Array.isArray(label) ? label : [label];
    return labels.map((l) => `:${l}`).join('');
  }

  /**
   * プロパティをCypherクエリのパラメータに変換
   */
  private formatProperties(properties: NodeProperties): Record<string, unknown> {
    const formatted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      formatted[key] = value;
    }
    return formatted;
  }

  /**
   * リトライ可能なエラーかどうかを判定
   */
  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const message = error.message.toLowerCase();

    // Neo4jの一時的なエラー
    const retryablePatterns = [
      'transient',
      'deadlock',
      'timeout',
      'connection',
      'service unavailable',
      'database unavailable',
    ];

    return retryablePatterns.some((pattern) => message.includes(pattern));
  }

  /**
   * エクスポネンシャルバックオフでリトライを実行
   */
  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < GraphStoreAdapter.MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (!this.isRetryableError(error)) {
          throw error;
        }

        lastError = error as Error;

        if (attempt === GraphStoreAdapter.MAX_RETRIES - 1) {
          break;
        }

        // エクスポネンシャルバックオフ + ジッター計算
        const exponentialDelay =
          GraphStoreAdapter.INITIAL_DELAY * Math.pow(GraphStoreAdapter.MULTIPLIER, attempt);
        const jitter = Math.random() * 100 - 50; // -50ms ~ +50ms
        const delayMs = Math.min(
          GraphStoreAdapter.MAX_DELAY,
          Math.max(0, exponentialDelay + jitter)
        );

        // リトライ前に待機
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new Error(
      `Operation failed after ${GraphStoreAdapter.MAX_RETRIES} attempts: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * 接続が有効かチェック
   */
  private checkConnection(): void {
    if (this.closed) {
      throw new Error('GraphStoreAdapter has been closed');
    }
  }

  async createNode(label: string | string[], properties: NodeProperties): Promise<NodeId> {
    this.checkConnection();

    // idプロパティの存在チェック
    if (!properties.id) {
      throw new Error('Node properties must include "id" field');
    }

    const nodeId = properties.id;

    await this.executeWithRetry(async () => {
      const session = this.driver.session({ database: this.database });
      try {
        const labelStr = this.formatLabels(label);
        const props = this.formatProperties(properties);

        await session.run(`CREATE (n${labelStr} $props)`, { props });
      } finally {
        await session.close();
      }
    });

    return nodeId;
  }

  async getNode(id: NodeId): Promise<Node | null> {
    this.checkConnection();

    return await this.executeWithRetry(async () => {
      const session = this.driver.session({ database: this.database });
      try {
        const result = await session.run('MATCH (n {id: $id}) RETURN n, labels(n) AS labels', {
          id,
        });

        if (result.records.length === 0) {
          return null;
        }

        const record = result.records[0];
        if (!record) {
          return null;
        }

        const node = record.get('n');
        const labels = record.get('labels');

        return {
          id,
          labels,
          properties: node.properties,
        };
      } finally {
        await session.close();
      }
    });
  }

  async updateNode(id: NodeId, properties: Partial<NodeProperties>): Promise<boolean> {
    this.checkConnection();

    // idプロパティの更新を拒否
    if ('id' in properties) {
      throw new Error('Cannot update "id" property');
    }

    return await this.executeWithRetry(async () => {
      const session = this.driver.session({ database: this.database });
      try {
        // SET n += $props で部分更新を実行
        const result = await session.run('MATCH (n {id: $id}) SET n += $props RETURN n', {
          id,
          props: properties,
        });

        return result.records.length > 0;
      } finally {
        await session.close();
      }
    });
  }

  async deleteNode(id: NodeId): Promise<boolean> {
    this.checkConnection();

    return await this.executeWithRetry(async () => {
      const session = this.driver.session({ database: this.database });
      try {
        // DETACH DELETE でノードとその関連するエッジを削除
        const result = await session.run(
          'MATCH (n {id: $id}) DETACH DELETE n RETURN count(n) AS count',
          {
            id,
          }
        );

        const count = result.records[0]?.get('count');
        return count && count.toNumber() > 0;
      } finally {
        await session.close();
      }
    });
  }

  async executeTransaction<T>(work: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
    this.checkConnection();

    return await this.executeWithRetry(async () => {
      const session = this.driver.session({ database: this.database });
      try {
        return await session.executeWrite(work);
      } finally {
        await session.close();
      }
    });
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      await this.driver.close();
    }
  }

  // タスク6.2: 関係性の管理とグラフトラバーサル

  /**
   * リレーションシップIDを生成 (Neo4jの内部IDではなく、UUIDベースのカスタムID)
   */
  private generateEdgeId(from: NodeId, to: NodeId, type: string): EdgeId {
    // ノードIDとタイプからハッシュベースのIDを生成
    return `${from}-${type}-${to}`;
  }

  async createRelationship(
    from: NodeId,
    to: NodeId,
    type: string,
    properties?: RelationshipProperties
  ): Promise<EdgeId> {
    this.checkConnection();

    const edgeId = this.generateEdgeId(from, to, type);
    const props = properties || {};

    await this.executeWithRetry(async () => {
      const session = this.driver.session({ database: this.database });
      try {
        await session.run(
          `
          MATCH (a {id: $from}), (b {id: $to})
          CREATE (a)-[r:${type} $props]->(b)
          SET r.edgeId = $edgeId
          RETURN r
          `,
          {
            from,
            to,
            props,
            edgeId,
          }
        );
      } finally {
        await session.close();
      }
    });

    return edgeId;
  }

  async getRelationship(id: EdgeId): Promise<Relationship | null> {
    this.checkConnection();

    return await this.executeWithRetry(async () => {
      const session = this.driver.session({ database: this.database });
      try {
        const result = await session.run(
          `
          MATCH (a)-[r]->(b)
          WHERE r.edgeId = $edgeId
          RETURN r, type(r) AS relType, a.id AS fromId, b.id AS toId
          `,
          { edgeId: id }
        );

        if (result.records.length === 0) {
          return null;
        }

        const record = result.records[0];
        if (!record) {
          return null;
        }

        const rel = record.get('r');
        const relType = record.get('relType');
        const fromId = record.get('fromId');
        const toId = record.get('toId');

        return {
          id,
          fromNodeId: fromId,
          toNodeId: toId,
          type: relType,
          properties: rel.properties,
        };
      } finally {
        await session.close();
      }
    });
  }

  async getNodeRelationships(
    nodeId: NodeId,
    direction: 'outgoing' | 'incoming' | 'both' = 'both',
    type?: string
  ): Promise<Relationship[]> {
    this.checkConnection();

    return await this.executeWithRetry(async () => {
      const session = this.driver.session({ database: this.database });
      try {
        let query = '';
        if (direction === 'outgoing') {
          query = type
            ? `MATCH (n {id: $nodeId})-[r:${type}]->(m) RETURN r, type(r) AS relType, n.id AS fromId, m.id AS toId`
            : `MATCH (n {id: $nodeId})-[r]->(m) RETURN r, type(r) AS relType, n.id AS fromId, m.id AS toId`;
        } else if (direction === 'incoming') {
          query = type
            ? `MATCH (n {id: $nodeId})<-[r:${type}]-(m) RETURN r, type(r) AS relType, m.id AS fromId, n.id AS toId`
            : `MATCH (n {id: $nodeId})<-[r]-(m) RETURN r, type(r) AS relType, m.id AS fromId, n.id AS toId`;
        } else {
          // both
          query = type
            ? `
            MATCH (n {id: $nodeId})-[r:${type}]-(m)
            RETURN r, type(r) AS relType,
                   CASE WHEN startNode(r).id = $nodeId THEN endNode(r).id ELSE startNode(r).id END AS otherId,
                   startNode(r).id AS fromId,
                   endNode(r).id AS toId
            `
            : `
            MATCH (n {id: $nodeId})-[r]-(m)
            RETURN r, type(r) AS relType,
                   CASE WHEN startNode(r).id = $nodeId THEN endNode(r).id ELSE startNode(r).id END AS otherId,
                   startNode(r).id AS fromId,
                   endNode(r).id AS toId
            `;
        }

        const result = await session.run(query, { nodeId });

        return result.records.map((record) => {
          const rel = record.get('r');
          const relType = record.get('relType');
          const fromId = record.get('fromId');
          const toId = record.get('toId');

          return {
            id: rel.properties.edgeId || this.generateEdgeId(fromId, toId, relType),
            fromNodeId: fromId,
            toNodeId: toId,
            type: relType,
            properties: rel.properties,
          };
        });
      } finally {
        await session.close();
      }
    });
  }

  async deleteRelationship(id: EdgeId): Promise<boolean> {
    this.checkConnection();

    return await this.executeWithRetry(async () => {
      const session = this.driver.session({ database: this.database });
      try {
        const result = await session.run(
          `
          MATCH ()-[r]->()
          WHERE r.edgeId = $edgeId
          DELETE r
          RETURN count(r) AS count
          `,
          { edgeId: id }
        );

        const count = result.records[0]?.get('count');
        return count && count.toNumber() > 0;
      } finally {
        await session.close();
      }
    });
  }

  async traverseGraph(
    startNode: NodeId,
    pattern: CypherPattern,
    params?: Record<string, unknown>
  ): Promise<GraphResult[]> {
    this.checkConnection();

    return await this.executeWithRetry(async () => {
      const session = this.driver.session({ database: this.database });
      try {
        // Cypherクエリを構築
        const query = `
          MATCH path = (start {id: $startNodeId})${pattern}(end)
          RETURN nodes(path) AS nodes, relationships(path) AS rels
        `;

        const result = await session.run(query, {
          startNodeId: startNode,
          ...(params || {}),
        });

        return result.records.map((record) => {
          const nodes = record.get('nodes');
          const rels = record.get('rels');

          return {
            nodes: nodes.map((n: any) => ({
              id: n.properties.id,
              labels: n.labels,
              properties: n.properties,
            })),
            relationships: rels.map((r: any) => ({
              id: r.properties.edgeId || '',
              fromNodeId: r.start.properties?.id || '',
              toNodeId: r.end.properties?.id || '',
              type: r.type,
              properties: r.properties,
            })),
          };
        });
      } finally {
        await session.close();
      }
    });
  }

  async findShortestPath(from: NodeId, to: NodeId, maxDepth: number = 5): Promise<Path | null> {
    this.checkConnection();

    return await this.executeWithRetry(async () => {
      const session = this.driver.session({ database: this.database });
      try {
        const result = await session.run(
          `
          MATCH path = shortestPath((start {id: $from})-[*1..${maxDepth}]-(end {id: $to}))
          RETURN nodes(path) AS nodes, relationships(path) AS rels, length(path) AS pathLength
          `,
          { from, to }
        );

        if (result.records.length === 0) {
          return null;
        }

        const record = result.records[0];
        if (!record) {
          return null;
        }

        const nodes = record.get('nodes');
        const rels = record.get('rels');
        const pathLength = record.get('pathLength');

        return {
          nodes: nodes.map((n: any) => ({
            id: n.properties.id,
            labels: n.labels,
            properties: n.properties,
          })),
          relationships: rels.map((r: any) => ({
            id: r.properties.edgeId || '',
            fromNodeId: r.start.properties?.id || '',
            toNodeId: r.end.properties?.id || '',
            type: r.type,
            properties: r.properties,
          })),
          length: pathLength.toNumber(),
        };
      } finally {
        await session.close();
      }
    });
  }

  async calculateCentrality(nodeId: NodeId): Promise<number> {
    this.checkConnection();

    return await this.executeWithRetry(async () => {
      const session = this.driver.session({ database: this.database });
      try {
        // 次数中心性 (Degree Centrality) を計算
        // ノードの次数 (接続されているエッジ数) を全ノードの最大次数で正規化
        // 2段階のクエリで集約関数のネストを回避
        const degreeResult = await session.run(
          `
          MATCH (n {id: $nodeId})
          OPTIONAL MATCH (n)-[r]-()
          RETURN count(DISTINCT r) AS degree
          `,
          { nodeId }
        );

        if (degreeResult.records.length === 0) {
          return 0;
        }

        const degree = degreeResult.records[0]?.get('degree');
        const degreeNum = typeof degree === 'number' ? degree : degree?.toNumber?.() || 0;

        // 最大次数を取得
        const maxDegreeResult = await session.run(`
          MATCH (n)
          OPTIONAL MATCH (n)-[r]-()
          WITH n, count(DISTINCT r) AS nodeDegree
          RETURN max(nodeDegree) AS maxDegree
        `);

        const maxDegree = maxDegreeResult.records[0]?.get('maxDegree');
        const maxDegreeNum =
          typeof maxDegree === 'number' ? maxDegree : maxDegree?.toNumber?.() || 0;

        if (maxDegreeNum === 0) {
          return 0;
        }

        return degreeNum / maxDegreeNum;
      } finally {
        await session.close();
      }
    });
  }

  async findCommunities(): Promise<Community[]> {
    this.checkConnection();

    return await this.executeWithRetry(async () => {
      const session = this.driver.session({ database: this.database });
      try {
        // 簡易的なコミュニティ検出: 連結成分を検出
        // 本格的な実装には Neo4j Graph Data Science ライブラリが必要だが、
        // 基本的な連結成分分析でコミュニティを近似
        const result = await session.run(`
          MATCH (n)
          OPTIONAL MATCH path = (n)-[*]-(m)
          WITH n, collect(DISTINCT m.id) AS connectedIds
          WITH n.id AS nodeId, connectedIds + [n.id] AS allIds
          WITH allIds
          ORDER BY size(allIds) DESC
          WITH collect(DISTINCT allIds) AS communities
          UNWIND range(0, size(communities)-1) AS idx
          RETURN idx AS communityId, communities[idx] AS memberIds, size(communities[idx]) AS size
        `);

        return result.records.map((record) => ({
          id: `community-${record.get('communityId')}`,
          memberIds: record.get('memberIds'),
          size: record.get('size').toNumber(),
        }));
      } finally {
        await session.close();
      }
    });
  }
}
