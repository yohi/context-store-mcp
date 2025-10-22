/**
 * Security Event Detector
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
import { AuditLogger } from './audit-logger';

/**
 * Anomaly patterns
 */
export type AnomalyPattern =
  | 'excessive_data_access'
  | 'unknown_ip_access'
  | 'bulk_export_attempt'
  | 'auth_failure_spike';

/**
 * Threat levels
 */
export type ThreatLevel = 'warning' | 'important' | 'critical';

/**
 * Security event
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
 * Detection parameters
 */
export interface DetectionParams {
  /** Time window in minutes for anomaly detection (default: 5) */
  timeWindowMinutes?: number;
  /** Whether to use baseline comparison for detection (default: false) */
  useBaseline?: boolean;
  /**
   * Whether to verify audit log signatures before processing
   * When true, logs with invalid signatures are excluded from detection
   * Invalid logs are counted and logged but not passed to detection algorithms
   * (default: false)
   */
  verifyAuditLogSignature?: boolean;
}

/**
 * Query parameters for security events
 */
export interface SecurityEventQuery {
  startTime?: Date;
  endTime?: Date;
  threatLevel?: ThreatLevel;
  userId?: string;
  anomalyPattern?: AnomalyPattern;
}

/**
 * Security Event Detector
 *
 * Detects security anomalies and potential data leakage
 */
export class SecurityEventDetector {
  private auditLogger: AuditLogger;
  private securityEvents: Map<string, SecurityEvent>;
  private knownIps: Map<string, Set<string>>; // userId -> Set of known IPs
  private userBaselines: Map<string, number>; // userId -> baseline access count

  // Thresholds
  private readonly EXCESSIVE_ACCESS_THRESHOLD = 100;
  private readonly BULK_EXPORT_THRESHOLD = 1000;
  private readonly AUTH_FAILURE_THRESHOLD = 50;
  private readonly BASELINE_MULTIPLIER = 10;

  constructor(auditLogger: AuditLogger) {
    this.auditLogger = auditLogger;
    this.securityEvents = new Map();
    this.knownIps = new Map();
    this.userBaselines = new Map();
  }

  /**
   * Detect anomalies in audit logs
   *
   * @param params - Detection parameters
   * @returns Detected security events
   */
  async detectAnomalies(params: DetectionParams): Promise<SecurityEvent[]> {
    const timeWindowMinutes = params.timeWindowMinutes || 5;
    const startTime = new Date(Date.now() - timeWindowMinutes * 60 * 1000);
    const endTime = new Date();

    let recentLogs = await this.auditLogger.queryLogs({
      startTime,
      endTime,
    });

    // Verify audit log signatures if requested
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

    // 1. Detect excessive data access
    const excessiveAccessEvents = await this.detectExcessiveDataAccess(
      recentLogs,
      params.useBaseline
    );
    detectedEvents.push(...excessiveAccessEvents);

    // 2. Detect unknown IP access
    const unknownIpEvents = await this.detectUnknownIpAccess(recentLogs);
    detectedEvents.push(...unknownIpEvents);

    // 3. Detect bulk export attempts
    const bulkExportEvents = await this.detectBulkExportAttempts(recentLogs);
    detectedEvents.push(...bulkExportEvents);

    // 4. Detect auth failure spikes
    const authFailureEvents = await this.detectAuthFailureSpikes(recentLogs);
    detectedEvents.push(...authFailureEvents);

    // Store detected events
    detectedEvents.forEach((event) => {
      this.securityEvents.set(event.id, event);
    });

    return detectedEvents;
  }

  /**
   * Detect excessive data access
   */
  private async detectExcessiveDataAccess(
    logs: Awaited<ReturnType<AuditLogger['queryLogs']>>,
    useBaseline?: boolean
  ): Promise<SecurityEvent[]> {
    const events: SecurityEvent[] = [];
    const userAccessCounts = new Map<string, { count: number; sessionId?: string }>();

    // Count accesses per user
    logs.forEach((log) => {
      if (log.eventType === 'memory_searched') {
        const current = userAccessCounts.get(log.userId) || { count: 0 };
        userAccessCounts.set(log.userId, {
          count: current.count + 1,
          sessionId: log.sessionId,
        });
      }
    });

    // Check for excessive access
    for (const [userId, data] of userAccessCounts.entries()) {
      let isExcessive = false;
      let threatLevel: ThreatLevel = 'warning';
      const baseline = this.userBaselines.get(userId);

      if (useBaseline && baseline) {
        // Use baseline comparison
        if (data.count >= baseline * this.BASELINE_MULTIPLIER) {
          isExcessive = true;
          threatLevel = 'critical';
        }
      } else {
        // Use absolute threshold
        if (data.count >= this.EXCESSIVE_ACCESS_THRESHOLD) {
          isExcessive = true;
          if (data.count >= this.EXCESSIVE_ACCESS_THRESHOLD * 1.2) {
            threatLevel = 'critical';
          } else if (data.count >= this.EXCESSIVE_ACCESS_THRESHOLD * 1.1) {
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
          sessionId: data.sessionId,
          description: `Excessive data access detected: ${data.count} accesses in time window`,
          metadata: {
            count: data.count,
            ...(baseline && { baseline }),
            ...(baseline && { current: data.count }),
          },
          recommendedActions: [
            'Terminate session',
            'Review access patterns',
            'Contact security team',
          ],
        });
      }
    }

    return events;
  }

  /**
   * Detect unknown IP access
   */
  private async detectUnknownIpAccess(
    logs: Awaited<ReturnType<AuditLogger['queryLogs']>>
  ): Promise<SecurityEvent[]> {
    const events: SecurityEvent[] = [];

    for (const log of logs) {
      const knownUserIps = this.knownIps.get(log.userId);

      if (knownUserIps && !knownUserIps.has(log.ipAddress)) {
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
            knownIps: Array.from(knownUserIps),
          },
          recommendedActions: ['Verify user identity', 'Monitor session'],
        });
      }
    }

    return events;
  }

  /**
   * Detect bulk export attempts
   */
  private async detectBulkExportAttempts(
    logs: Awaited<ReturnType<AuditLogger['queryLogs']>>
  ): Promise<SecurityEvent[]> {
    const events: SecurityEvent[] = [];
    const sessionAccessCounts = new Map<string, { count: number; userId: string }>();

    // Count accesses per session
    logs.forEach((log) => {
      if (log.eventType === 'memory_searched') {
        const current = sessionAccessCounts.get(log.sessionId) || { count: 0, userId: log.userId };
        sessionAccessCounts.set(log.sessionId, {
          count: current.count + 1,
          userId: log.userId,
        });
      }
    });

    // Check for bulk export
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
   * Detect auth failure spikes
   */
  private async detectAuthFailureSpikes(
    logs: Awaited<ReturnType<AuditLogger['queryLogs']>>
  ): Promise<SecurityEvent[]> {
    const events: SecurityEvent[] = [];
    const authFailureCounts = new Map<string, { count: number; userId: string }>();

    // Count auth failures per IP
    logs.forEach((log) => {
      if (log.eventType === 'auth_failed') {
        const current = authFailureCounts.get(log.ipAddress) || { count: 0, userId: log.userId };
        authFailureCounts.set(log.ipAddress, {
          count: current.count + 1,
          userId: log.userId,
        });
      }
    });

    // Check for auth failure spikes
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
   * Classify threat level
   *
   * @param event - Security event
   * @returns Threat level
   */
  classifyThreatLevel(event: SecurityEvent): ThreatLevel {
    return event.threatLevel;
  }

  /**
   * Get security events
   *
   * @param query - Query parameters
   * @returns Matching security events
   */
  async getSecurityEvents(query: SecurityEventQuery): Promise<SecurityEvent[]> {
    let results = Array.from(this.securityEvents.values());

    // Apply filters
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

    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return results;
  }

  /**
   * Register known IP for a user
   *
   * @param userId - User ID
   * @param ipAddress - IP address
   */
  async registerKnownIp(userId: string, ipAddress: string): Promise<void> {
    if (!this.knownIps.has(userId)) {
      this.knownIps.set(userId, new Set());
    }

    this.knownIps.get(userId)!.add(ipAddress);
  }

  /**
   * Get known IPs for a user
   *
   * @param userId - User ID
   * @returns Known IP addresses
   */
  async getKnownIps(userId: string): Promise<string[]> {
    const ips = this.knownIps.get(userId);
    return ips ? Array.from(ips) : [];
  }

  /**
   * Establish baseline access count for a user
   *
   * @param userId - User ID
   * @param count - Baseline access count
   */
  async establishBaseline(userId: string, count: number): Promise<void> {
    this.userBaselines.set(userId, count);
  }

  /**
   * Get baseline for a user
   *
   * @param userId - User ID
   * @returns Baseline access count
   */
  async getBaseline(userId: string): Promise<number | undefined> {
    return this.userBaselines.get(userId);
  }

  /**
   * Filter valid logs by verifying audit log signatures
   *
   * @param logs - Audit logs to filter
   * @returns Object containing valid logs and count of invalid logs
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
        // Log invalid entry for audit purposes
        console.warn(
          `[SecurityEventDetector] Invalid signature detected for audit log: ${log.id} ` +
            `(eventType: ${log.eventType}, userId: ${log.userId}, timestamp: ${log.timestamp.toISOString()})`
        );
      }
    }

    return { validLogs, invalidCount };
  }
}
