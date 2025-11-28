/**
 * セキュリティイベント検出器
 *
 * Requirements: 6.6 - データ漏洩のリスク検出と通知
 * - 検出条件:
 *   - 異常なデータアクセスパターン（5分間に100件以上のアクセス、または通常の10倍以上）
 *   - 未知のIPアドレスからの初回アクセス（GeoIPベースの異常検出）
 *   - 大量データエクスポート試行（1セッションで1000件以上）
 *   - 認証失敗率の急増（5分間に50回以上）
 * - 通知レベル: 警告、重要、緊急
 * - 自動応答アクション: セッション終了、IPブロック、アラート発火
 */

import { randomUUID } from 'crypto';
import { AuditLogger } from './audit-logger.js';

/**
 * 異常パターン
 */
export type AnomalyPattern =
  | 'excessive_data_access'
  | 'unknown_ip_access'
  | 'bulk_export_attempt'
  | 'auth_failure_spike';

/**
 * 脅威レベル
 */
export type ThreatLevel = 'warning' | 'important' | 'critical';

/**
 * セキュリティイベント
 */
export interface SecurityEvent {
  id: string;
  timestamp: Date;
  anomalyPattern: AnomalyPattern;
  threatLevel: ThreatLevel;
  userId: string;
  sessionId?: string;
  description: string;
  metadata?: Record<string, unknown>;
  recommendedActions?: string[];
}

/**
 * 検出パラメータ
 */
export interface DetectionParams {
  /** 異常検出の時間枠（分）（デフォルト: 5） */
  timeWindowMinutes?: number;
  /** 検出にベースライン比較を使用するかどうか（デフォルト: false） */
  useBaseline?: boolean;
  /**
   * 処理前に監査ログの署名を検証するかどうか
   * trueの場合、無効な署名を持つログは検出から除外されます
   * 無効なログはカウントされログに記録されますが、検出アルゴリズムには渡されません
   * （デフォルト: false）
   */
  verifyAuditLogSignature?: boolean;
}

/**
 * セキュリティイベントのクエリパラメータ
 */
export interface SecurityEventQuery {
  startTime?: Date;
  endTime?: Date;
  threatLevel?: ThreatLevel;
  userId?: string;
  anomalyPattern?: AnomalyPattern;
}

/**
 * 保持管理用のメタデータ付きセキュリティイベント
 */
interface SecurityEventWithMetadata {
  event: SecurityEvent;
  timestamp: Date;
}

/**
 * TTL追跡付きの既知IPエントリ
 */
interface KnownIpEntry {
  ips: Set<string>;
  lastAccess: Date;
}

/**
 * TTL追跡付きのユーザーベースラインエントリ
 */
interface UserBaselineEntry {
  baseline: number;
  lastAccess: Date;
}

/**
 * 保持設定
 */
interface RetentionConfig {
  /** セキュリティイベントの保持期間（日）（デフォルト: 365） */
  securityEventsRetentionDays: number;
  /** 既知IPのTTL（日）（デフォルト: 90） */
  knownIpsTTLDays: number;
  /** ユーザーベースラインのTTL（日）（デフォルト: 90） */
  userBaselinesTTLDays: number;
  /** 保存する最大セキュリティイベント数（デフォルト: 10000） */
  maxSecurityEvents: number;
  /** 最大既知IPエントリ数（デフォルト: 5000） */
  maxKnownIpEntries: number;
  /** 最大ユーザーベースラインエントリ数（デフォルト: 5000） */
  maxUserBaselineEntries: number;
  /** クリーンアップ間隔（ミリ秒）（デフォルト: 1時間） */
  cleanupIntervalMs: number;
}

/**
 * デフォルトの保持設定
 */
const DEFAULT_RETENTION_CONFIG: RetentionConfig = {
  securityEventsRetentionDays: 365,
  knownIpsTTLDays: 90,
  userBaselinesTTLDays: 90,
  maxSecurityEvents: 10000,
  maxKnownIpEntries: 5000,
  maxUserBaselineEntries: 5000,
  cleanupIntervalMs: 60 * 60 * 1000, // 1 hour
};

/**
 * セキュリティイベント検出器
 *
 * セキュリティ異常と潜在的なデータ漏洩を検出します
 */
export class SecurityEventDetector {
  private auditLogger: AuditLogger;
  private securityEvents: Map<string, SecurityEventWithMetadata>;
  private knownIps: Map<string, KnownIpEntry>;
  private userBaselines: Map<string, UserBaselineEntry>;
  private retentionConfig: RetentionConfig;
  private cleanupTimer?: NodeJS.Timeout;

  // Thresholds
  private readonly EXCESSIVE_ACCESS_THRESHOLD = 100;
  private readonly BULK_EXPORT_THRESHOLD = 1000;
  private readonly AUTH_FAILURE_THRESHOLD = 50;
  private readonly BASELINE_MULTIPLIER = 10;

  // 絶対閾値検出用の脅威レベル乗数
  // Important: 閾値の110%, Critical: 閾値の120%
  private readonly EXCESSIVE_ACCESS_IMPORTANT_MULTIPLIER = 1.1;
  private readonly EXCESSIVE_ACCESS_CRITICAL_MULTIPLIER = 1.2;

  constructor(auditLogger: AuditLogger, retentionConfig?: Partial<RetentionConfig>) {
    this.auditLogger = auditLogger;
    this.securityEvents = new Map();
    this.knownIps = new Map();
    this.userBaselines = new Map();
    this.retentionConfig = { ...DEFAULT_RETENTION_CONFIG, ...retentionConfig };

    // 定期的なクリーンアップを開始
    this.startCleanupTask();
  }

  /**
   * 監査ログの異常を検出
   *
   * @param params - 検出パラメータ
   * @returns 検出されたセキュリティイベント
   */
  async detectAnomalies(params: DetectionParams): Promise<SecurityEvent[]> {
    const timeWindowMinutes = params.timeWindowMinutes || 5;
    const startTime = new Date(Date.now() - timeWindowMinutes * 60 * 1000);
    const endTime = new Date();

    let recentLogs = await this.auditLogger.queryLogs({
      startTime,
      endTime,
    });

    // 要求された場合、監査ログの署名を検証
    if (params.verifyAuditLogSignature === true) {
      const { validLogs, invalidCount } = await this.filterValidLogs(recentLogs);
      recentLogs = validLogs;

      if (invalidCount > 0) {
        console.warn(
          `[SecurityEventDetector] Excluded ${invalidCount} audit log(s) with invalid signatures from anomaly detection`
        );
      }
    }

    const detectedEvents: SecurityEvent[] = [];

    // 1. 過剰なデータアクセスを検出
    const excessiveAccessEvents = await this.detectExcessiveDataAccess(
      recentLogs,
      params.useBaseline
    );
    detectedEvents.push(...excessiveAccessEvents);

    // 2. 未知のIPアクセスを検出
    const unknownIpEvents = await this.detectUnknownIpAccess(recentLogs);
    detectedEvents.push(...unknownIpEvents);

    // 3. 大量エクスポート試行を検出
    const bulkExportEvents = await this.detectBulkExportAttempts(recentLogs);
    detectedEvents.push(...bulkExportEvents);

    // 4. 認証失敗の急増を検出
    const authFailureEvents = await this.detectAuthFailureSpikes(recentLogs);
    detectedEvents.push(...authFailureEvents);

    // 検出されたイベントをメタデータとともに保存
    detectedEvents.forEach((event) => {
      this.securityEvents.set(event.id, {
        event,
        timestamp: event.timestamp,
      });
    });

    // 必要に応じて日和見的なクリーンアップを実行
    this.opportunisticCleanup();

    return detectedEvents;
  }

  /**
   * 過剰なデータアクセスを検出
   */
  private async detectExcessiveDataAccess(
    logs: Awaited<ReturnType<AuditLogger['queryLogs']>>,
    useBaseline?: boolean
  ): Promise<SecurityEvent[]> {
    const events: SecurityEvent[] = [];
    const userAccessCounts = new Map<string, { count: number; sessionId?: string }>();

    // ユーザーごとのアクセスをカウント
    logs.forEach((log) => {
      if (log.eventType === 'memory_searched') {
        const current = userAccessCounts.get(log.userId) || { count: 0 };
        userAccessCounts.set(log.userId, {
          count: current.count + 1,
          sessionId: log.sessionId,
        });
      }
    });

    // 過剰なアクセスをチェック
    for (const [userId, data] of userAccessCounts.entries()) {
      let isExcessive = false;
      let threatLevel: ThreatLevel = 'warning';
      const entry = this.userBaselines.get(userId);

      if (useBaseline && entry) {
        // 最終アクセス時刻を更新
        entry.lastAccess = new Date();

        // ベースライン比較を使用
        if (data.count >= entry.baseline * this.BASELINE_MULTIPLIER) {
          isExcessive = true;
          threatLevel = 'critical';
        }
      } else {
        // 絶対閾値を使用
        if (data.count >= this.EXCESSIVE_ACCESS_THRESHOLD) {
          isExcessive = true;
          if (data.count >= this.EXCESSIVE_ACCESS_THRESHOLD * this.EXCESSIVE_ACCESS_CRITICAL_MULTIPLIER) {
            threatLevel = 'critical';
          } else if (data.count >= this.EXCESSIVE_ACCESS_THRESHOLD * this.EXCESSIVE_ACCESS_IMPORTANT_MULTIPLIER) {
            threatLevel = 'important';
          }
        }
      }

      if (isExcessive) {
        events.push({
          id: randomUUID(),
          timestamp: new Date(),
          anomalyPattern: 'excessive_data_access',
          threatLevel,
          userId,
          description: `Excessive data access detected: ${data.count} accesses in time window`,
          metadata: {
            count: data.count,
            ...(entry && { baseline: entry.baseline }),
          },
          recommendedActions: [
            'Terminate session',
            'Review access patterns',
            'Contact security team',
          ],
          ...(data.sessionId !== undefined ? { sessionId: data.sessionId } : {}),
        });
      }
    }

    return events;
  }

  /**
   * 未知のIPアクセスを検出
   */
  private async detectUnknownIpAccess(
    logs: Awaited<ReturnType<AuditLogger['queryLogs']>>
  ): Promise<SecurityEvent[]> {
    const events: SecurityEvent[] = [];
    const seenKeys = new Set<string>(); // 重複排除のために userId|ipAddress を追跡

    for (const log of logs) {
      const entry = this.knownIps.get(log.userId);
      const dedupeKey = `${log.userId}|${log.ipAddress}`;

      // この userId+IP の組み合わせを既に確認済みの場合はスキップ
      if (seenKeys.has(dedupeKey)) {
        continue;
      }

      // undefinedエントリは空の既知IPセットとして扱う
      const knownIps = entry?.ips || new Set<string>();

      // このIPが未知かどうかチェック
      if (!knownIps.has(log.ipAddress)) {
        // エントリが存在する場合、最終アクセス時刻を更新
        if (entry) {
          entry.lastAccess = new Date();
        }

        // この組み合わせを確認済みとしてマーク
        seenKeys.add(dedupeKey);

        events.push({
          id: randomUUID(),
          timestamp: new Date(),
          anomalyPattern: 'unknown_ip_access',
          threatLevel: 'warning',
          userId: log.userId,
          sessionId: log.sessionId,
          description: `Access from unknown IP address: ${log.ipAddress}`,
          metadata: {
            ipAddress: log.ipAddress,
            knownIps: Array.from(knownIps),
          },
          recommendedActions: ['Verify user identity', 'Monitor session'],
        });
      }
    }

    return events;
  }

  /**
   * 大量エクスポート試行を検出
   */
  private async detectBulkExportAttempts(
    logs: Awaited<ReturnType<AuditLogger['queryLogs']>>
  ): Promise<SecurityEvent[]> {
    const events: SecurityEvent[] = [];
    const sessionAccessCounts = new Map<string, { count: number; userId: string }>();

    // セッションごとのアクセスをカウント
    logs.forEach((log) => {
      if (log.eventType === 'memory_searched') {
        const current = sessionAccessCounts.get(log.sessionId) || { count: 0, userId: log.userId };
        sessionAccessCounts.set(log.sessionId, {
          count: current.count + 1,
          userId: log.userId,
        });
      }
    });

    // 大量エクスポートをチェック
    for (const [sessionId, data] of sessionAccessCounts.entries()) {
      if (data.count >= this.BULK_EXPORT_THRESHOLD) {
        events.push({
          id: randomUUID(),
          timestamp: new Date(),
          anomalyPattern: 'bulk_export_attempt',
          threatLevel: 'critical',
          userId: data.userId,
          sessionId,
          description: `Bulk export attempt detected: ${data.count} memories accessed in single session`,
          metadata: {
            count: data.count,
          },
          recommendedActions: [
            'Terminate session immediately',
            'Block IP address',
            'Investigate data exfiltration',
          ],
        });
      }
    }

    return events;
  }

  /**
   * 認証失敗の急増を検出
   */
  private async detectAuthFailureSpikes(
    logs: Awaited<ReturnType<AuditLogger['queryLogs']>>
  ): Promise<SecurityEvent[]> {
    const events: SecurityEvent[] = [];
    const authFailureCounts = new Map<string, { count: number; userId: string }>();

    // IPごとの認証失敗をカウント
    logs.forEach((log) => {
      if (log.eventType === 'auth_failed') {
        const current = authFailureCounts.get(log.ipAddress) || { count: 0, userId: log.userId };
        authFailureCounts.set(log.ipAddress, {
          count: current.count + 1,
          userId: log.userId,
        });
      }
    });

    // 認証失敗の急増をチェック
    for (const [ipAddress, data] of authFailureCounts.entries()) {
      if (data.count >= this.AUTH_FAILURE_THRESHOLD) {
        events.push({
          id: randomUUID(),
          timestamp: new Date(),
          anomalyPattern: 'auth_failure_spike',
          threatLevel: 'critical',
          userId: data.userId,
          description: `Authentication failure spike detected: ${data.count} failures from ${ipAddress}`,
          metadata: {
            ipAddress,
            failureCount: data.count,
          },
          recommendedActions: ['Block IP address for 15 minutes', 'Alert security team'],
        });
      }
    }

    return events;
  }

  /**
   * 脅威レベルを分類
   *
   * @param event - セキュリティイベント
   * @returns 脅威レベル
   */
  classifyThreatLevel(event: SecurityEvent): ThreatLevel {
    return event.threatLevel;
  }

  /**
   * セキュリティイベントを取得
   *
   * @param query - クエリパラメータ
   * @returns 一致するセキュリティイベント
   */
  async getSecurityEvents(query: SecurityEventQuery): Promise<SecurityEvent[]> {
    // メタデータラッパーからイベントを抽出
    let results = Array.from(this.securityEvents.values()).map((entry) => entry.event);

    // フィルタを適用
    if (query.startTime) {
      results = results.filter((event) => event.timestamp >= query.startTime!);
    }

    if (query.endTime) {
      results = results.filter((event) => event.timestamp <= query.endTime!);
    }

    if (query.threatLevel) {
      results = results.filter((event) => event.threatLevel === query.threatLevel);
    }

    if (query.userId) {
      results = results.filter((event) => event.userId === query.userId);
    }

    if (query.anomalyPattern) {
      results = results.filter((event) => event.anomalyPattern === query.anomalyPattern);
    }

    // タイムスタンプの降順でソート
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return results;
  }

  /**
   * ユーザーの既知IPを登録
   *
   * @param userId - ユーザーID
   * @param ipAddress - IPアドレス
   */
  async registerKnownIp(userId: string, ipAddress: string): Promise<void> {
    const now = new Date();

    if (!this.knownIps.has(userId)) {
      this.knownIps.set(userId, {
        ips: new Set(),
        lastAccess: now,
      });
    }

    const entry = this.knownIps.get(userId)!;
    entry.ips.add(ipAddress);
    entry.lastAccess = now;

    // 必要に応じて日和見的なクリーンアップを実行
    this.opportunisticCleanup();
  }

  /**
   * ユーザーの既知IPを取得
   *
   * @param userId - ユーザーID
   * @returns 既知のIPアドレス
   */
  async getKnownIps(userId: string): Promise<string[]> {
    const entry = this.knownIps.get(userId);

    if (entry) {
      // 最終アクセス時刻を更新
      entry.lastAccess = new Date();
      return Array.from(entry.ips);
    }

    return [];
  }

  /**
   * ユーザーのベースラインアクセス数を確立
   *
   * @param userId - ユーザーID
   * @param count - ベースラインアクセス数
   */
  async establishBaseline(userId: string, count: number): Promise<void> {
    this.userBaselines.set(userId, {
      baseline: count,
      lastAccess: new Date(),
    });

    // 必要に応じて日和見的なクリーンアップを実行
    this.opportunisticCleanup();
  }

  /**
   * ユーザーのベースラインを取得
   *
   * @param userId - ユーザーID
   * @returns ベースラインアクセス数
   */
  async getBaseline(userId: string): Promise<number | undefined> {
    const entry = this.userBaselines.get(userId);

    if (entry) {
      // 最終アクセス時刻を更新
      entry.lastAccess = new Date();
      return entry.baseline;
    }

    return undefined;
  }

  /**
   * 監査ログの署名を検証して有効なログをフィルタリング
   *
   * @param logs - フィルタリングする監査ログ
   * @returns 有効なログと無効なログの数を含むオブジェクト
   */
  private async filterValidLogs(
    logs: Awaited<ReturnType<typeof this.auditLogger.queryLogs>>
  ): Promise<{ validLogs: typeof logs; invalidCount: number }> {
    const validLogs = [];
    let invalidCount = 0;

    for (const log of logs) {
      const isValid = await this.auditLogger.verifySignature(log);

      if (isValid) {
        validLogs.push(log);
      } else {
        invalidCount++;
        // 監査目的で無効なエントリを記録
        console.warn(
          `[SecurityEventDetector] Invalid signature detected for audit log: ${log.id} ` +
          `(eventType: ${log.eventType}, userId: ${log.userId}, timestamp: ${log.timestamp.toISOString()})`
        );
      }
    }

    return { validLogs, invalidCount };
  }

  /**
   * 定期的なクリーンアップタスクを開始
   */
  private startCleanupTask(): void {
    this.cleanupTimer = setInterval(() => {
      this.performCleanup();
    }, this.retentionConfig.cleanupIntervalMs);

    // タイマーがプロセス終了を妨げないようにする
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * クリーンアップタスクを停止
   */
  stopCleanupTask(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      delete this.cleanupTimer;
    }
  }

  /**
   * 期限切れエントリのクリーンアップを実行
   *
   * TTLとサイズ制限に基づいてエントリを削除します
   * ノンブロッキング - 長い一時停止を避けるためにバッチ処理します
   */
  private performCleanup(): void {
    const now = new Date();

    // セキュリティイベントをクリーンアップ
    this.cleanupSecurityEvents(now);

    // 既知IPをクリーンアップ
    this.cleanupKnownIps(now);

    // ユーザーベースラインをクリーンアップ
    this.cleanupUserBaselines(now);
  }

  /**
   * 保持ポリシーに基づいてセキュリティイベントをクリーンアップ
   */
  private cleanupSecurityEvents(now: Date): void {
    const retentionMs = this.retentionConfig.securityEventsRetentionDays * 24 * 60 * 60 * 1000;
    const cutoffTime = new Date(now.getTime() - retentionMs);

    // 期限切れエントリを削除
    for (const [id, entry] of this.securityEvents.entries()) {
      if (entry.timestamp < cutoffTime) {
        this.securityEvents.delete(id);
      }
    }

    // 最も古いエントリを削除して最大サイズを強制
    if (this.securityEvents.size > this.retentionConfig.maxSecurityEvents) {
      const entries = Array.from(this.securityEvents.entries());
      entries.sort((a, b) => a[1].timestamp.getTime() - b[1].timestamp.getTime());

      const toRemove = entries.slice(0, this.securityEvents.size - this.retentionConfig.maxSecurityEvents);
      for (const [id] of toRemove) {
        this.securityEvents.delete(id);
      }
    }
  }

  /**
   * TTLに基づいて既知IPをクリーンアップ
   */
  private cleanupKnownIps(now: Date): void {
    const ttlMs = this.retentionConfig.knownIpsTTLDays * 24 * 60 * 60 * 1000;
    const cutoffTime = new Date(now.getTime() - ttlMs);

    // 期限切れエントリを削除
    for (const [userId, entry] of this.knownIps.entries()) {
      if (entry.lastAccess < cutoffTime) {
        this.knownIps.delete(userId);
      }
    }

    // 最も最近アクセスされていないエントリを削除して最大サイズを強制
    if (this.knownIps.size > this.retentionConfig.maxKnownIpEntries) {
      const entries = Array.from(this.knownIps.entries());
      entries.sort((a, b) => a[1].lastAccess.getTime() - b[1].lastAccess.getTime());

      const toRemove = entries.slice(0, this.knownIps.size - this.retentionConfig.maxKnownIpEntries);
      for (const [userId] of toRemove) {
        this.knownIps.delete(userId);
      }
    }
  }

  /**
   * TTLに基づいてユーザーベースラインをクリーンアップ
   */
  private cleanupUserBaselines(now: Date): void {
    const ttlMs = this.retentionConfig.userBaselinesTTLDays * 24 * 60 * 60 * 1000;
    const cutoffTime = new Date(now.getTime() - ttlMs);

    // 期限切れエントリを削除
    for (const [userId, entry] of this.userBaselines.entries()) {
      if (entry.lastAccess < cutoffTime) {
        this.userBaselines.delete(userId);
      }
    }

    // 最も最近アクセスされていないエントリを削除して最大サイズを強制
    if (this.userBaselines.size > this.retentionConfig.maxUserBaselineEntries) {
      const entries = Array.from(this.userBaselines.entries());
      entries.sort((a, b) => a[1].lastAccess.getTime() - b[1].lastAccess.getTime());

      const toRemove = entries.slice(0, this.userBaselines.size - this.retentionConfig.maxUserBaselineEntries);
      for (const [userId] of toRemove) {
        this.userBaselines.delete(userId);
      }
    }
  }

  /**
   * アクセス時に日和見的にエントリをクリーンアップ
   *
   * サイズ制限をチェックし、必要に応じてクリーンアップを実行します
   * これにより、定期的なタスク中のクリーンアップスパイクを防ぎます
   */
  private opportunisticCleanup(): void {
    const now = new Date();

    // クイックサイズチェック - 制限を超えている場合のみクリーンアップ
    if (this.securityEvents.size > this.retentionConfig.maxSecurityEvents * 1.1) {
      this.cleanupSecurityEvents(now);
    }

    if (this.knownIps.size > this.retentionConfig.maxKnownIpEntries * 1.1) {
      this.cleanupKnownIps(now);
    }

    if (this.userBaselines.size > this.retentionConfig.maxUserBaselineEntries * 1.1) {
      this.cleanupUserBaselines(now);
    }
  }
}
