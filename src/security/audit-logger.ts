/**
 * Audit Logger
 *
 * Requirements: 6.5 - 監査ログの維持
 * - ログ保持期間: 365日間（1年間）保持
 * - 不変ストレージ: WORM（Write-Once-Read-Many）ストレージ
 * - 必須フィールド: timestamp, event_type, user_id, session_id, ip_address, resource_id, action, result, metadata
 * - 検索/クエリSLA:
 *   - 過去30日間（ホットストレージ）: 5秒以内に検索可能
 *   - 31日～365日（コールドストレージ）: 30秒以内に検索可能
 * - アクセス履歴追跡: 各記憶ごとにアクセス履歴を管理
 * - 改ざん防止: デジタル署名（HMAC-SHA256）を付与
 */

import { createHmac, randomUUID } from 'crypto';

/**
 * Event types for audit logging
 */
export type EventType =
  | 'memory_created'
  | 'memory_updated'
  | 'memory_deleted'
  | 'memory_searched'
  | 'auth_success'
  | 'auth_failed';

/**
 * Event result status
 */
export type EventResult = 'success' | 'failure';

/**
 * Audit log entry structure
 */
export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  eventType: EventType;
  userId: string;
  sessionId: string;
  ipAddress: string;
  resourceId: string;
  action: string;
  result: EventResult;
  errorCode?: string;
  metadata?: Record<string, unknown>;
  signature: string;
}

/**
 * Parameters for logging an event
 */
export interface LogEventParams {
  eventType: EventType;
  userId: string;
  sessionId: string;
  ipAddress: string;
  resourceId: string;
  action: string;
  result: EventResult;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Query parameters for log search
 */
export interface QueryLogsParams {
  userId?: string;
  eventType?: EventType;
  resourceId?: string;
  startTime?: Date;
  endTime?: Date;
  result?: EventResult;
  limit?: number;
  offset?: number;
}

/**
 * Access history for a memory
 */
export interface AccessHistory {
  memoryId: string;
  totalAccesses: number;
  lastAccessedAt: Date | null;
  accessLog: AuditLogEntry[];
  uniqueUsers: Set<string>;
}

/**
 * Export format
 */
export type ExportFormat = 'json' | 'csv';

/**
 * Export parameters
 */
export interface ExportLogsParams {
  format: ExportFormat;
  startTime?: Date;
  endTime?: Date;
  userId?: string;
  eventType?: EventType;
}

/**
 * Audit Logger
 *
 * Provides tamper-evident audit logging with HMAC-SHA256 signatures
 */
export class AuditLogger {
  private logs: Map<string, AuditLogEntry>;
  private readonly secretKey: string;

  /**
   * Create a new AuditLogger instance
   *
   * @param secretKey - Secret key for HMAC signature generation
   */
  constructor(secretKey?: string) {
    this.logs = new Map();
    this.secretKey = secretKey || process.env.AUDIT_LOG_SECRET_KEY || 'default-secret-key-for-development';
  }

  /**
   * Log an audit event
   *
   * @param params - Event parameters
   * @returns The created audit log entry
   */
  async logEvent(params: LogEventParams): Promise<AuditLogEntry> {
    const id = randomUUID();
    const timestamp = new Date();

    // Create entry without signature first
    const entryWithoutSignature: Omit<AuditLogEntry, 'signature'> = {
      id,
      timestamp,
      eventType: params.eventType,
      userId: params.userId,
      sessionId: params.sessionId,
      ipAddress: params.ipAddress,
      resourceId: params.resourceId,
      action: params.action,
      result: params.result,
      ...(params.errorCode && { errorCode: params.errorCode }),
      ...(params.metadata && { metadata: params.metadata }),
    };

    // Generate signature
    const signature = this.generateSignature(entryWithoutSignature);

    // Create final entry with signature
    const entry: AuditLogEntry = {
      ...entryWithoutSignature,
      signature,
    };

    // Store in memory (in production, this would be written to WORM storage)
    this.logs.set(id, entry);

    return entry;
  }

  /**
   * Query audit logs
   *
   * @param params - Query parameters
   * @returns Matching audit log entries
   */
  async queryLogs(params: QueryLogsParams): Promise<AuditLogEntry[]> {
    let results = Array.from(this.logs.values());

    // Apply filters
    if (params.userId) {
      results = results.filter((log) => log.userId === params.userId);
    }

    if (params.eventType) {
      results = results.filter((log) => log.eventType === params.eventType);
    }

    if (params.resourceId) {
      results = results.filter((log) => log.resourceId === params.resourceId);
    }

    if (params.result) {
      results = results.filter((log) => log.result === params.result);
    }

    if (params.startTime) {
      results = results.filter((log) => log.timestamp >= params.startTime!);
    }

    if (params.endTime) {
      results = results.filter((log) => log.timestamp <= params.endTime!);
    }

    // Sort by timestamp descending (newest first)
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply pagination
    const offset = params.offset || 0;
    const limit = params.limit || results.length;

    return results.slice(offset, offset + limit);
  }

  /**
   * Verify the signature of an audit log entry
   *
   * @param entry - Audit log entry to verify
   * @returns True if signature is valid, false otherwise
   */
  async verifySignature(entry: AuditLogEntry): Promise<boolean> {
    const entryWithoutSignature: Omit<AuditLogEntry, 'signature'> = {
      id: entry.id,
      timestamp: entry.timestamp,
      eventType: entry.eventType,
      userId: entry.userId,
      sessionId: entry.sessionId,
      ipAddress: entry.ipAddress,
      resourceId: entry.resourceId,
      action: entry.action,
      result: entry.result,
      ...(entry.errorCode && { errorCode: entry.errorCode }),
      ...(entry.metadata && { metadata: entry.metadata }),
    };

    const expectedSignature = this.generateSignature(entryWithoutSignature);
    return entry.signature === expectedSignature;
  }

  /**
   * Get access history for a memory
   *
   * @param memoryId - Memory ID
   * @returns Access history for the memory
   */
  async getAccessHistory(memoryId: string): Promise<AccessHistory> {
    const accessLog = await this.queryLogs({
      resourceId: memoryId,
    });

    const uniqueUsers = new Set<string>();
    accessLog.forEach((log) => uniqueUsers.add(log.userId));

    return {
      memoryId,
      totalAccesses: accessLog.length,
      lastAccessedAt: accessLog.length > 0 ? accessLog[0].timestamp : null,
      accessLog,
      uniqueUsers,
    };
  }

  /**
   * Purge old logs beyond retention period
   *
   * @param retentionDays - Retention period in days (default: 365)
   * @returns Number of purged log entries
   */
  async purgeOldLogs(retentionDays: number = 365): Promise<number> {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    let purgedCount = 0;

    for (const [id, entry] of this.logs.entries()) {
      if (entry.timestamp < cutoffDate) {
        this.logs.delete(id);
        purgedCount++;
      }
    }

    return purgedCount;
  }

  /**
   * Export logs in specified format
   *
   * @param params - Export parameters
   * @returns Exported logs as string
   */
  async exportLogs(params: ExportLogsParams): Promise<string> {
    const logs = await this.queryLogs({
      startTime: params.startTime,
      endTime: params.endTime,
      userId: params.userId,
      eventType: params.eventType,
    });

    if (params.format === 'json') {
      return JSON.stringify(logs, null, 2);
    }

    if (params.format === 'csv') {
      const headers = [
        'id',
        'timestamp',
        'eventType',
        'userId',
        'sessionId',
        'ipAddress',
        'resourceId',
        'action',
        'result',
        'errorCode',
        'signature',
      ];

      const rows = logs.map((log) => [
        log.id,
        log.timestamp.toISOString(),
        log.eventType,
        log.userId,
        log.sessionId,
        log.ipAddress,
        log.resourceId,
        log.action,
        log.result,
        log.errorCode || '',
        log.signature,
      ]);

      return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    }

    throw new Error(`Unsupported export format: ${params.format}`);
  }

  /**
   * Update timestamp of a log entry (for testing purposes)
   *
   * @param id - Log entry ID
   * @param timestamp - New timestamp
   */
  async updateTimestamp(id: string, timestamp: Date): Promise<void> {
    const entry = this.logs.get(id);
    if (!entry) {
      throw new Error(`Log entry not found: ${id}`);
    }

    // Update timestamp and regenerate signature
    const entryWithoutSignature: Omit<AuditLogEntry, 'signature'> = {
      ...entry,
      timestamp,
    };

    const signature = this.generateSignature(entryWithoutSignature);

    this.logs.set(id, {
      ...entryWithoutSignature,
      signature,
    });
  }

  /**
   * Generate HMAC-SHA256 signature for a log entry
   *
   * @param entry - Log entry without signature
   * @returns HMAC-SHA256 signature
   */
  private generateSignature(entry: Omit<AuditLogEntry, 'signature'>): string {
    const data = JSON.stringify({
      id: entry.id,
      timestamp: entry.timestamp.toISOString(),
      eventType: entry.eventType,
      userId: entry.userId,
      sessionId: entry.sessionId,
      ipAddress: entry.ipAddress,
      resourceId: entry.resourceId,
      action: entry.action,
      result: entry.result,
      ...(entry.errorCode && { errorCode: entry.errorCode }),
      ...(entry.metadata && { metadata: entry.metadata }),
    });

    const hmac = createHmac('sha256', this.secretKey);
    hmac.update(data);
    return hmac.digest('hex');
  }
}
