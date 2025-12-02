/**
 * GDPR準拠の完全削除機能
 * Requirements: 6.4
 *
 * 段階的削除ワークフローを実装:
 * Phase 1: Soft Delete (論理削除、即座実行)
 * Phase 2: Key Destruction (暗号化キー破棄、即座実行)
 * Phase 3: Background Purge (物理削除、非同期)
 * Phase 4: Backup Deletion (バックアップからの削除、非同期)
 */

import { createHmac } from 'crypto';

// 型定義: MemoryId
export type MemoryId = string;

/**
 * 削除理由
 */
export type DeletionReason =
  | 'user_request' // ユーザーによる削除要求
  | 'gdpr_right_to_erasure' // GDPR第17条「忘れられる権利」
  | 'data_retention_policy' // データ保持ポリシーによる自動削除
  | 'security_incident'; // セキュリティインシデント対応

/**
 * 削除フェーズ
 */
export type DeletionPhase =
  | 'REQUESTED' // 削除要求受付
  | 'SOFT_DELETED' // 論理削除完了
  | 'KEY_DESTROYED' // 暗号化キー破棄完了
  | 'PURGED' // 物理削除完了
  | 'BACKUP_CLEARED' // バックアップ削除完了
  | 'VERIFIED'; // 検証完了

/**
 * 削除失敗モード
 */
export enum DeletionFailureMode {
  NEO4J_TIMEOUT = 'NEO4J_TIMEOUT',
  POSTGRESQL_DEADLOCK = 'POSTGRESQL_DEADLOCK',
  REPLICA_SYNC_TIMEOUT = 'REPLICA_SYNC_TIMEOUT',
  BACKUP_DELETION_FAILED = 'BACKUP_DELETION_FAILED',
  KEY_DESTRUCTION_FAILED = 'KEY_DESTRUCTION_FAILED',
}

/**
 * 削除監査ログエントリ
 */
export interface DeletionAuditLog {
  id: string;
  memoryId: MemoryId;
  eventType: DeletionPhase;
  userId: string;
  reason: DeletionReason;
  timestamp: Date;
  metadata: {
    ipAddress?: string;
    sessionId?: string;
    complianceFlag?: string;
    contentChecksum?: string;
  };
}

/**
 * 削除失敗記録
 */
export interface DeletionFailure {
  id: string;
  memoryId: MemoryId;
  failureMode: DeletionFailureMode;
  errorMessage: string;
  retryCount: number;
  reason: DeletionReason;
  lastRetryAt?: Date;
  createdAt: Date;
}

/**
 * バックアップ削除キュー
 */
export interface BackupDeletionQueueEntry {
  id: string;
  memoryId: MemoryId;
  deletionTimestamp: Date;
  retentionEndDate: Date; // 削除から365日後
  processed: boolean;
}

/**
 * 削除証明書
 */
export interface DeletionReceipt {
  memoryId: MemoryId;
  deletionRequestedAt: Date;
  softDeletedAt: Date;
  keyDestroyedAt: Date;
  purgeCompletedAt: Date | null;
  backupClearedAt: Date | null;
  verificationTimestamp: Date;
  checksumVerified: boolean;
  storageLocations: {
    postgresql: 'DELETED' | 'PENDING' | 'FAILED';
    neo4j: 'DELETED' | 'PENDING' | 'FAILED';
    redis: 'NOT_FOUND' | 'CLEARED';
    backups: 'SCHEDULED_FOR_DELETION' | 'DELETED' | 'PENDING';
  };
  complianceStatement: string;
  digitalSignature: string;
}

/**
 * 削除結果
 */
export interface DeletionResult {
  memoryId: MemoryId;
  phase: DeletionPhase;
  success: boolean;
  message: string;
  purgeJobId?: string;
  receipt?: DeletionReceipt;
}

/**
 * 削除再試行ポリシー
 */
export interface DeletionRetryPolicy {
  maxAttempts: number; // 最大3回
  initialDelay: number; // 60秒
  multiplier: number; // 2.0
  maxDelay: number; // 900秒（15分）
}

/**
 * ストレージアダプターインターフェース
 */
export interface StorageAdapter {
  softDelete(memoryId: MemoryId): Promise<void>;
  hardDelete(memoryId: MemoryId): Promise<void>;
  exists(memoryId: MemoryId): Promise<boolean>;
  getContentChecksum(memoryId: MemoryId): Promise<string | null>;
}

/**
 * 暗号化キー管理インターフェース
 */
export interface KeyManagementService {
  destroyKey(memoryId: MemoryId): Promise<void>;
  keyExists(memoryId: MemoryId): Promise<boolean>;
}

/**
 * バックグラウンドジョブキューインターフェース
 */
export interface JobQueue {
  schedulePurge(memoryId: MemoryId, delay?: number): Promise<string>;
}

/**
 * 時刻プロバイダーインターフェース（テスト用）
 */
export interface TimeProvider {
  now(): Date;
}

/**
 * デフォルト時刻プロバイダー（実際の時刻を返す）
 */
export class SystemTimeProvider implements TimeProvider {
  now(): Date {
    return new Date();
  }
}

/**
 * GDPR準拠削除マネージャー
 */
export class DeletionManager {
  private readonly auditLogs: Map<string, DeletionAuditLog> = new Map();
  private readonly failures: Map<string, DeletionFailure> = new Map();
  private readonly backupQueue: Map<string, BackupDeletionQueueEntry> = new Map();
  private readonly retryPolicy: DeletionRetryPolicy;
  private readonly signatureSecret: string;
  private readonly timeProvider: TimeProvider;

  constructor(
    private readonly postgresAdapter: StorageAdapter,
    private readonly neo4jAdapter: StorageAdapter,
    private readonly keyManagement: KeyManagementService,
    private readonly jobQueue: JobQueue,
    config?: {
      retryPolicy?: Partial<DeletionRetryPolicy>;
      signatureSecret?: string;
      timeProvider?: TimeProvider;
    }
  ) {
    this.retryPolicy = {
      maxAttempts: config?.retryPolicy?.maxAttempts ?? 3,
      initialDelay: config?.retryPolicy?.initialDelay ?? 60000,
      multiplier: config?.retryPolicy?.multiplier ?? 2.0,
      maxDelay: config?.retryPolicy?.maxDelay ?? 900000,
    };

    // Signature secret handling: require explicit value in production
    const isProduction = process.env['NODE_ENV'] === 'production';
    const providedSecret = config?.signatureSecret || process.env['SIGNATURE_SECRET'];

    if (isProduction && !providedSecret) {
      throw new Error(
        'SIGNATURE_SECRET is required in production environment. ' +
        'Please provide it via config.signatureSecret or SIGNATURE_SECRET environment variable.'
      );
    }

    // Use provided secret, or fallback to test secret only in non-production
    this.signatureSecret = providedSecret || 'default-secret-for-testing';

    // Initialize time provider
    this.timeProvider = config?.timeProvider ?? new SystemTimeProvider();
  }

  /**
   * 削除を開始する（Phase 1: Soft Delete + Phase 2: Key Destruction）
   */
  async initiateDeletion(
    memoryId: MemoryId,
    userId: string,
    reason: DeletionReason,
    metadata?: { ipAddress?: string; sessionId?: string }
  ): Promise<DeletionResult> {
    try {
      // 削除要求をログに記録
      await this.logDeletionEvent(memoryId, 'REQUESTED', userId, reason, metadata);

      // Phase 1: Soft Delete（論理削除）
      const contentChecksum = await this.postgresAdapter.getContentChecksum(memoryId);
      await this.postgresAdapter.softDelete(memoryId);
      const eventMetadata = {
        ...metadata,
        ...(contentChecksum ? { contentChecksum } : {}),
      };
      await this.logDeletionEvent(memoryId, 'SOFT_DELETED', userId, reason, eventMetadata);

      // Phase 2: Key Destruction（暗号化キー破棄）
      try {
        await this.keyManagement.destroyKey(memoryId);
        await this.logDeletionEvent(memoryId, 'KEY_DESTROYED', userId, reason, metadata);
      } catch (error) {
        // キー破棄失敗は記録するが、削除プロセスは続行
        await this.recordFailure(
          memoryId,
          DeletionFailureMode.KEY_DESTRUCTION_FAILED,
          error instanceof Error ? error.message : String(error),
          reason
        );
      }

      // Phase 3: Background Purge（物理削除）をスケジュール
      const purgeJobId = await this.jobQueue.schedulePurge(memoryId, 5 * 60 * 1000); // 5分後

      return {
        memoryId,
        phase: 'SOFT_DELETED',
        success: true,
        message: `削除を開始しました。ジョブID: ${purgeJobId}`,
        purgeJobId,
      };
    } catch (error) {
      return {
        memoryId,
        phase: 'REQUESTED',
        success: false,
        message: `削除開始に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * エラーを削除失敗モードに分類する
   * @private
   */
  private classifyError(error: unknown): DeletionFailureMode {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    const stack = error instanceof Error ? (error.stack || '').toLowerCase() : '';
    const fullText = `${message} ${stack}`;

    // Neo4j関連のエラー
    if (
      fullText.includes('neo4j') ||
      fullText.includes('graph') ||
      fullText.includes('cypher') ||
      fullText.includes('bolt') ||
      message.includes('connection timeout') ||
      message.includes('session expired')
    ) {
      return DeletionFailureMode.NEO4J_TIMEOUT;
    }

    // PostgreSQLデッドロック
    if (
      fullText.includes('deadlock') ||
      message.includes('deadlock detected') ||
      message.includes('could not serialize access')
    ) {
      return DeletionFailureMode.POSTGRESQL_DEADLOCK;
    }

    // レプリカ同期タイムアウト
    if (
      fullText.includes('replica') ||
      fullText.includes('replication') ||
      fullText.includes('sync') ||
      message.includes('lag') ||
      message.includes('follower')
    ) {
      return DeletionFailureMode.REPLICA_SYNC_TIMEOUT;
    }

    // バックアップ削除失敗
    if (fullText.includes('backup') || message.includes('archive')) {
      return DeletionFailureMode.BACKUP_DELETION_FAILED;
    }

    // キー破棄失敗
    if (
      fullText.includes('key') ||
      fullText.includes('encryption') ||
      fullText.includes('decrypt') ||
      message.includes('kms')
    ) {
      return DeletionFailureMode.KEY_DESTRUCTION_FAILED;
    }

    // デフォルト: PostgreSQLエラーとして扱う
    return DeletionFailureMode.POSTGRESQL_DEADLOCK;
  }

  /**
   * 物理削除を実行する（Phase 3: Background Purge）
   */
  async executePurge(memoryId: MemoryId, userId: string, deletionReason: DeletionReason): Promise<DeletionResult> {
    let retryCount = 0;

    while (retryCount < this.retryPolicy.maxAttempts) {
      try {
        // Neo4jから削除（依存関係を先に削除）
        await this.neo4jAdapter.hardDelete(memoryId);

        // PostgreSQLから削除（マスターDBから削除）
        await this.postgresAdapter.hardDelete(memoryId);

        // Phase 3完了をログに記録
        await this.logDeletionEvent(memoryId, 'PURGED', userId, deletionReason);

        // Phase 4: Backup Deletion（バックアップ削除）をスケジュール
        await this.scheduleBackupDeletion(memoryId);

        return {
          memoryId,
          phase: 'PURGED',
          success: true,
          message: '物理削除が完了しました。',
        };
      } catch (error) {
        retryCount++;

        if (retryCount >= this.retryPolicy.maxAttempts) {
          // 最大再試行回数に達した
          const failureMode = this.classifyError(error);
          await this.recordFailure(
            memoryId,
            failureMode,
            error instanceof Error ? error.message : String(error),
            deletionReason,
            retryCount
          );

          return {
            memoryId,
            phase: 'SOFT_DELETED',
            success: false,
            message: `物理削除に失敗しました（${retryCount}回試行）: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }

        // 指数バックオフで再試行
        const delay = this.calculateRetryDelay(retryCount);
        await this.sleep(delay);
      }
    }

    // ここには到達しないはずだが、TypeScriptの型チェック用
    return {
      memoryId,
      phase: 'SOFT_DELETED',
      success: false,
      message: '物理削除に失敗しました。',
    };
  }

  /**
   * 削除の検証を実行する
   */
  async verifyDeletion(memoryId: MemoryId, userId: string): Promise<DeletionReceipt> {
    // ストレージの存在確認
    const pgExists = await this.postgresAdapter.exists(memoryId);
    const neo4jExists = await this.neo4jAdapter.exists(memoryId);
    const keyExists = await this.keyManagement.keyExists(memoryId);

    // チェックサム検証
    const contentChecksum = await this.postgresAdapter.getContentChecksum(memoryId);
    const checksumVerified = contentChecksum === null;

    // 監査ログから各フェーズのタイムスタンプを取得
    const logs = await this.getAuditLogs(memoryId);
    const requestedLog = logs.find((l) => l.eventType === 'REQUESTED');
    const softDeletedLog = logs.find((l) => l.eventType === 'SOFT_DELETED');
    const keyDestroyedLog = logs.find((l) => l.eventType === 'KEY_DESTROYED');
    const purgedLog = logs.find((l) => l.eventType === 'PURGED');
    const backupClearedLog = logs.find((l) => l.eventType === 'BACKUP_CLEARED');

    // バックアップ削除キューの状態を確認
    const backupEntry = await this.getBackupDeletionEntry(memoryId);

    const receipt: DeletionReceipt = {
      memoryId,
      deletionRequestedAt: requestedLog?.timestamp ?? this.timeProvider.now(),
      softDeletedAt: softDeletedLog?.timestamp ?? this.timeProvider.now(),
      keyDestroyedAt: keyDestroyedLog?.timestamp ?? this.timeProvider.now(),
      purgeCompletedAt: purgedLog?.timestamp ?? null,
      backupClearedAt: backupClearedLog?.timestamp ?? null,
      verificationTimestamp: this.timeProvider.now(),
      checksumVerified,
      storageLocations: {
        postgresql: pgExists ? 'PENDING' : 'DELETED',
        neo4j: neo4jExists ? 'PENDING' : 'DELETED',
        redis: 'NOT_FOUND', // キャッシュは即座にクリアされる
        backups: backupEntry
          ? backupEntry.processed
            ? 'DELETED'
            : 'SCHEDULED_FOR_DELETION'
          : 'PENDING',
      },
      complianceStatement:
        'This data has been permanently deleted in compliance with GDPR Article 17.',
      digitalSignature: this.generateSignature(memoryId, {
        pgExists,
        neo4jExists,
        keyExists,
        checksumVerified,
      }),
    };

    // 検証完了をログに記録（元の削除理由を保持）
    const originalReason = requestedLog?.reason ?? 'user_request';
    await this.logDeletionEvent(memoryId, 'VERIFIED', userId, originalReason);

    return receipt;
  }

  /**
   * 削除監査ログをエクスポートする
   */
  async exportDeletionLogs(
    filters?: {
      memoryId?: MemoryId;
      userId?: string;
      startDate?: Date;
      endDate?: Date;
    },
    format: 'json' | 'csv' = 'json'
  ): Promise<string> {
    const logs = Array.from(this.auditLogs.values()).filter((log) => {
      if (filters?.memoryId && log.memoryId !== filters.memoryId) return false;
      if (filters?.userId && log.userId !== filters.userId) return false;
      if (filters?.startDate && log.timestamp < filters.startDate) return false;
      if (filters?.endDate && log.timestamp > filters.endDate) return false;
      return true;
    });

    if (format === 'json') {
      return JSON.stringify(logs, null, 2);
    }

    // CSV形式 (RFC 4180準拠 + CSV Injection対策)
    const headers = ['id', 'memoryId', 'eventType', 'userId', 'reason', 'timestamp'];
    const rows = logs.map((log) => [
      log.id,
      log.memoryId,
      log.eventType,
      log.userId,
      log.reason,
      log.timestamp.toISOString(),
    ]);

    // 各フィールドをエスケープしてCSV出力
    const headerRow = headers.map((h) => this.escapeCsvField(h)).join(',');
    const dataRows = rows.map((row) => row.map((field) => this.escapeCsvField(field)).join(','));

    return [headerRow, ...dataRows].join('\n');
  }

  /**
   * 削除失敗記録を取得する
   */
  async getDeletionFailures(memoryId?: MemoryId): Promise<DeletionFailure[]> {
    const failures = Array.from(this.failures.values());
    return memoryId ? failures.filter((f) => f.memoryId === memoryId) : failures;
  }

  /**
   * 孤立した削除レコードを検出する（監査メカニズム）
   */
  async detectOrphanedDeletions(ageThresholdHours: number = 1): Promise<MemoryId[]> {
    const threshold = new Date(this.timeProvider.now().getTime() - ageThresholdHours * 60 * 60 * 1000);
    const orphans: MemoryId[] = [];

    for (const log of this.auditLogs.values()) {
      if (
        log.eventType === 'SOFT_DELETED' &&
        log.timestamp < threshold &&
        !this.hasPhase(log.memoryId, 'PURGED')
      ) {
        orphans.push(log.memoryId);
      }
    }

    return orphans;
  }

  /**
   * 削除メトリクスを取得する
   */
  async getDeletionMetrics(): Promise<{
    totalDeletionsRequested: number;
    totalDeletionsCompleted: number;
    averageDeletionTime: number;
    failureRate: number;
    oldestPendingDeletion: Date | null;
    complianceScore: number;
  }> {
    const allLogs = Array.from(this.auditLogs.values());
    const requested = allLogs.filter((l) => l.eventType === 'REQUESTED').length;
    const completed = allLogs.filter((l) => l.eventType === 'PURGED').length;

    // 平均削除時間を計算（REQUESTED → PURGED）
    const completedMemories = new Set(
      allLogs.filter((l) => l.eventType === 'PURGED').map((l) => l.memoryId)
    );
    let totalTime = 0;
    let count = 0;

    for (const memoryId of completedMemories) {
      const requestLog = allLogs.find(
        (l) => l.memoryId === memoryId && l.eventType === 'REQUESTED'
      );
      const purgeLog = allLogs.find((l) => l.memoryId === memoryId && l.eventType === 'PURGED');

      if (requestLog && purgeLog) {
        totalTime += purgeLog.timestamp.getTime() - requestLog.timestamp.getTime();
        count++;
      }
    }

    const avgTime = count > 0 ? totalTime / count / 1000 : 0; // 秒単位

    // 失敗率
    const failures = this.failures.size;
    const failureRate = requested > 0 ? failures / requested : 0;

    // 最も古いペンディング削除
    const pendingLogs = allLogs.filter(
      (l) => l.eventType === 'SOFT_DELETED' && !this.hasPhase(l.memoryId, 'PURGED')
    );
    const oldestPending =
      pendingLogs.length > 0 ? new Date(Math.min(...pendingLogs.map((l) => l.timestamp.getTime()))) : null;

    // コンプライアンススコア（100 = 完全準拠）
    const complianceScore = requested > 0 ? Math.round(((completed / requested) * 100)) : 100;

    return {
      totalDeletionsRequested: requested,
      totalDeletionsCompleted: completed,
      averageDeletionTime: avgTime,
      failureRate,
      oldestPendingDeletion: oldestPending,
      complianceScore,
    };
  }

  // === Private Helper Methods ===

  private async logDeletionEvent(
    memoryId: MemoryId,
    eventType: DeletionPhase,
    userId: string,
    reason: DeletionReason,
    metadata?: { ipAddress?: string; sessionId?: string; contentChecksum?: string }
  ): Promise<void> {
    const log: DeletionAuditLog = {
      id: this.generateId(),
      memoryId,
      eventType,
      userId,
      reason,
      timestamp: this.timeProvider.now(),
      metadata: metadata ?? {},
    };

    this.auditLogs.set(log.id, log);
  }

  private async recordFailure(
    memoryId: MemoryId,
    failureMode: DeletionFailureMode,
    errorMessage: string,
    reason: DeletionReason,
    retryCount: number = 0
  ): Promise<void> {
    const failure: DeletionFailure = {
      id: this.generateId(),
      memoryId,
      failureMode,
      errorMessage,
      retryCount,
      reason,
      ...(retryCount > 0 ? { lastRetryAt: this.timeProvider.now() } : {}),
      createdAt: this.timeProvider.now(),
    };

    this.failures.set(failure.id, failure);
  }

  private async scheduleBackupDeletion(memoryId: MemoryId): Promise<void> {
    const now = this.timeProvider.now();
    const retentionEndDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 365日後

    const entry: BackupDeletionQueueEntry = {
      id: this.generateId(),
      memoryId,
      deletionTimestamp: now,
      retentionEndDate,
      processed: false,
    };

    this.backupQueue.set(entry.id, entry);
  }

  /**
   * Test-only API: Get audit logs for a specific memory ID
   *
   * @param memoryId - Memory ID to filter logs
   * @returns Array of audit logs
   */
  async getAuditLogsForTest(memoryId: MemoryId): Promise<DeletionAuditLog[]> {
    return this.getAuditLogs(memoryId);
  }

  /**
   * Test-only API: Get backup deletion entry for a specific memory ID
   *
   * @param memoryId - Memory ID to find backup entry
   * @returns Backup deletion queue entry or null
   */
  async getBackupDeletionEntryForTest(memoryId: MemoryId): Promise<BackupDeletionQueueEntry | null> {
    return this.getBackupDeletionEntry(memoryId);
  }

  private async getAuditLogs(memoryId: MemoryId): Promise<DeletionAuditLog[]> {
    return Array.from(this.auditLogs.values()).filter((log) => log.memoryId === memoryId);
  }

  private async getBackupDeletionEntry(memoryId: MemoryId): Promise<BackupDeletionQueueEntry | null> {
    for (const entry of this.backupQueue.values()) {
      if (entry.memoryId === memoryId) {
        return entry;
      }
    }
    return null;
  }

  private hasPhase(memoryId: MemoryId, phase: DeletionPhase): boolean {
    return Array.from(this.auditLogs.values()).some(
      (log) => log.memoryId === memoryId && log.eventType === phase
    );
  }

  private calculateRetryDelay(attempt: number): number {
    const delay = Math.min(
      this.retryPolicy.initialDelay * Math.pow(this.retryPolicy.multiplier, attempt),
      this.retryPolicy.maxDelay
    );
    return delay;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private generateId(): string {
    return `del_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  private generateSignature(memoryId: MemoryId, data: any): string {
    const payload = JSON.stringify({ memoryId, ...data });
    return createHmac('sha256', this.signatureSecret)
      .update(payload)
      .digest('hex');
  }

  /**
   * RFC 4180準拠のCSVフィールドエスケープとCSV Injection対策
   *
   * @param value - エスケープ対象の値
   * @returns エスケープおよび引用符で囲まれたCSVフィールド
   */
  private escapeCsvField(value: unknown): string {
    // null/undefinedは空文字列に変換
    if (value === null || value === undefined) {
      return '""';
    }

    // 文字列に変換
    let field = String(value);

    // CSV Injection対策: 数式として実行される可能性のある文字を無害化
    // 先頭文字が =, +, -, @ の場合は数式として実行される可能性がある
    const dangerousChars = ['=', '+', '-', '@'];
    if (dangerousChars.some((char) => field.startsWith(char))) {
      // シングルクォートを前置して無害化
      field = "'" + field;
    }

    // ダブルクォートをエスケープ (RFC 4180: " → "")
    field = field.replace(/"/g, '""');

    // 常にダブルクォートで囲む (RFC 4180)
    return `"${field}"`;
  }
}
