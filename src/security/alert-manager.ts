/**
 * Alert Manager
 *
 * Requirements: 6.6 - データ漏洩のリスク検出と通知
 * - 通知チャネルとしきい値:
 *   - レベル1（警告）: ログファイルに記録のみ（上記条件の50%達成時）
 *   - レベル2（重要）: メール通知を管理者チームに送信（75%達成時）
 *   - レベル3（緊急）: SMSまたはPagerDuty/Opsgenieで即座に通知（100%達成時）、該当セッションを終了
 * - 自動応答アクション:
 *   - ユーザー/セッションの一時停止（最大1時間）
 *   - IPアドレスのブロック（24時間）
 *   - 緊急アラートダッシュボードへのリンク通知
 */

import { randomUUID, createHash } from 'crypto';
import type { SecurityEvent, ThreatLevel } from './security-event-detector.js';

/**
 * Alert channel
 */
export type AlertChannel = 'log' | 'email' | 'sms' | 'pagerDuty';

/**
 * Alert configuration
 */
export interface AlertConfig {
  emailRecipients: string[];
  smsRecipients: string[];
  pagerDutyIntegrationKey: string;
  dashboardUrl: string;
}

/**
 * Email parameters
 */
export interface EmailParams {
  subject: string;
  body: string;
  recipients: string[];
}

/**
 * SMS parameters
 */
export interface SmsParams {
  message: string;
  recipients: string[];
}

/**
 * PagerDuty parameters
 */
export interface PagerDutyParams {
  severity: 'critical' | 'error' | 'warning';
  summary: string;
  details: Record<string, unknown>;
  integrationKey: string;
}

/**
 * Alert senders
 */
export interface AlertSenders {
  email?: (params: EmailParams) => Promise<void>;
  sms?: (params: SmsParams) => Promise<void>;
  pagerDuty?: (params: PagerDutyParams) => Promise<void>;
}

/**
 * Channel delivery status
 */
export interface ChannelDeliveryStatus {
  channel: AlertChannel;
  success: boolean;
  error?: string;
}

/**
 * Alert record
 */
export interface AlertRecord {
  id: string;
  timestamp: Date;
  securityEventId: string;
  threatLevel: ThreatLevel;
  userId: string | null;
  channels: AlertChannel[];
  delivered: boolean;
  deliveryStatus: ChannelDeliveryStatus[];
}

/**
 * Automated response result
 */
export interface AutomatedResponseResult {
  sessionSuspended: boolean;
  suspensionDuration?: number;
  ipBlocked: boolean;
  blockedIp?: string;
  blockDuration?: number;
  dashboardLink: string;
  executedActions: string[];
}

/**
 * Alert history query
 */
export interface AlertHistoryQuery {
  startTime?: Date;
  endTime?: Date;
  threatLevel?: ThreatLevel;
  userId?: string | null;
}

/**
 * Alert Manager
 *
 * Manages security alert notifications and automated responses
 */
export class AlertManager {
  private config: AlertConfig;
  private senders: AlertSenders;
  private alertHistory: Map<string, AlertRecord>;
  private suspendedSessions: Map<string, Date>; // sessionId -> expiresAt
  private blockedIps: Map<string, Date>; // ipAddress -> expiresAt

  constructor(config: AlertConfig, senders?: AlertSenders) {
    this.config = config;
    this.senders = senders || {};
    this.alertHistory = new Map();
    this.suspendedSessions = new Map();
    this.blockedIps = new Map();
  }

  /**
   * Send alert through specified channels
   *
   * @param event - Security event
   * @param channels - Alert channels to use
   */
  async sendAlert(event: SecurityEvent, channels: AlertChannel[]): Promise<void> {
    const alertId = randomUUID();

    // Deduplicate channels
    const uniqueChannels = Array.from(new Set(channels));

    // Track delivery status for each channel
    const deliveryStatus: ChannelDeliveryStatus[] = [];

    // Attempt to send to each channel
    for (const channel of uniqueChannels) {
      try {
        switch (channel) {
          case 'log':
            this.logAlert(event);
            deliveryStatus.push({ channel, success: true });
            break;

          case 'email':
            if (!this.senders.email) {
              deliveryStatus.push({
                channel,
                success: false,
                error: 'Email sender not configured',
              });
            } else {
              await this.sendEmailAlert(event);
              deliveryStatus.push({ channel, success: true });
            }
            break;

          case 'sms':
            if (!this.senders.sms) {
              deliveryStatus.push({
                channel,
                success: false,
                error: 'SMS sender not configured',
              });
            } else {
              await this.sendSmsAlert(event);
              deliveryStatus.push({ channel, success: true });
            }
            break;

          case 'pagerDuty':
            if (!this.senders.pagerDuty) {
              deliveryStatus.push({
                channel,
                success: false,
                error: 'PagerDuty sender not configured',
              });
            } else {
              await this.sendPagerDutyAlert(event);
              deliveryStatus.push({ channel, success: true });
            }
            break;
        }
      } catch (error) {
        // Record failure for this channel but continue with others
        deliveryStatus.push({
          channel,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Alert is delivered only if there are channels AND all channels succeeded
    const delivered =
      uniqueChannels.length > 0 && deliveryStatus.every((status) => status.success);

    // Record alert
    this.alertHistory.set(alertId, {
      id: alertId,
      timestamp: new Date(),
      securityEventId: event.id,
      threatLevel: event.threatLevel,
      userId: event.userId || null,
      channels: uniqueChannels,
      delivered,
      deliveryStatus,
    });
  }

  /**
   * Execute automated response to security event
   *
   * @param event - Security event
   * @returns Automated response result
   */
  async executeAutomatedResponse(event: SecurityEvent): Promise<AutomatedResponseResult> {
    const actions: string[] = [];

    // Suspend session (only for critical threats)
    let sessionSuspended = false;
    let suspensionDuration: number | undefined;

    if (event.threatLevel === 'critical' && event.sessionId) {
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      this.suspendedSessions.set(event.sessionId, expiresAt);
      sessionSuspended = true;
      suspensionDuration = 3600; // seconds
      actions.push('Session suspended for 1 hour');
    }

    // Block IP (only for critical threats)
    let ipBlocked = false;
    let blockedIp: string | undefined;
    let blockDuration: number | undefined;

    if (
      event.threatLevel === 'critical' &&
      event.metadata?.['ipAddress'] &&
      typeof event.metadata['ipAddress'] === 'string'
    ) {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      this.blockedIps.set(event.metadata['ipAddress'], expiresAt);
      ipBlocked = true;
      blockedIp = event.metadata['ipAddress'];
      blockDuration = 86400; // seconds
      actions.push(`IP address ${blockedIp} blocked for 24 hours`);
    }

    // Generate dashboard link with properly encoded event ID
    const dashboardLink = `${this.config.dashboardUrl}?event=${encodeURIComponent(event.id)}`;
    actions.push(`Alert dashboard: ${dashboardLink}`);

    return {
      sessionSuspended,
      ...(suspensionDuration !== undefined ? { suspensionDuration } : {}),
      ipBlocked,
      ...(blockedIp !== undefined ? { blockedIp } : {}),
      ...(blockDuration !== undefined ? { blockDuration } : {}),
      dashboardLink,
      executedActions: actions,
    };
  }

  /**
   * Get alert history
   *
   * @param query - Query parameters
   * @returns Alert records
   */
  async getAlertHistory(query?: AlertHistoryQuery): Promise<AlertRecord[]> {
    let results = Array.from(this.alertHistory.values());

    if (query) {
      if (query.startTime) {
        results = results.filter((alert) => alert.timestamp >= query.startTime!);
      }

      if (query.endTime) {
        results = results.filter((alert) => alert.timestamp <= query.endTime!);
      }

      if (query.threatLevel) {
        results = results.filter((alert) => alert.threatLevel === query.threatLevel);
      }

      if (query.userId !== undefined) {
        results = results.filter((alert) => alert.userId === query.userId);
      }
    }

    // Sort by timestamp descending, then by ID for stable ordering
    results.sort((a, b) => {
      const timeDiff = b.timestamp.getTime() - a.timestamp.getTime();
      if (timeDiff !== 0) {
        return timeDiff;
      }
      // Use ID as tiebreaker for stable sorting
      return b.id.localeCompare(a.id);
    });

    return results;
  }

  /**
   * Check if session is suspended
   *
   * @param sessionId - Session ID
   * @returns True if suspended, false otherwise
   */
  async isSessionSuspended(sessionId: string): Promise<boolean> {
    const expiresAt = this.suspendedSessions.get(sessionId);
    if (!expiresAt) {
      return false;
    }

    // Check if suspension has expired
    if (expiresAt < new Date()) {
      this.suspendedSessions.delete(sessionId);
      return false;
    }

    return true;
  }

  /**
   * Check if IP is blocked
   *
   * @param ipAddress - IP address
   * @returns True if blocked, false otherwise
   */
  async isIpBlocked(ipAddress: string): Promise<boolean> {
    const expiresAt = this.blockedIps.get(ipAddress);
    if (!expiresAt) {
      return false;
    }

    // Check if block has expired
    if (expiresAt < new Date()) {
      this.blockedIps.delete(ipAddress);
      return false;
    }

    return true;
  }

  /**
   * Expire session suspension (for testing)
   *
   * @param sessionId - Session ID
   */
  async expireSuspension(sessionId: string): Promise<void> {
    this.suspendedSessions.delete(sessionId);
  }

  /**
   * Hash user ID for PII-safe logging
   *
   * Uses SHA-256 one-way hash and truncates to 12 characters for brevity
   * while maintaining uniqueness for correlation purposes.
   * If userId is undefined or empty, returns a deterministic placeholder.
   *
   * @param userId - User ID to hash (can be undefined)
   * @returns Truncated hash in format "user_xxxxx" or "user_<missing>" for undefined/empty
   */
  private hashUserId(userId: string | undefined): string {
    // Treat undefined or empty string as a deterministic placeholder
    const id = userId ?? '<missing>';
    const hash = createHash('sha256').update(id).digest('hex');
    return `user_${hash.substring(0, 12)}`;
  }

  /**
   * Sanitize description for PII-safe logging
   *
   * Removes potential PII and keeps only high-level security event information.
   * Returns a non-PII summary with severity and anomaly pattern.
   *
   * @param description - Original description
   * @param event - Security event for context
   * @returns Sanitized description without PII
   */
  private sanitizeDescription(event: SecurityEvent): string {
    // Return only non-PII summary: severity code and anomaly pattern
    return `Security event detected: ${event.anomalyPattern} (threat level: ${event.threatLevel})`;
  }

  /**
   * Log alert (PII-safe)
   *
   * Logs security alerts with hashed user identifiers and sanitized descriptions
   * to prevent PII leakage in console logs.
   */
  private logAlert(event: SecurityEvent): void {
    console.log('[SECURITY ALERT]', {
      eventId: event.id,
      timestamp: event.timestamp.toISOString(),
      threatLevel: event.threatLevel,
      anomalyPattern: event.anomalyPattern,
      userIdHash: this.hashUserId(event.userId),
      description: this.sanitizeDescription(event),
    });
  }

  /**
   * Send email alert
   */
  private async sendEmailAlert(event: SecurityEvent): Promise<void> {
    const subject = `[SECURITY ALERT] ${event.threatLevel.toUpperCase()}: ${event.anomalyPattern}`;

    // Generate dashboard link with properly encoded event ID
    const dashboardLink = `${this.config.dashboardUrl}?event=${encodeURIComponent(event.id)}`;

    const body = `
Security Alert Notification

Timestamp: ${event.timestamp.toISOString()}
Threat Level: ${event.threatLevel.toUpperCase()}
Anomaly Pattern: ${event.anomalyPattern}
User ID: ${event.userId}
Session ID: ${event.sessionId || 'N/A'}

Description:
${event.description}

${event.recommendedActions ? `Recommended Actions:\n${event.recommendedActions.map((a) => `- ${a}`).join('\n')}` : ''}

Dashboard: ${dashboardLink}
    `.trim();

    await this.senders.email!({
      subject,
      body,
      recipients: this.config.emailRecipients,
    });
  }

  /**
   * Send SMS alert (PII-safe)
   *
   * Sends SMS notifications without PII. Only includes event ID and
   * non-sensitive status information. Recipients must access the
   * dashboard for full details.
   */
  private async sendSmsAlert(event: SecurityEvent): Promise<void> {
    // Generate dashboard link with properly encoded event ID
    const dashboardLink = `${this.config.dashboardUrl}?event=${encodeURIComponent(event.id)}`;

    // PII-safe message: Only event ID, severity, and non-identifying information
    const message = `[SECURITY] ${event.threatLevel.toUpperCase()}: ${event.anomalyPattern} detected. Event ID: ${event.id.substring(0, 8)}. Dashboard: ${dashboardLink}`;

    await this.senders.sms!({
      message,
      recipients: this.config.smsRecipients,
    });
  }

  /**
   * Send PagerDuty alert
   */
  private async sendPagerDutyAlert(event: SecurityEvent): Promise<void> {
    const severity = event.threatLevel === 'critical' ? 'critical' : 'error';

    await this.senders.pagerDuty!({
      severity,
      summary: `Security Alert: ${event.anomalyPattern}`,
      details: {
        timestamp: event.timestamp.toISOString(),
        threatLevel: event.threatLevel,
        userId: event.userId,
        sessionId: event.sessionId,
        description: event.description,
        metadata: event.metadata,
      },
      integrationKey: this.config.pagerDutyIntegrationKey,
    });
  }
}
