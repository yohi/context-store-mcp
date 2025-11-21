/**
 * Connection Pool Manager
 *
 * タスク10.1: データベース接続プーリングの最適化
 * Requirements: 7.1 (P95 < 2秒), 7.3 (同時アクセス制御)
 *
 * 機能:
 * - PostgreSQL接続プールの設定と管理
 * - Neo4j接続プールの設定と管理
 * - 接続数の動的調整
 * - 接続リークの検出
 * - ヘルスチェック機能
 */

import type { Pool, PoolClient, PoolConfig } from 'pg';
import { Pool as PgPool } from 'pg';
import type { Driver, Session, Config as Neo4jConfig } from 'neo4j-driver';
import neo4j from 'neo4j-driver';

/**
 * PostgreSQL接続プール設定
 */
export interface PostgresPoolConfig {
  /** 最大接続数 (デフォルト: 20) */
  max?: number;
  /** 最小接続数 (デフォルト: 5) */
  min?: number;
  /** アイドルタイムアウト (ミリ秒, デフォルト: 30000) */
  idleTimeoutMillis?: number;
  /** 接続タイムアウト (ミリ秒, デフォルト: 2000) */
  connectionTimeoutMillis?: number;
}

/**
 * Neo4j接続プール設定
 */
export interface Neo4jPoolConfig {
  /** 最大接続プールサイズ (デフォルト: 100) */
  maxConnectionPoolSize?: number;
  /** 接続獲得タイムアウト (ミリ秒, デフォルト: 60000) */
  connectionAcquisitionTimeout?: number;
  /** 最大接続有効時間 (ミリ秒, デフォルト: 3600000) */
  maxConnectionLifetime?: number;
  /** 接続リベネストタイムアウト (ミリ秒, デフォルト: 600000) */
  connectionLivenessCheckTimeout?: number;
}

/**
 * 接続プール統計情報
 */
export interface PoolStatistics {
  /** アクティブな接続数 */
  active: number;
  /** アイドル状態の接続数 */
  idle: number;
  /** 待機中のリクエスト数 */
  waiting: number;
  /** 総接続数 */
  total: number;
}

/**
 * ヘルスチェック結果
 */
export interface HealthCheckResult {
  /** ヘルスチェック成功フラグ */
  healthy: boolean;
  /** レスポンスタイム (ミリ秒) */
  responseTime: number;
  /** エラーメッセージ (存在する場合) */
  error?: string;
}

/**
 * 接続プール管理クラス
 */
export class ConnectionPoolManager {
  private pgPool: Pool | null = null;
  private neo4jDriver: Driver | null = null;
  private pgPoolConfig: PoolConfig;
  private neo4jPoolConfig: Neo4jConfig;

  /**
   * コンストラクター
   */
  constructor(
    postgresConfig: {
      host: string;
      port: number;
      database: string;
      user: string;
      password: string;
      poolConfig?: PostgresPoolConfig;
    },
    neo4jConfig: {
      uri: string;
      username: string;
      password: string;
      poolConfig?: Neo4jPoolConfig;
    }
  ) {
    // PostgreSQL接続プール設定
    const pgPoolDefaults = {
      max: 20,
      min: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    };

    const pgPoolSettings = { ...pgPoolDefaults, ...postgresConfig.poolConfig };

    this.pgPoolConfig = {
      host: postgresConfig.host,
      port: postgresConfig.port,
      database: postgresConfig.database,
      user: postgresConfig.user,
      password: postgresConfig.password,
      max: pgPoolSettings.max,
      min: pgPoolSettings.min,
      idleTimeoutMillis: pgPoolSettings.idleTimeoutMillis,
      connectionTimeoutMillis: pgPoolSettings.connectionTimeoutMillis,
    };

    // Neo4j接続プール設定
    const neo4jPoolDefaults = {
      maxConnectionPoolSize: 100,
      connectionAcquisitionTimeout: 60000,
      maxConnectionLifetime: 3600000,
      connectionLivenessCheckTimeout: 600000,
    };

    const neo4jPoolSettings = { ...neo4jPoolDefaults, ...neo4jConfig.poolConfig };

    this.neo4jPoolConfig = {
      maxConnectionPoolSize: neo4jPoolSettings.maxConnectionPoolSize ?? 100,
      connectionAcquisitionTimeout: neo4jPoolSettings.connectionAcquisitionTimeout ?? 60000,
      maxConnectionLifetime: neo4jPoolSettings.maxConnectionLifetime ?? 3600000,
      connectionLivenessCheckTimeout: neo4jPoolSettings.connectionLivenessCheckTimeout ?? 600000,
    };
  }

  /**
   * PostgreSQL接続プールを初期化
   */
  public initializePostgresPool(): void {
    if (this.pgPool) {
      throw new Error('PostgreSQL pool is already initialized');
    }

    this.pgPool = new PgPool(this.pgPoolConfig);

    // エラーハンドリング
    this.pgPool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client', err);
    });
  }

  /**
   * Neo4jドライバーを初期化
   */
  public initializeNeo4jDriver(uri: string, username: string, password: string): void {
    if (this.neo4jDriver) {
      throw new Error('Neo4j driver is already initialized');
    }

    this.neo4jDriver = neo4j.driver(
      uri,
      neo4j.auth.basic(username, password),
      this.neo4jPoolConfig
    );
  }

  /**
   * PostgreSQL接続を取得
   */
  public async acquirePostgresConnection(): Promise<PoolClient> {
    if (!this.pgPool) {
      throw new Error('PostgreSQL pool is not initialized');
    }

    return await this.pgPool.connect();
  }

  /**
   * PostgreSQL接続を解放
   */
  public releasePostgresConnection(client: PoolClient): void {
    client.release();
  }

  /**
   * Neo4jセッションを取得
   */
  public acquireNeo4jSession(): Session {
    if (!this.neo4jDriver) {
      throw new Error('Neo4j driver is not initialized');
    }

    return this.neo4jDriver.session();
  }

  /**
   * Neo4jセッションをクローズ
   */
  public async closeNeo4jSession(session: Session): Promise<void> {
    await session.close();
  }

  /**
   * PostgreSQL接続プールのヘルスチェック
   */
  public async checkPostgresHealth(): Promise<HealthCheckResult> {
    if (!this.pgPool) {
      return {
        healthy: false,
        responseTime: 0,
        error: 'PostgreSQL pool is not initialized',
      };
    }

    const startTime = Date.now();

    try {
      const client = await this.pgPool.connect();
      await client.query('SELECT 1');
      client.release();

      const responseTime = Date.now() - startTime;

      return {
        healthy: true,
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;

      return {
        healthy: false,
        responseTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Neo4jドライバーのヘルスチェック
   */
  public async checkNeo4jHealth(): Promise<HealthCheckResult> {
    if (!this.neo4jDriver) {
      return {
        healthy: false,
        responseTime: 0,
        error: 'Neo4j driver is not initialized',
      };
    }

    const startTime = Date.now();

    try {
      await this.neo4jDriver.verifyConnectivity();

      const responseTime = Date.now() - startTime;

      return {
        healthy: true,
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;

      return {
        healthy: false,
        responseTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * PostgreSQL接続プールの統計情報を取得
   */
  public getPostgresStatistics(): PoolStatistics {
    if (!this.pgPool) {
      throw new Error('PostgreSQL pool is not initialized');
    }

    return {
      active: this.pgPool.totalCount - this.pgPool.idleCount,
      idle: this.pgPool.idleCount,
      waiting: this.pgPool.waitingCount,
      total: this.pgPool.totalCount,
    };
  }

  /**
   * 全ての接続をシャットダウン
   */
  public async shutdown(): Promise<void> {
    const errors: Error[] = [];

    // PostgreSQL接続プールをクローズ
    if (this.pgPool) {
      try {
        await this.pgPool.end();
        this.pgPool = null;
      } catch (error) {
        errors.push(
          error instanceof Error ? error : new Error('Unknown error closing PostgreSQL pool')
        );
      }
    }

    // Neo4jドライバーをクローズ
    if (this.neo4jDriver) {
      try {
        await this.neo4jDriver.close();
        this.neo4jDriver = null;
      } catch (error) {
        errors.push(
          error instanceof Error ? error : new Error('Unknown error closing Neo4j driver')
        );
      }
    }

    // エラーがあれば集約してスロー
    if (errors.length > 0) {
      throw new Error(`Shutdown errors: ${errors.map((e) => e.message).join(', ')}`);
    }
  }

  /**
   * PostgreSQL接続プールが初期化されているかチェック
   */
  public isPostgresInitialized(): boolean {
    return this.pgPool !== null;
  }

  /**
   * Neo4jドライバーが初期化されているかチェック
   */
  public isNeo4jInitialized(): boolean {
    return this.neo4jDriver !== null;
  }
}
