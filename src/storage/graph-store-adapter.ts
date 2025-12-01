/**
 * グラフストアアダプター
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
import { randomUUID } from 'crypto';

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
 * Cypherパターンビルダーの結果型
 * 内部的にバリデーション済みのCypherパターンとパラメータを保持
 */
export interface ValidatedCypherPattern {
  /** バリデーション済みのパターン文字列 (内部使用のみ) */
  readonly pattern: string;
  /** パラメータ化されたクエリパラメータ */
  readonly parameters: Record<string, unknown>;
}

/**
 * Cypherパターンビルダー
 * Cypherインジェクション防止のため、安全なAPIでパターンを構築
 *
 * 使用例:
 * ```typescript
 * const pattern = new CypherPatternBuilder()
 *   .relationship('REFERENCES', 'outgoing')
 *   .nodeLabel('Memory')
 *   .where({ type: 'semantic' })
 *   .maxDepth(3)
 *   .build();
 * ```
 */
export class CypherPatternBuilder {
  private relationshipType?: string;
  private direction: 'outgoing' | 'incoming' | 'both' = 'both';
  private nodeLabels: string[] = [];
  private whereConditions: Record<string, unknown> = {};
  private minDepthValue: number = 1;
  private maxDepthValue: number = 5;

  /**
   * リレーションシップタイプを設定
   * @param type リレーションシップタイプ (例: 'REFERENCES', 'DERIVED_FROM')
   * @param direction リレーションシップの方向 (デフォルト: 'both')
   * @returns このビルダー (メソッドチェーン用)
   */
  relationship(type: string, direction: 'outgoing' | 'incoming' | 'both' = 'both'): this {
    if (!this.isValidIdentifier(type)) {
      throw new Error(
        `Invalid relationship type: "${type}". Must contain only letters, numbers, and underscores, and start with a letter or underscore.`
      );
    }
    this.relationshipType = type;
    this.direction = direction;
    return this;
  }

  /**
   * ノードラベルを追加
   * @param label ノードラベル (例: 'Memory', 'Episodic')
   * @returns このビルダー (メソッドチェーン用)
   */
  nodeLabel(label: string): this {
    if (!this.isValidIdentifier(label)) {
      throw new Error(
        `Invalid node label: "${label}". Must contain only letters, numbers, and underscores, and start with a letter or underscore.`
      );
    }
    this.nodeLabels.push(label);
    return this;
  }

  /**
   * WHERE条件を追加 (プロパティフィルタ)
   * @param conditions プロパティ名と値のマッピング
   * @returns このビルダー (メソッドチェーン用)
   */
  where(conditions: Record<string, unknown>): this {
    for (const key of Object.keys(conditions)) {
      if (!this.isValidIdentifier(key)) {
        throw new Error(
          `Invalid property name in WHERE clause: "${key}". Must contain only letters, numbers, and underscores, and start with a letter or underscore.`
        );
      }
    }
    this.whereConditions = { ...this.whereConditions, ...conditions };
    return this;
  }

  /**
   * 最大探索深度を設定
   * @param max 最大深度 (1-15、デフォルト: 5)
   * @returns このビルダー (メソッドチェーン用)
   */
  maxDepth(max: number): this {
    if (!Number.isInteger(max) || max < 1 || max > 15) {
      throw new Error('maxDepth must be an integer between 1 and 15');
    }
    this.maxDepthValue = max;
    return this;
  }

  /**
   * 最小探索深度を設定
   * @param min 最小深度 (1-15、デフォルト: 1)
   * @returns このビルダー (メソッドチェーン用)
   */
  minDepth(min: number): this {
    if (!Number.isInteger(min) || min < 1 || min > 15) {
      throw new Error('minDepth must be an integer between 1 and 15');
    }
    this.minDepthValue = min;
    return this;
  }

  /**
   * 識別子 (ラベル、プロパティ名、リレーションシップタイプ) が安全かどうかを検証
   * Cypherインジェクション防止のため、ホワイトリスト方式で検証
   */
  private isValidIdentifier(identifier: string): boolean {
    // Cypher仕様に準拠: 先頭は英字またはアンダースコア、2文字目以降は英数字またはアンダースコア
    const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
    return SAFE_IDENTIFIER_PATTERN.test(identifier);
  }

  /**
   * バリデーション済みのCypherパターンを構築
   * @returns パターン文字列とパラメータを含む検証済みオブジェクト
   */
  build(): ValidatedCypherPattern {
    // 深度の境界検証: minDepthがmaxDepthより大きい場合は失敗
    if (this.minDepthValue > this.maxDepthValue) {
      throw new Error(
        `minDepthValue (${this.minDepthValue}) cannot be greater than maxDepthValue (${this.maxDepthValue})`
      );
    }

    // パターン文字列を構築
    let pattern = '';

    // リレーションシップの方向と深度
    const depthRange = `${this.minDepthValue}..${this.maxDepthValue}`;

    if (this.relationshipType) {
      // リレーションシップタイプが指定されている場合
      if (this.direction === 'outgoing') {
        pattern = `-[:${this.relationshipType}*${depthRange}]->`;
      } else if (this.direction === 'incoming') {
        pattern = `<-[:${this.relationshipType}*${depthRange}]-`;
      } else {
        // both
        pattern = `-[:${this.relationshipType}*${depthRange}]-`;
      }
    } else {
      // リレーションシップタイプが指定されていない場合
      if (this.direction === 'outgoing') {
        pattern = `-[*${depthRange}]->`;
      } else if (this.direction === 'incoming') {
        pattern = `<-[*${depthRange}]-`;
      } else {
        // both
        pattern = `-[*${depthRange}]-`;
      }
    }

    // ノードラベル (エイリアス "end" を追加してWHERE句で参照可能にする)
    if (this.nodeLabels.length > 0) {
      const labelStr = this.nodeLabels.map((l) => `:${l}`).join('');
      pattern += `(end${labelStr})`;
    } else {
      pattern += '(end)';
    }

    // パラメータを構築 (WHERE条件)
    const parameters = { ...this.whereConditions };

    return {
      pattern,
      parameters,
    };
  }
}

/**
 * @deprecated CypherPatternは非推奨です。代わりにCypherPatternBuilderを使用してください。
 * セキュリティ上の理由により、文字列ベースのパターンは将来のバージョンで削除されます。
 */
export type CypherPattern = string;

/**
 * グラフストアアダプター設定
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
 * グラフストアアダプターインターフェース
 *
 * design.md の GraphStoreAdapter インターフェースに準拠
 */
export interface IGraphStoreAdapter {
  /**
   * データベース制約を初期化
   *
   * edgeIdのユニーク制約を作成し、マルチエッジの一意性を保証します。
   *
   * @throws {Error} 制約の作成に失敗した場合
   */
  initializeConstraints(): Promise<void>;

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
   * @param pattern - ValidatedCypherPattern (CypherPatternBuilderで構築)
   * @param params - 追加のクエリパラメータ (オプション、非推奨)
   * @returns グラフトラバーサル結果
   *
   * @example
   * ```typescript
   * const pattern = new CypherPatternBuilder()
   *   .relationship('REFERENCES', 'outgoing')
   *   .nodeLabel('Memory')
   *   .maxDepth(3)
   *   .build();
   *
   * const results = await adapter.traverseGraph(startNodeId, pattern);
   * ```
   */
  traverseGraph(
    startNode: NodeId,
    pattern: ValidatedCypherPattern,
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
   * コミュニティ検出 (連結成分ベースの簡易コミュニティ検出)
   *
   * 注: 本格的なコミュニティ検出（Louvainアルゴリズムなど）には
   * Neo4j Graph Data Science ライブラリが必要です。
   * 現在の実装は連結成分分析でコミュニティを近似します。
   *
   * @returns コミュニティの配列
   */
  findCommunities(): Promise<Community[]>;
}

/**
 * グラフストアアダプター実装
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
   * データベース制約を初期化
   *
   * edgeIdのユニーク制約を作成し、マルチエッジの一意性を保証します。
   * この制約により、同じedgeIdを持つリレーションシップは作成できなくなります。
   *
   * @throws {Error} 制約の作成に失敗した場合
   */
  async initializeConstraints(): Promise<void> {
    this.checkConnection();

    await this.executeWithRetry(async () => {
      const session = this.driver.session({ database: this.database });
      try {
        // edgeIdプロパティのユニーク制約を作成
        // Neo4j 4.4+ では FOR ()-[r]-() 構文を使用
        await session.run(`
          CREATE CONSTRAINT edgeId_unique IF NOT EXISTS
          FOR ()-[r]-()
          REQUIRE r.edgeId IS UNIQUE
        `);

        console.info('Database constraints initialized successfully');
      } catch (error) {
        // Neo4j 4.3以前のバージョン向けの後方互換性処理
        // 4.4未満ではリレーションシップのユニーク制約は未サポート
        if (error instanceof Error && error.message.includes('Relationship uniqueness constraints')) {
          console.warn(
            'Neo4j version does not support relationship uniqueness constraints. ' +
            'Upgrade to Neo4j 4.4+ for full edgeId uniqueness enforcement.'
          );
        } else {
          throw error;
        }
      } finally {
        await session.close();
      }
    });
  }

  /**
   * ラベル名が安全かどうかを検証
   * Cypherインジェクション防止のため、ホワイトリスト方式で検証
   * 有効なラベル: 英数字とアンダースコア、先頭は英字またはアンダースコア
   *
   * @param label 検証するラベル名
   * @returns ラベルが安全な場合true
   */
  private isValidLabel(label: string): boolean {
    // Cypher仕様に準拠: 先頭は英字またはアンダースコア、2文字目以降は英数字またはアンダースコア
    const SAFE_LABEL_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
    return SAFE_LABEL_PATTERN.test(label);
  }

  /**
   * リレーションシップタイプが安全かどうかを検証
   * Cypherインジェクション防止のため、ホワイトリスト方式で検証
   *
   * Neo4j のリレーションシップタイプ命名規則:
   * - 大文字英字、数字、アンダースコアのみ許可
   * - 慣例として大文字スネークケース（例: REFERENCES, DERIVED_FROM）
   *
   * @param type 検証するリレーションシップタイプ
   * @returns タイプが安全な場合true
   * @throws {Error} 不正なリレーションシップタイプの場合
   */
  private validateRelationshipType(type: string): void {
    // リレーションシップタイプの形式: 大文字英字、数字、アンダースコアのみ
    const SAFE_TYPE_PATTERN = /^[A-Z0-9_]+$/;

    if (!type || type.length === 0) {
      throw new Error('Relationship type cannot be empty');
    }

    if (!SAFE_TYPE_PATTERN.test(type)) {
      throw new Error(
        `Invalid relationship type: "${type}". ` +
        'Relationship types must contain only uppercase letters, numbers, and underscores (e.g., REFERENCES, DERIVED_FROM)'
      );
    }

    // 長さ制限（Neo4jの実用的な制限）
    if (type.length > 100) {
      throw new Error(`Relationship type too long: ${type.length} characters (max 100)`);
    }
  }

  /**
   * ノードラベルをCypherクエリ用の文字列に変換
   * Cypherインジェクション防止のため、ラベルを検証してから変換
   *
   * @param label ラベル名（文字列または文字列配列）
   * @returns Cypher形式のラベル文字列（例: `:Memory:Episodic`）
   * @throws {Error} 不正なラベルが含まれている場合
   */
  private formatLabels(label: string | string[]): string {
    const labels = Array.isArray(label) ? label : [label];

    // すべてのラベルを検証
    for (const l of labels) {
      if (!this.isValidLabel(l)) {
        throw new Error(
          `Invalid label: "${l}". Labels must start with a letter or underscore, ` +
          `and contain only letters, numbers, and underscores.`
        );
      }
    }

    // 検証済みのラベルを安全に結合
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

  /**
   * Neo4jクエリに渡す前にプロパティをサニタイズ
   * undefined, null, NaN などの非シリアライズ可能な値を除去
   */
  private sanitizeProperties<T extends Record<string, unknown>>(properties: T): Partial<T> {
    const sanitized: Partial<T> = {};

    for (const [key, value] of Object.entries(properties)) {
      // undefined, null, NaN を除外
      if (value === undefined || value === null || (typeof value === 'number' && isNaN(value))) {
        continue;
      }
      sanitized[key as keyof T] = value as T[keyof T];
    }

    return sanitized;
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
        // プロパティをサニタイズしてから formatProperties に渡す
        const sanitizedProps = this.sanitizeProperties(properties);
        const props = this.formatProperties(sanitizedProps as NodeProperties);

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
        // プロパティをサニタイズしてから Neo4j に渡す
        const sanitizedProps = this.sanitizeProperties(properties);

        // SET n += $props で部分更新を実行
        const result = await session.run('MATCH (n {id: $id}) SET n += $props RETURN n', {
          id,
          props: sanitizedProps,
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
        // 削除前にカウントを取得してから削除を実行
        const result = await session.run(
          'MATCH (n {id: $id}) WITH count(n) AS cnt, collect(n) AS nodes WHERE cnt > 0 FOREACH (node IN nodes | DETACH DELETE node) RETURN cnt',
          {
            id,
          }
        );

        const cnt = result.records[0]?.get('cnt');
        return cnt ? cnt.toNumber() > 0 : false;
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
   *
   * マルチエッジ（同じノード間・同じタイプで複数のエッジ）をサポートするため、
   * 真のユニークIDとしてUUID v4を生成します。
   */
  private generateEdgeId(): EdgeId {
    return randomUUID();
  }

  async createRelationship(
    from: NodeId,
    to: NodeId,
    type: string,
    properties?: RelationshipProperties
  ): Promise<EdgeId> {
    this.checkConnection();

    // 1. リレーションシップタイプの検証（Cypherインジェクション防止）
    this.validateRelationshipType(type);

    // 2. プロパティのサニタイズ
    const sanitizedProps = properties ? this.sanitizeProperties(properties) : {};

    // 3. UUID生成
    const edgeId = this.generateEdgeId();

    await this.executeWithRetry(async () => {
      const session = this.driver.session({ database: this.database });
      try {
        // 4. 両ノードの存在確認
        const checkResult = await session.run(
          `
          OPTIONAL MATCH (a {id: $from})
          OPTIONAL MATCH (b {id: $to})
          RETURN a IS NOT NULL AS fromExists, b IS NOT NULL AS toExists
          `,
          { from, to }
        );

        const record = checkResult.records[0];
        if (!record) {
          throw new Error('Failed to check node existence');
        }

        const fromExists = record.get('fromExists');
        const toExists = record.get('toExists');



        if (!fromExists && !toExists) {
          throw new Error(`Both nodes not found: from="${from}", to="${to}"`);
        }
        if (!fromExists) {
          throw new Error(`Source node not found: "${from}"`);
        }
        if (!toExists) {
          throw new Error(`Target node not found: "${to}"`);
        }

        // 5. リレーションシップ作成（検証済みtypeを補間、プロパティはパラメータ化）
        await session.run(
          `
          MATCH (a {id: $from}), (b {id: $to})
          CREATE (a)-[r:${type}]->(b)
          SET r = $props, r.edgeId = $edgeId
          RETURN r
          `,
          {
            from,
            to,
            props: sanitizedProps,
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
             OR ((r.edgeId IS NULL OR r.edgeId = '') AND elementId(r) = $edgeId)
          RETURN r, type(r) AS relType, a.id AS fromId, b.id AS toId
          LIMIT 1
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

    // リレーションシップタイプが指定されている場合は検証
    if (type !== undefined) {
      this.validateRelationshipType(type);
    }

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
          // both - otherId列を削除（未使用のため）
          query = type
            ? `
            MATCH (n {id: $nodeId})-[r:${type}]-(m)
            RETURN r, type(r) AS relType,
                   startNode(r).id AS fromId,
                   endNode(r).id AS toId
            `
            : `
            MATCH (n {id: $nodeId})-[r]-(m)
            RETURN r, type(r) AS relType,
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

          // すべてのエッジにはedgeIdプロパティが必須（UUID v4）
          // 存在しない場合は古いデータなので警告を出し、elementIdをフォールバックとして使用
          let edgeId = rel.properties.edgeId;
          if (!edgeId) {
            console.warn(
              `Legacy edge without edgeId detected: ${fromId} -[${relType}]-> ${toId}. ` +
              `Using elementId as fallback. Please migrate data.`
            );
            edgeId = rel.elementId;
          }

          return {
            id: edgeId,
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
        // 削除前にマッチ数をカウントし、その後削除する
        // edgeIdプロパティが存在する場合はそれでマッチング
        // edgeIdが存在しない（nullまたは空文字列）場合はelementIdでマッチング
        const result = await session.run(
          `
          MATCH ()-[r]->()
          WHERE r.edgeId = $edgeId
             OR ((r.edgeId IS NULL OR r.edgeId = '') AND elementId(r) = $edgeId)
          WITH count(r) AS cnt
          MATCH ()-[r]->()
          WHERE r.edgeId = $edgeId
             OR ((r.edgeId IS NULL OR r.edgeId = '') AND elementId(r) = $edgeId)
          DELETE r
          RETURN cnt
          `,
          { edgeId: id }
        );

        const count = result.records[0]?.get('cnt');
        // Neo4j Integerを数値に変換し、削除されたエッジが1件以上ならtrueを返す
        return count ? (typeof count.toNumber === 'function' ? count.toNumber() : Number(count)) > 0 : false;
      } finally {
        await session.close();
      }
    });
  }

  async traverseGraph(
    startNode: NodeId,
    pattern: ValidatedCypherPattern,
    params?: Record<string, unknown>
  ): Promise<GraphResult[]> {
    this.checkConnection();

    return await this.executeWithRetry(async () => {
      const session = this.driver.session({ database: this.database });
      try {
        // ValidatedCypherPatternからパターン文字列とパラメータを取得
        const { pattern: patternStr, parameters: patternParams } = pattern;

        // パターンの検証（空または疑わしいパターンを拒否）
        if (!patternStr || patternStr.trim().length === 0) {
          throw new Error('Cypher pattern cannot be empty');
        }
        // 危険なCypherコマンドをチェック（基本的な検証）
        const suspiciousPatterns = /\b(DELETE|DROP|CREATE|SET|REMOVE|MERGE)\b/i;
        if (suspiciousPatterns.test(patternStr)) {
          throw new Error('Cypher pattern contains potentially unsafe operations');
        }

        // WHERE句を構築 (パターンのパラメータがある場合)
        let whereClause = '';
        const queryParams: Record<string, unknown> = {
          startNodeId: startNode,
          ...(params || {}),
        };

        if (Object.keys(patternParams).length > 0) {
          const whereConditions = Object.keys(patternParams).map((key) => {
            const paramName = `where_${key}`;
            queryParams[paramName] = patternParams[key];
            return `end.${key} = $${paramName}`;
          });
          whereClause = `WHERE ${whereConditions.join(' AND ')}`;
        }

        // Cypherクエリを構築 (パラメータ化されたクエリ)
        const query = `
          MATCH path = (start {id: $startNodeId})${patternStr}
          ${whereClause}
          RETURN nodes(path) AS nodes, relationships(path) AS rels
        `;

        const result = await session.run(query, queryParams);

        return result.records.map((record) => {
          const nodes = record.get('nodes');
          const rels = record.get('rels');

          // elementIdからノードIDへのマッピングを構築
          const elementIdToNodeId = new Map<string, string>();
          nodes.forEach((n: any) => {
            if (n.elementId && n.properties.id) {
              elementIdToNodeId.set(n.elementId, n.properties.id);
            }
          });

          return {
            nodes: nodes.map((n: any) => ({
              id: n.properties.id,
              labels: n.labels,
              properties: n.properties,
            })),
            relationships: rels.map((r: any) => {
              // Neo4j driver v5ではr.startNodeElementIdとr.endNodeElementIdを使用
              const fromNodeId = elementIdToNodeId.get(r.startNodeElementId) || '';
              const toNodeId = elementIdToNodeId.get(r.endNodeElementId) || '';

              // edgeIdプロパティが存在しない場合はelementIdをフォールバックとして使用
              // (getNodeRelationshipsと同じロジック)
              let edgeId = r.properties.edgeId;
              if (!edgeId) {
                edgeId = r.elementId || '';
              }

              return {
                id: edgeId,
                fromNodeId,
                toNodeId,
                type: r.type,
                properties: r.properties,
              };
            }),
          };
        });
      } finally {
        await session.close();
      }
    });
  }

  async findShortestPath(from: NodeId, to: NodeId, maxDepth: number = 5): Promise<Path | null> {
    this.checkConnection();

    // maxDepthのバリデーション: 正の整数、1-100の範囲に制限
    const depth = Number.isInteger(maxDepth) && maxDepth > 0 && maxDepth <= 100 ? maxDepth : 5;

    return await this.executeWithRetry(async () => {
      const session = this.driver.session({ database: this.database });
      try {
        const result = await session.run(
          `
          MATCH path = shortestPath((start {id: $from})-[*1..${depth}]-(end {id: $to}))
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

        // elementIdからノードIDへのマッピングを構築（traverseGraphと同じ方法）
        const elementIdToNodeId = new Map<string, string>();
        nodes.forEach((n: any) => {
          if (n.elementId && n.properties.id) {
            elementIdToNodeId.set(n.elementId, n.properties.id);
          }
        });

        return {
          nodes: nodes.map((n: any) => ({
            id: n.properties.id,
            labels: n.labels,
            properties: n.properties,
          })),
          relationships: rels.map((r: any) => {
            // Neo4j driver v5ではr.startNodeElementIdとr.endNodeElementIdを使用
            const fromNodeId = elementIdToNodeId.get(r.startNodeElementId) || '';
            const toNodeId = elementIdToNodeId.get(r.endNodeElementId) || '';

            // edgeIdプロパティが存在しない場合はelementIdをフォールバックとして使用
            // (getNodeRelationships, traverseGraphと同じロジック)
            let edgeId = r.properties.edgeId;
            if (!edgeId) {
              edgeId = r.elementId || '';
            }

            return {
              id: edgeId,
              fromNodeId,
              toNodeId,
              type: r.type,
              properties: r.properties,
            };
          }),
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
        //
        // APOCなし環境のため、UNWIND + ORDER BY + COLLECTでmemberIdsをソートし、
        // コミュニティIDと memberIds の安定化を実現
        const result = await session.run(`
          MATCH (n)
          OPTIONAL MATCH path = (n)-[*]-(m)
          WITH n, collect(DISTINCT m.id) AS connectedIds
          WITH n.id AS nodeId, connectedIds + [n.id] AS allIds
          UNWIND allIds AS memberId
          WITH allIds, memberId
          ORDER BY memberId
          WITH allIds, collect(memberId) AS memberIds
          WITH memberIds
          ORDER BY size(memberIds) DESC, memberIds
          WITH collect(memberIds) AS allCommunities
          WITH reduce(communities = [], idx IN range(0, size(allCommunities)-1) |
            CASE WHEN NOT allCommunities[idx] IN communities
              THEN communities + [allCommunities[idx]]
              ELSE communities
            END
          ) AS uniqueCommunities
          UNWIND range(0, size(uniqueCommunities)-1) AS idx
          RETURN idx AS communityId, uniqueCommunities[idx] AS memberIds, size(uniqueCommunities[idx]) AS size
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
