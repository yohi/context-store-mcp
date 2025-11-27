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
import { AuditLogger } from './audit-logger.js';

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
 * Security event with metadata for retention management
 */
interface SecurityEventWithMetadata {
  event: SecurityEvent;
  timestamp: Date;
}

/**
 * Known IP entry with TTL tracking
 */
interface KnownIpEntry {
  ips: Set<string>;
  lastAccess: Date;
}

/**
 * User baseline entry with TTL tracking
 */
interface UserBaselineEntry {
  baseline: number;
  lastAccess: Date;
}

/**
 * Retention configuration
 */
interface RetentionConfig {
  /** Security events retention in days (default: 365) */
  securityEventsRetentionDays: number;
  /** Known IPs TTL in days (default: 90) */
  knownIpsTTLDays: number;
  /** User baselines TTL in days (default: 90) */
  userBaselinesTTLDays: number;
  /** Maximum security events to store (default: 10000) */
  maxSecurityEvents: number;
  /** Maximum known IP entries (default: 5000) */
  maxKnownIpEntries: number;
  /** Maximum user baseline entries (default: 5000) */
  maxUserBaselineEntries: number;
  /** Cleanup interval in milliseconds (default: 1 hour) */
  cleanupIntervalMs: number;
}

/**
 * Default retention configuration
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
 * Security Event Detector
 *
 * Detects security anomalies and potential data leakage
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

  // Threat level multipliers for absolute threshold detection
  // Important: 110% of threshold, Critical: 120% of threshold
  private readonly EXCESSIVE_ACCESS_IMPORTANT_MULTIPLIER = 1.1;
  private readonly EXCESSIVE_ACCESS_CRITICAL_MULTIPLIER = 1.2;

  constructor(auditLogger: AuditLogger, retentionConfig?: Partial<RetentionConfig>) {
    this.auditLogger = auditLogger;
    this.securityEvents = new Map();
    this.knownIps = new Map();
    this.userBaselines = new Map();
    this.retentionConfig = { ...DEFAULT_RETENTION_CONFIG, ...retentionConfig };

    // Start periodic cleanup
    this.startCleanupTask();
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

    // Store detected events with metadata
    detectedEvents.forEach((event) => {
      this.securityEvents.set(event.id, {
        event,
        timestamp: event.timestamp,
      });
    });

    // Opportunistic cleanup if needed
    this.opportunisticCleanup();

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
      const entry = this.userBaselines.get(userId);

      if (useBaseline && entry) {
        // Update last access time
        entry.lastAccess = new Date();

        // Use baseline comparison
        if (data.count >= entry.baseline * this.BASELINE_MULTIPLIER) {
          isExcessive = true;
          threatLevel = 'critical';
        }
      } else {
        // Use absolute threshold
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
   * Detect unknown IP access
   */
  private async detectUnknownIpAccess(
    logs: Awaited<ReturnType<AuditLogger['queryLogs']>>
  ): Promise<SecurityEvent[]> {
    const events: SecurityEvent[] = [];
    const seenKeys = new Set<string>(); // Track userId|ipAddress to deduplicate

    for (const log of logs) {
      const entry = this.knownIps.get(log.userId);
      const dedupeKey = `${log.userId}|${log.ipAddress}`;

      // Skip if we've already seen this userId+IP combination
      if (seenKeys.has(dedupeKey)) {
        continue;
      }

      // Treat undefined entry as empty known IPs set
      const knownIps = entry?.ips || new Set<string>();

      // Check if this IP is unknown
      if (!knownIps.has(log.ipAddress)) {
        // Update last access time if entry exists
        if (entry) {
          entry.lastAccess = new Date();
        }

        // Mark this combination as seen
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
    // Extract events from metadata wrapper
    let results = Array.from(this.securityEvents.values()).map((entry) => entry.event);

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

    // Opportunistic cleanup if needed
    this.opportunisticCleanup();
  }

  /**
   * Get known IPs for a user
   *
   * @param userId - User ID
   * @returns Known IP addresses
   */
  async getKnownIps(userId: string): Promise<string[]> {
    const entry = this.knownIps.get(userId);

    if (entry) {
      // Update last access time
      entry.lastAccess = new Date();
      return Array.from(entry.ips);
    }

    return [];
  }

  /**
   * Establish baseline access count for a user
   *
   * @param userId - User ID
   * @param count - Baseline access count
   */
  async establishBaseline(userId: string, count: number): Promise<void> {
    this.userBaselines.set(userId, {
      baseline: count,
      lastAccess: new Date(),
    });

    // Opportunistic cleanup if needed
    this.opportunisticCleanup();
  }

  /**
   * Get baseline for a user
   *
   * @param userId - User ID
   * @returns Baseline access count
   */
  async getBaseline(userId: string): Promise<number | undefined> {
    const entry = this.userBaselines.get(userId);

    if (entry) {
      // Update last access time
      entry.lastAccess = new Date();
      return entry.baseline;
    }

    return undefined;
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

  /**
   * Start periodic cleanup task
   */
  private startCleanupTask(): void {
    this.cleanupTimer = setInterval(() => {
      this.performCleanup();
    }, this.retentionConfig.cleanupIntervalMs);

    // Ensure timer doesn't prevent process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Stop cleanup task
   */
  stopCleanupTask(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      delete this.cleanupTimer;
    }
  }

  /**
   * Perform cleanup of expired entries
   *
   * Removes entries based on TTL and size limits
   * Non-blocking - processes in batches to avoid long pauses
   */
  private performCleanup(): void {
    const now = new Date();

    // Clean up security events
    this.cleanupSecurityEvents(now);

    // Clean up known IPs
    this.cleanupKnownIps(now);

    // Clean up user baselines
    this.cleanupUserBaselines(now);
  }

  /**
   * Clean up security events based on retention policy
   */
  private cleanupSecurityEvents(now: Date): void {
    const retentionMs = this.retentionConfig.securityEventsRetentionDays * 24 * 60 * 60 * 1000;
    const cutoffTime = new Date(now.getTime() - retentionMs);

    // Remove expired entries
    for (const [id, entry] of this.securityEvents.entries()) {
      if (entry.timestamp < cutoffTime) {
        this.securityEvents.delete(id);
      }
    }

    // Enforce max size by removing oldest entries
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
   * Clean up known IPs based on TTL
   */
  private cleanupKnownIps(now: Date): void {
    const ttlMs = this.retentionConfig.knownIpsTTLDays * 24 * 60 * 60 * 1000;
    const cutoffTime = new Date(now.getTime() - ttlMs);

    // Remove expired entries
    for (const [userId, entry] of this.knownIps.entries()) {
      if (entry.lastAccess < cutoffTime) {
        this.knownIps.delete(userId);
      }
    }

    // Enforce max size by removing least recently accessed
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
   * Clean up user baselines based on TTL
   */
  private cleanupUserBaselines(now: Date): void {
    const ttlMs = this.retentionConfig.userBaselinesTTLDays * 24 * 60 * 60 * 1000;
    const cutoffTime = new Date(now.getTime() - ttlMs);

    // Remove expired entries
    for (const [userId, entry] of this.userBaselines.entries()) {
      if (entry.lastAccess < cutoffTime) {
        this.userBaselines.delete(userId);
      }
    }

    // Enforce max size by removing least recently accessed
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
   * Opportunistically clean up entries on access
   *
   * Checks size limits and performs cleanup if needed
   * This prevents cleanup spikes during periodic tasks
   */
  private opportunisticCleanup(): void {
    const now = new Date();

    // Quick size checks - only clean if over limits
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
