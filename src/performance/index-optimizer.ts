/**
 * Index Optimizer
 *
 * タスク10.1: パフォーマンスチューニング - インデックスの最適化と再構築
 * Requirements: 7.1 (P95 < 2秒)
 *
 * 機能:
 * - PostgreSQL HNSWインデックス最適化
 * - Neo4jインデックス再構築
 * - インデックスヘルスモニタリング
 * - インデックス使用率監視
 * - 未使用インデックス検出
 * - インデックス肥大化検出と再構築
 */

import type { Pool as PgPool, QueryResult } from 'pg';
import type { Driver as Neo4jDriver, Session as Neo4jSession } from 'neo4j-driver';

/**
 * PostgreSQLインデックス情報
 */
export interface PostgresIndexInfo {
  schemaName: string;
  tableName: string;
  indexName: string;
  indexType: string;
  indexSize: number;
  indexScanCount: number;
  indexTupleReadCount: number;
  indexTupleFetchCount: number;
  isUnique: boolean;
  isPrimary: boolean;
  definition: string;
}

/**
 * Neo4jインデックス情報
 */
export interface Neo4jIndexInfo {
  name: string;
  labelsOrTypes: string[];
  properties: string[];
  type: string;
  state: string;
  populationPercent: number;
  uniqueness: string;
}

/**
 * HNSWインデックス設定
 */
export interface HNSWIndexConfig {
  m: number; // 最大接続数 (デフォルト16)
  efConstruction: number; // 構築時探索数 (デフォルト64)
}

/**
 * インデックスヘルス情報
 */
export interface IndexHealth {
  indexName: string;
  database: 'postgresql' | 'neo4j';
  health: 'healthy' | 'warning' | 'critical';
  usageRate: number; // 0-100
  bloatRatio: number; // 0-100
  recommendations: string[];
}

/**
 * インデックス統計情報
 */
export interface IndexStats {
  totalIndexes: number;
  healthyIndexes: number;
  warningIndexes: number;
  criticalIndexes: number;
  unusedIndexes: number;
  bloatedIndexes: number;
}

/**
 * IndexOptimizer設定
 */
export interface IndexOptimizerConfig {
  pgPool?: PgPool | null;
  neo4jDriver?: Neo4jDriver | null;
  unusedThreshold?: number; // インデックススキャン回数の閾値
  bloatThreshold?: number; // 肥大化率の閾値 (%)
  monitoringInterval?: number; // ミリ秒
}

/**
 * IndexOptimizerクラス
 */
export class IndexOptimizer {
  private pgPool: PgPool | null = null;
  private neo4jDriver: Neo4jDriver | null = null;
  private config: Required<Omit<IndexOptimizerConfig, 'pgPool' | 'neo4jDriver'>>;
  private monitoringTimer: NodeJS.Timeout | null = null;
  private indexHealthCache: Map<string, IndexHealth> = new Map();

  constructor(config: IndexOptimizerConfig) {
    this.pgPool = config.pgPool ?? null;
    this.neo4jDriver = config.neo4jDriver ?? null;
    this.config = {
      unusedThreshold: config.unusedThreshold ?? 10,
      bloatThreshold: config.bloatThreshold ?? 30,
      monitoringInterval: config.monitoringInterval ?? 3600000, // 1時間
    };
  }

  /**
   * モニタリングを開始
   */
  public startMonitoring(): void {
    this.monitoringTimer = setInterval(async () => {
      await this.analyzeIndexHealth();
    }, this.config.monitoringInterval);
  }

  /**
   * モニタリングを停止
   */
  public stopMonitoring(): void {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
  }

  /**
   * PostgreSQLのすべてのインデックス情報を取得
   */
  public async getPostgresIndexes(): Promise<PostgresIndexInfo[]> {
    if (!this.pgPool) {
      throw new Error('PostgreSQL pool not initialized');
    }

    const query = `
      SELECT
        schemaname AS schema_name,
        tablename AS table_name,
        indexname AS index_name,
        indexdef AS definition,
        pg_relation_size(indexrelid) AS index_size,
        idx_scan AS index_scan_count,
        idx_tup_read AS index_tuple_read_count,
        idx_tup_fetch AS index_tuple_fetch_count,
        indisunique AS is_unique,
        indisprimary AS is_primary
      FROM pg_stat_user_indexes
      JOIN pg_index ON pg_stat_user_indexes.indexrelid = pg_index.indexrelid
      ORDER BY index_size DESC
    `;

    const result: QueryResult = await this.pgPool.query(query);

    return result.rows.map((row) => ({
      schemaName: row.schema_name,
      tableName: row.table_name,
      indexName: row.index_name,
      indexType: this.extractIndexType(row.definition),
      indexSize: parseInt(row.index_size, 10),
      indexScanCount: parseInt(row.index_scan_count, 10),
      indexTupleReadCount: parseInt(row.index_tuple_read_count, 10),
      indexTupleFetchCount: parseInt(row.index_tuple_fetch_count, 10),
      isUnique: row.is_unique,
      isPrimary: row.is_primary,
      definition: row.definition,
    }));
  }

  /**
   * Neo4jのすべてのインデックス情報を取得
   */
  public async getNeo4jIndexes(): Promise<Neo4jIndexInfo[]> {
    if (!this.neo4jDriver) {
      throw new Error('Neo4j driver not initialized');
    }

    const session: Neo4jSession = this.neo4jDriver.session();

    try {
      const result = await session.run('SHOW INDEXES');

      return result.records.map((record) => ({
        name: record.get('name'),
        labelsOrTypes: record.get('labelsOrTypes') ?? [],
        properties: record.get('properties') ?? [],
        type: record.get('type'),
        state: record.get('state'),
        populationPercent: parseFloat(record.get('populationPercent') ?? '0'),
        uniqueness: record.get('uniqueness'),
      }));
    } finally {
      await session.close();
    }
  }

  /**
   * HNSWインデックスを最適化
   */
  public async optimizeHNSWIndex(
    tableName: string,
    columnName: string,
    config: Partial<HNSWIndexConfig> = {}
  ): Promise<void> {
    if (!this.pgPool) {
      throw new Error('PostgreSQL pool not initialized');
    }

    const m = config.m ?? 16;
    const efConstruction = config.efConstruction ?? 64;

    // 識別子の検証とクォート
    const safeTableName = this.validateAndQuoteIdentifier(tableName);
    const safeColumnName = this.validateAndQuoteIdentifier(columnName);

    const rawIndexName = `${tableName}_${columnName}_hnsw_idx`;
    const safeIndexName = this.validateAndQuoteIdentifier(rawIndexName);

    try {
      // 既存インデックスを削除
      await this.pgPool.query(`DROP INDEX IF EXISTS ${safeIndexName}`);

      // 最適化されたHNSWインデックスを作成
      await this.pgPool.query(`
        CREATE INDEX ${safeIndexName}
        ON ${safeTableName}
        USING hnsw (${safeColumnName} vector_cosine_ops)
        WITH (m = ${m}, ef_construction = ${efConstruction})
      `);

      console.log(
        `HNSW index optimized: ${rawIndexName} (m=${m}, ef_construction=${efConstruction})`
      );
    } catch (error) {
      console.error('Failed to optimize HNSW index:', error);
      throw error;
    }
  }

  /**
   * Neo4jインデックスを作成
   */
  public async createNeo4jIndex(
    label: string,
    property: string,
    indexType: 'RANGE' | 'TEXT' | 'POINT' | 'FULLTEXT' = 'RANGE'
  ): Promise<void> {
    if (!this.neo4jDriver) {
      throw new Error('Neo4j driver not initialized');
    }

    // 識別子の検証
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(label) || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(property)) {
      throw new Error('Invalid label or property name');
    }

    const session = this.neo4jDriver.session();
    const indexName = `${label.toLowerCase()}_${property.toLowerCase()}_idx`;

    try {
      if (indexType === 'FULLTEXT') {
        await session.run(
          `CREATE FULLTEXT INDEX ${indexName} FOR (n:${label}) ON EACH [n.${property}]`
        );
      } else {
        await session.run(`CREATE INDEX ${indexName} FOR (n:${label}) ON (n.${property})`);
      }

      console.log(`Neo4j index created: ${indexName} (${indexType})`);
    } catch (error) {
      console.error('Failed to create Neo4j index:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Neo4jインデックスを削除
   */
  public async dropNeo4jIndex(indexName: string): Promise<void> {
    if (!this.neo4jDriver) {
      throw new Error('Neo4j driver not initialized');
    }

    // 識別子の検証
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(indexName)) {
      throw new Error('Invalid index name');
    }

    const session = this.neo4jDriver.session();

    try {
      await session.run(`DROP INDEX ${indexName}`);
      console.log(`Neo4j index dropped: ${indexName}`);
    } catch (error) {
      console.error('Failed to drop Neo4j index:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * 未使用インデックスを検出
   */
  public async detectUnusedIndexes(): Promise<PostgresIndexInfo[]> {
    if (!this.pgPool) {
      throw new Error('PostgreSQL pool not initialized');
    }

    const indexes = await this.getPostgresIndexes();

    // プライマリキーと一意制約を除外
    return indexes.filter(
      (idx) =>
        !idx.isPrimary &&
        !idx.isUnique &&
        idx.indexScanCount < this.config.unusedThreshold
    );
  }

  /**
   * インデックス肥大化を検出
   */
  public async detectBloatedIndexes(): Promise<PostgresIndexInfo[]> {
    if (!this.pgPool) {
      throw new Error('PostgreSQL pool not initialized');
    }

    const query = `
      SELECT
        schemaname,
        tablename,
        indexname,
        pg_relation_size(indexrelid) AS index_size,
        pg_relation_size(relid) AS table_size,
        CASE
          WHEN pg_relation_size(relid) = 0 THEN 0
          ELSE (pg_relation_size(indexrelid)::float / pg_relation_size(relid)::float) * 100
        END AS bloat_ratio
      FROM pg_stat_user_indexes
      WHERE pg_relation_size(indexrelid) > 0
      ORDER BY bloat_ratio DESC
    `;

    const result: QueryResult = await this.pgPool.query(query);

    const bloatedIndexes: PostgresIndexInfo[] = [];

    for (const row of result.rows) {
      const bloatRatio = parseFloat(row.bloat_ratio);

      if (bloatRatio > this.config.bloatThreshold) {
        bloatedIndexes.push({
          schemaName: row.schemaname,
          tableName: row.tablename,
          indexName: row.indexname,
          indexType: 'unknown',
          indexSize: parseInt(row.index_size, 10),
          indexScanCount: 0,
          indexTupleReadCount: 0,
          indexTupleFetchCount: 0,
          isUnique: false,
          isPrimary: false,
          definition: '',
        });
      }
    }

    return bloatedIndexes;
  }

  /**
   * インデックスを再構築
   */
  public async reindexTable(tableName: string): Promise<void> {
    if (!this.pgPool) {
      throw new Error('PostgreSQL pool not initialized');
    }

    try {
      const safeTableName = this.validateAndQuoteIdentifier(tableName);
      await this.pgPool.query(`REINDEX TABLE ${safeTableName}`);
      console.log(`Table reindexed: ${tableName}`);
    } catch (error) {
      console.error('Failed to reindex table:', error);
      throw error;
    }
  }

  /**
   * 識別子を検証してクォートする
   * SQLインジェクション対策
   */
  private validateAndQuoteIdentifier(identifier: string): string {
    // 英数字とアンダースコアのみ許可
    if (!/^[a-zA-Z0-9_]+$/.test(identifier)) {
      throw new Error(`Invalid identifier: ${identifier}`);
    }
    // 二重引用符で囲み、内部の二重引用符をエスケープ
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  /**
   * インデックスヘルスを分析
   */
  private async analyzeIndexHealth(): Promise<void> {
    try {
      // PostgreSQLインデックスを分析
      if (this.pgPool) {
        const indexes = await this.getPostgresIndexes();

        for (const idx of indexes) {
          const health = await this.calculateIndexHealth(idx);
          this.indexHealthCache.set(`pg:${idx.indexName}`, health);
        }
      }

      // Neo4jインデックスを分析
      if (this.neo4jDriver) {
        const indexes = await this.getNeo4jIndexes();

        for (const idx of indexes) {
          const health = this.calculateNeo4jIndexHealth(idx);
          this.indexHealthCache.set(`neo4j:${idx.name}`, health);
        }
      }
    } catch (error) {
      console.error('Failed to analyze index health:', error);
    }
  }

  /**
   * PostgreSQLインデックスヘルスを計算
   */
  private async calculateIndexHealth(idx: PostgresIndexInfo): Promise<IndexHealth> {
    const usageRate = idx.indexScanCount;

    // インデックス肥大化率を計算
    let bloatRatio = 0;
    if (this.pgPool) {
      try {
        // 識別子の検証
        this.validateAndQuoteIdentifier(idx.schemaName);
        this.validateAndQuoteIdentifier(idx.indexName);
        this.validateAndQuoteIdentifier(idx.tableName);

        // スキーマ修飾された識別子を作成
        // regclassキャストを使用してPostgreSQLに識別子を解決させる
        const qualifiedIndexName = `${idx.schemaName}.${idx.indexName}`;
        const qualifiedTableName = `${idx.schemaName}.${idx.tableName}`;

        const result = await this.pgPool.query(
          `
          SELECT
            CASE
              WHEN pg_relation_size($2::regclass) = 0 THEN 0
              ELSE (pg_relation_size($1::regclass)::float / pg_relation_size($2::regclass)::float) * 100
            END AS bloat_ratio
        `,
          [qualifiedIndexName, qualifiedTableName]
        );

        bloatRatio = parseFloat(result.rows[0]?.bloat_ratio ?? '0');
      } catch (error) {
        console.warn(`Failed to calculate bloat ratio for ${idx.indexName}:`, error);
      }
    }

    let health: 'healthy' | 'warning' | 'critical' = 'healthy';
    const recommendations: string[] = [];

    // 未使用インデックス
    if (usageRate < this.config.unusedThreshold && !idx.isPrimary && !idx.isUnique) {
      health = 'warning';
      recommendations.push('Consider dropping this unused index');
    }

    // 肥大化インデックス
    if (bloatRatio > this.config.bloatThreshold) {
      health = health === 'warning' ? 'critical' : 'warning';
      recommendations.push('Index is bloated - consider REINDEX');
    }

    return {
      indexName: idx.indexName,
      database: 'postgresql',
      health,
      usageRate,
      bloatRatio,
      recommendations,
    };
  }

  /**
   * Neo4jインデックスヘルスを計算
   */
  private calculateNeo4jIndexHealth(idx: Neo4jIndexInfo): IndexHealth {
    let health: 'healthy' | 'warning' | 'critical' = 'healthy';
    const recommendations: string[] = [];

    // インデックス状態チェック
    if (idx.state !== 'ONLINE') {
      health = 'critical';
      recommendations.push(`Index is ${idx.state} - needs attention`);
    }

    // 人口率チェック
    if (idx.populationPercent < 100) {
      health = 'warning';
      recommendations.push('Index population incomplete');
    }

    return {
      indexName: idx.name,
      database: 'neo4j',
      health,
      usageRate: idx.populationPercent,
      bloatRatio: 0,
      recommendations,
    };
  }

  /**
   * インデックスタイプを抽出
   */
  private extractIndexType(definition: string): string {
    if (definition.includes('USING hnsw')) return 'hnsw';
    if (definition.includes('USING btree')) return 'btree';
    if (definition.includes('USING hash')) return 'hash';
    if (definition.includes('USING gin')) return 'gin';
    if (definition.includes('USING gist')) return 'gist';
    return 'unknown';
  }

  /**
   * インデックス統計を取得
   */
  public getIndexStats(): IndexStats {
    const allHealth = Array.from(this.indexHealthCache.values());

    return {
      totalIndexes: allHealth.length,
      healthyIndexes: allHealth.filter((h) => h.health === 'healthy').length,
      warningIndexes: allHealth.filter((h) => h.health === 'warning').length,
      criticalIndexes: allHealth.filter((h) => h.health === 'critical').length,
      unusedIndexes: allHealth.filter(
        (h) => h.database === 'postgresql' && h.usageRate < this.config.unusedThreshold
      ).length,
      bloatedIndexes: allHealth.filter((h) => h.bloatRatio > this.config.bloatThreshold).length,
    };
  }

  /**
   * すべてのインデックスヘルスを取得
   */
  public getAllIndexHealth(): IndexHealth[] {
    return Array.from(this.indexHealthCache.values());
  }

  /**
   * 特定インデックスのヘルスを取得
   */
  public getIndexHealth(indexName: string, database: 'postgresql' | 'neo4j'): IndexHealth | undefined {
    const key = `${database === 'postgresql' ? 'pg' : 'neo4j'}:${indexName}`;
    return this.indexHealthCache.get(key);
  }

  /**
   * ヘルスキャッシュをクリア
   */
  public clearHealthCache(): void {
    this.indexHealthCache.clear();
  }

  /**
   * シャットダウン
   */
  public async shutdown(): Promise<void> {
    this.stopMonitoring();
    this.clearHealthCache();
  }
}
