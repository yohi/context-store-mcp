/**
 * Query Optimizer
 *
 * タスク10.1: パフォーマンスチューニング - クエリ最適化と実行計画分析
 * Requirements: 7.1 (P95 < 2秒)
 *
 * 機能:
 * - PostgreSQL EXPLAIN ANALYZE自動化
 * - スロークエリの自動検出
 * - 実行計画の収集と分析
 * - クエリパフォーマンスプロファイリング
 * - スロークエリログ解析
 * - 最適化推奨事項の生成
 */

import type { Pool as PgPool, QueryResult } from 'pg';
import type { Driver as Neo4jDriver, Session as Neo4jSession } from 'neo4j-driver';

/**
 * 実行計画ノード
 */
export interface ExplainNode {
  nodeType: string;
  relationName?: string;
  startupCost: number;
  totalCost: number;
  planRows: number;
  planWidth: number;
  actualTime?: [number, number];
  actualRows?: number;
  actualLoops?: number;
  plans?: ExplainNode[];
}

/**
 * EXPLAIN ANALYZE結果
 */
export interface ExplainResult {
  query: string;
  executionTime: number;
  planningTime: number;
  totalCost: number;
  actualRows: number;
  plan: ExplainNode;
  warnings: string[];
  recommendations: string[];
}

/**
 * クエリプロファイル
 */
export interface QueryProfile {
  query: string;
  executionCount: number;
  totalTime: number;
  minTime: number;
  maxTime: number;
  avgTime: number;
  p95Time: number;
  p99Time: number;
  lastExecuted: Date;
}

/**
 * スロークエリ情報
 */
export interface SlowQuery {
  query: string;
  executionTime: number;
  occurredAt: Date;
  database: 'postgresql' | 'neo4j';
  explainPlan?: ExplainResult;
}

/**
 * クエリ最適化推奨事項
 */
export interface OptimizationRecommendation {
  query: string;
  issue: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recommendation: string;
  estimatedImprovement: string;
}

/**
 * QueryOptimizer設定
 */
export interface QueryOptimizerConfig {
  pgPool?: PgPool;
  neo4jDriver?: Neo4jDriver;
  slowQueryThreshold?: number; // ミリ秒
  enableAutoExplain?: boolean;
  enableProfiling?: boolean;
  profilingInterval?: number; // ミリ秒
}

/**
 * QueryOptimizerクラス
 */
export class QueryOptimizer {
  private pgPool: PgPool | null = null;
  private neo4jDriver: Neo4jDriver | null = null;
  private config: Required<QueryOptimizerConfig>;
  private queryProfiles: Map<string, QueryProfile> = new Map();
  private slowQueries: SlowQuery[] = [];
  private profilingTimer: NodeJS.Timeout | null = null;

  constructor(config: QueryOptimizerConfig) {
    this.config = {
      pgPool: config.pgPool ?? null,
      neo4jDriver: config.neo4jDriver ?? null,
      slowQueryThreshold: config.slowQueryThreshold ?? 2000, // 2秒
      enableAutoExplain: config.enableAutoExplain ?? true,
      enableProfiling: config.enableProfiling ?? true,
      profilingInterval: config.profilingInterval ?? 60000, // 1分
    };

    if (config.pgPool) {
      this.pgPool = config.pgPool;
    }
    if (config.neo4jDriver) {
      this.neo4jDriver = config.neo4jDriver;
    }
  }

  /**
   * プロファイリングを開始
   */
  public startProfiling(): void {
    if (!this.config.enableProfiling) {
      return;
    }

    this.profilingTimer = setInterval(() => {
      this.analyzeQueryPerformance();
    }, this.config.profilingInterval);
  }

  /**
   * プロファイリングを停止
   */
  public stopProfiling(): void {
    if (this.profilingTimer) {
      clearInterval(this.profilingTimer);
      this.profilingTimer = null;
    }
  }

  /**
   * PostgreSQLクエリのEXPLAIN ANALYZEを実行
   */
  public async explainPostgresQuery(query: string): Promise<ExplainResult> {
    if (!this.pgPool) {
      throw new Error('PostgreSQL pool not initialized');
    }

    const startTime = Date.now();

    try {
      // EXPLAIN ANALYZE実行
      const result: QueryResult = await this.pgPool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`);
      const explainData = result.rows[0]['QUERY PLAN'][0];

      const executionTime = Date.now() - startTime;
      const plan: ExplainNode = explainData.Plan;

      // 警告とリコメンデーションを生成
      const warnings = this.detectWarnings(plan);
      const recommendations = this.generateRecommendations(plan);

      return {
        query,
        executionTime,
        planningTime: explainData['Planning Time'],
        totalCost: plan.totalCost,
        actualRows: plan.actualRows ?? 0,
        plan,
        warnings,
        recommendations,
      };
    } catch (error) {
      console.error('EXPLAIN ANALYZE failed:', error);
      throw error;
    }
  }

  /**
   * Neo4jクエリのプロファイリングを実行
   */
  public async explainNeo4jQuery(query: string): Promise<ExplainResult> {
    if (!this.neo4jDriver) {
      throw new Error('Neo4j driver not initialized');
    }

    const session: Neo4jSession = this.neo4jDriver.session();
    const startTime = Date.now();

    try {
      // PROFILE実行
      const result = await session.run(`PROFILE ${query}`);
      const profile = result.summary.profile;

      const executionTime = Date.now() - startTime;

      // Neo4jプロファイル情報を共通フォーマットに変換
      const plan: ExplainNode = {
        nodeType: profile?.operatorType ?? 'Unknown',
        totalCost: profile?.dbHits ?? 0,
        startupCost: 0,
        planRows: profile?.rows ?? 0,
        planWidth: 0,
        actualRows: profile?.rows ?? 0,
      };

      const warnings: string[] = [];
      const recommendations: string[] = [];

      // Neo4j特有の警告とリコメンデーション
      if ((profile?.dbHits ?? 0) > 10000) {
        warnings.push('High database hits detected');
        recommendations.push('Consider adding appropriate indexes');
      }

      return {
        query,
        executionTime,
        planningTime: 0,
        totalCost: profile?.dbHits ?? 0,
        actualRows: profile?.rows ?? 0,
        plan,
        warnings,
        recommendations,
      };
    } finally {
      await session.close();
    }
  }

  /**
   * クエリを実行し、パフォーマンスを記録
   */
  public async profileQuery(
    query: string,
    database: 'postgresql' | 'neo4j'
  ): Promise<QueryResult | any> {
    const startTime = Date.now();

    try {
      let result: any;

      if (database === 'postgresql') {
        if (!this.pgPool) {
          throw new Error('PostgreSQL pool not initialized');
        }
        result = await this.pgPool.query(query);
      } else {
        if (!this.neo4jDriver) {
          throw new Error('Neo4j driver not initialized');
        }
        const session = this.neo4jDriver.session();
        try {
          result = await session.run(query);
        } finally {
          await session.close();
        }
      }

      const executionTime = Date.now() - startTime;

      // プロファイル情報を更新
      this.updateQueryProfile(query, executionTime);

      // スロークエリを記録
      if (executionTime > this.config.slowQueryThreshold) {
        this.recordSlowQuery(query, executionTime, database);
      }

      return result;
    } catch (error) {
      console.error(`Query execution failed [${database}]:`, error);
      throw error;
    }
  }

  /**
   * クエリプロファイルを更新
   */
  private updateQueryProfile(query: string, executionTime: number): void {
    const profile = this.queryProfiles.get(query);

    if (profile) {
      profile.executionCount++;
      profile.totalTime += executionTime;
      profile.minTime = Math.min(profile.minTime, executionTime);
      profile.maxTime = Math.max(profile.maxTime, executionTime);
      profile.avgTime = profile.totalTime / profile.executionCount;
      profile.lastExecuted = new Date();
    } else {
      this.queryProfiles.set(query, {
        query,
        executionCount: 1,
        totalTime: executionTime,
        minTime: executionTime,
        maxTime: executionTime,
        avgTime: executionTime,
        p95Time: executionTime,
        p99Time: executionTime,
        lastExecuted: new Date(),
      });
    }
  }

  /**
   * スロークエリを記録
   */
  private async recordSlowQuery(
    query: string,
    executionTime: number,
    database: 'postgresql' | 'neo4j'
  ): Promise<void> {
    let explainPlan: ExplainResult | undefined;

    // 自動EXPLAIN有効時は実行計画を取得
    if (this.config.enableAutoExplain) {
      try {
        if (database === 'postgresql') {
          explainPlan = await this.explainPostgresQuery(query);
        } else {
          explainPlan = await this.explainNeo4jQuery(query);
        }
      } catch (error) {
        console.error('Failed to get explain plan:', error);
      }
    }

    this.slowQueries.push({
      query,
      executionTime,
      occurredAt: new Date(),
      database,
      explainPlan,
    });

    // スロークエリリストのサイズを制限（最新100件のみ保持）
    if (this.slowQueries.length > 100) {
      this.slowQueries = this.slowQueries.slice(-100);
    }
  }

  /**
   * クエリパフォーマンスを分析
   */
  private analyzeQueryPerformance(): void {
    // P95, P99パーセンタイルを計算
    for (const profile of this.queryProfiles.values()) {
      // 注: 実際のパーセンタイル計算には実行時間の履歴が必要
      // 簡略化のため、現在はmaxTimeを使用
      profile.p95Time = profile.maxTime * 0.95;
      profile.p99Time = profile.maxTime * 0.99;
    }
  }

  /**
   * 実行計画から警告を検出
   */
  private detectWarnings(plan: ExplainNode): string[] {
    const warnings: string[] = [];

    // シーケンシャルスキャン検出
    if (plan.nodeType === 'Seq Scan') {
      warnings.push('Sequential scan detected - consider adding an index');
    }

    // 高コスト検出
    if (plan.totalCost > 10000) {
      warnings.push('High query cost detected');
    }

    // 大量行スキャン検出
    if ((plan.actualRows ?? 0) > 100000) {
      warnings.push('Large number of rows scanned');
    }

    // 子ノードの警告も収集
    if (plan.plans) {
      for (const childPlan of plan.plans) {
        warnings.push(...this.detectWarnings(childPlan));
      }
    }

    return warnings;
  }

  /**
   * 最適化推奨事項を生成
   */
  private generateRecommendations(plan: ExplainNode): string[] {
    const recommendations: string[] = [];

    // シーケンシャルスキャンの最適化
    if (plan.nodeType === 'Seq Scan') {
      recommendations.push(`Add index on ${plan.relationName ?? 'table'}`);
    }

    // ネステッドループの最適化
    if (plan.nodeType === 'Nested Loop' && (plan.actualRows ?? 0) > 1000) {
      recommendations.push('Consider using hash join or merge join instead of nested loop');
    }

    // ソート最適化
    if (plan.nodeType === 'Sort' && (plan.actualRows ?? 0) > 10000) {
      recommendations.push('Consider increasing work_mem for large sorts');
    }

    // 子ノードの推奨事項も収集
    if (plan.plans) {
      for (const childPlan of plan.plans) {
        recommendations.push(...this.generateRecommendations(childPlan));
      }
    }

    return recommendations;
  }

  /**
   * すべてのスロークエリを取得
   */
  public getSlowQueries(): SlowQuery[] {
    return [...this.slowQueries];
  }

  /**
   * すべてのクエリプロファイルを取得
   */
  public getQueryProfiles(): QueryProfile[] {
    return Array.from(this.queryProfiles.values());
  }

  /**
   * 特定クエリのプロファイルを取得
   */
  public getQueryProfile(query: string): QueryProfile | undefined {
    return this.queryProfiles.get(query);
  }

  /**
   * 最適化推奨事項を生成
   */
  public generateOptimizationRecommendations(): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];

    // スロークエリから推奨事項を生成
    for (const slowQuery of this.slowQueries) {
      if (slowQuery.explainPlan) {
        for (const rec of slowQuery.explainPlan.recommendations) {
          recommendations.push({
            query: slowQuery.query,
            issue: slowQuery.explainPlan.warnings.join(', '),
            severity: this.calculateSeverity(slowQuery.executionTime),
            recommendation: rec,
            estimatedImprovement: this.estimateImprovement(slowQuery.executionTime),
          });
        }
      }
    }

    return recommendations;
  }

  /**
   * 深刻度を計算
   */
  private calculateSeverity(executionTime: number): 'low' | 'medium' | 'high' | 'critical' {
    if (executionTime > 10000) return 'critical'; // > 10秒
    if (executionTime > 5000) return 'high'; // > 5秒
    if (executionTime > 2000) return 'medium'; // > 2秒
    return 'low';
  }

  /**
   * 改善見込みを推定
   */
  private estimateImprovement(executionTime: number): string {
    if (executionTime > 5000) return '50-80% improvement expected';
    if (executionTime > 2000) return '30-50% improvement expected';
    return '10-30% improvement expected';
  }

  /**
   * プロファイル情報をクリア
   */
  public clearProfiles(): void {
    this.queryProfiles.clear();
    this.slowQueries = [];
  }

  /**
   * シャットダウン
   */
  public async shutdown(): Promise<void> {
    this.stopProfiling();
    this.clearProfiles();
  }
}
