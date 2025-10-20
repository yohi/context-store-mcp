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
}
