/**
 * ReconciliationService - PostgreSQLとNeo4j間の整合性監視と自動修復
 *
 * Requirements: 5.4, 5.5 - ストレージ間の一貫性監視と自動修復
 */

import type { StorageAdapter } from './storage-adapter.js';
import type { MemoryId } from '../memory/types.js';

/**
 * 差分検出結果
 */
export interface DivergenceResult {
  /** PostgreSQLに存在するがNeo4jに存在しないメモリID */
  missingInNeo4j: MemoryId[];
  /** Neo4jに存在するがPostgreSQLに存在しないメモリID（孤立ノード） */
  orphanedInNeo4j: MemoryId[];
  /** PostgreSQLに存在しないがNeo4jに存在するメモリID（通常はorphanedと同じ） */
  missingInPostgres: MemoryId[];
  /** 全体の差分数 */
  totalDivergences: number;
  /** 整合性が取れているか */
  isConsistent: boolean;
}

/**
 * 修復結果
 */
export interface RepairResult {
  /** 修復されたアイテム数 */
  repairedCount: number;
  /** 修復に失敗したID */
  failedIds: MemoryId[];
}

/**
 * 削除結果
 */
export interface DeletionResult {
  /** 削除されたアイテム数 */
  deletedCount: number;
  /** 削除に失敗したID */
  failedIds: MemoryId[];
}

/**
 * 整合性レポート
 */
export interface ConsistencyReport {
  /** チェック実行時刻 */
  checkedAt: Date;
  /** PostgreSQLの総メモリ数 */
  totalPostgresMemories: number;
  /** Neo4jの総ノード数 */
  totalNeo4jNodes: number;
  /** Neo4jに存在しないメモリID */
  missingInNeo4j: MemoryId[];
  /** 孤立したNeo4jノードID */
  orphanedInNeo4j: MemoryId[];
  /** 総差分数 */
  totalDivergences: number;
  /** 整合性が取れているか */
  isConsistent: boolean;
  /** 整合性パーセンテージ (0-100) */
  consistencyPercentage: number;
}

/**
 * 完全調整結果
 */
export interface FullReconciliationResult {
  /** 調整前の差分数 */
  divergencesBefore: number;
  /** 修復された数 */
  repaired: number;
  /** 調整後の差分数 */
  divergencesAfter: number;
  /** 整合性が取れているか */
  isConsistent: boolean;
  /** 詳細レポート */
  report: ConsistencyReport;
}

/**
 * Neo4jアダプターインターフェース
 */
export interface Neo4jAdapter {
  getAllNodeIds(): Promise<MemoryId[]>;
  deleteNode(id: MemoryId): Promise<boolean>;
  createNode(label: string, properties: Record<string, any>): Promise<void>;
}

/**
 * ReconciliationService - ストレージ間の整合性を監視・修復
 */
export class ReconciliationService {
  constructor(
    private readonly postgresAdapter: StorageAdapter,
    private readonly neo4jAdapter: Neo4jAdapter
  ) {}

  /**
   * ストレージ間の差分を検出
   */
  async detectDivergence(): Promise<DivergenceResult> {
    const [pgIds, neoIds] = await Promise.all([
      this.postgresAdapter.getAllMemoryIds(),
      this.neo4jAdapter.getAllNodeIds(),
    ]);

    const pgSet = new Set(pgIds);
    const neoSet = new Set(neoIds);

    const missingInNeo4j = pgIds.filter((id) => !neoSet.has(id));
    const orphanedInNeo4j = neoIds.filter((id) => !pgSet.has(id));

    return {
      missingInNeo4j,
      orphanedInNeo4j,
      missingInPostgres: orphanedInNeo4j, // 同じ（孤立ノード）
      totalDivergences: missingInNeo4j.length + orphanedInNeo4j.length,
      isConsistent: missingInNeo4j.length === 0 && orphanedInNeo4j.length === 0,
    };
  }

  /**
   * Neo4jに存在しないノードをPostgreSQLから作成して修復
   */
  async repairMissingInNeo4j(memoryIds: MemoryId[]): Promise<RepairResult> {
    let repairedCount = 0;
    const failedIds: MemoryId[] = [];

    for (const memoryId of memoryIds) {
      try {
        const memory = await this.postgresAdapter.getMemory(memoryId);

        if (!memory) {
          failedIds.push(memoryId);
          continue;
        }

        await this.neo4jAdapter.createNode('Memory', {
          id: memory.id,
          type: memory.memoryType,
          created_at: memory.createdAt.toISOString(),
        });

        repairedCount++;
      } catch (error) {
        failedIds.push(memoryId);
      }
    }

    return { repairedCount, failedIds };
  }

  /**
   * PostgreSQLに存在しない孤立したNeo4jノードを削除
   */
  async repairOrphanedInNeo4j(nodeIds: MemoryId[]): Promise<DeletionResult> {
    let deletedCount = 0;
    const failedIds: MemoryId[] = [];

    for (const nodeId of nodeIds) {
      try {
        await this.neo4jAdapter.deleteNode(nodeId);
        deletedCount++;
      } catch (error) {
        failedIds.push(nodeId);
      }
    }

    return { deletedCount, failedIds };
  }

  /**
   * 整合性レポートを生成
   */
  async generateConsistencyReport(): Promise<ConsistencyReport> {
    const [pgIds, neoIds] = await Promise.all([
      this.postgresAdapter.getAllMemoryIds(),
      this.neo4jAdapter.getAllNodeIds(),
    ]);

    const divergence = await this.detectDivergence();

    const totalMemories = Math.max(pgIds.length, neoIds.length);
    const consistencyPercentage =
      totalMemories === 0 ? 100 : ((totalMemories - divergence.totalDivergences) / totalMemories) * 100;

    return {
      checkedAt: new Date(),
      totalPostgresMemories: pgIds.length,
      totalNeo4jNodes: neoIds.length,
      missingInNeo4j: divergence.missingInNeo4j,
      orphanedInNeo4j: divergence.orphanedInNeo4j,
      totalDivergences: divergence.totalDivergences,
      isConsistent: divergence.isConsistent,
      consistencyPercentage: Math.round(consistencyPercentage * 100) / 100,
    };
  }

  /**
   * アラート発火の判定
   */
  async shouldTriggerAlert(options: { threshold: number }): Promise<boolean> {
    const report = await this.generateConsistencyReport();

    const divergencePercentage = 100 - report.consistencyPercentage;
    return divergencePercentage > options.threshold;
  }

  /**
   * 完全調整を実行（検出 + 修復）
   */
  async performFullReconciliation(options: { autoRepair: boolean }): Promise<FullReconciliationResult> {
    const divergenceBefore = await this.detectDivergence();
    const divergencesBefore = divergenceBefore.totalDivergences;

    let repaired = 0;

    if (options.autoRepair) {
      const [missingRepair, orphanedRepair] = await Promise.all([
        this.repairMissingInNeo4j(divergenceBefore.missingInNeo4j),
        this.repairOrphanedInNeo4j(divergenceBefore.orphanedInNeo4j),
      ]);

      repaired = missingRepair.repairedCount + orphanedRepair.deletedCount;
    }

    const report = await this.generateConsistencyReport();

    return {
      divergencesBefore,
      repaired,
      divergencesAfter: report.totalDivergences,
      isConsistent: report.isConsistent,
      report,
    };
  }
}
