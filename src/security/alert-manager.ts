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

import { randomUUID } from 'crypto';
import { SecurityEvent, ThreatLevel } from './security-event-detector';

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
  userId?: string;
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

    for (const channel of channels) {
      switch (channel) {
        case 'log':
          this.logAlert(event);
          break;

        case 'email':
          if (this.senders.email) {
            await this.sendEmailAlert(event);
          }
          break;

        case 'sms':
          if (this.senders.sms) {
            await this.sendSmsAlert(event);
          }
          break;

        case 'pagerDuty':
          if (this.senders.pagerDuty) {
            await this.sendPagerDutyAlert(event);
          }
          break;
      }
    }

    // Record alert
    this.alertHistory.set(alertId, {
      id: alertId,
      timestamp: new Date(),
      securityEventId: event.id,
      threatLevel: event.threatLevel,
      userId: event.userId || null,
      channels,
      delivered: true,
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

    // Suspend session
    let sessionSuspended = false;
    let suspensionDuration: number | undefined;

    if (event.sessionId) {
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      this.suspendedSessions.set(event.sessionId, expiresAt);
      sessionSuspended = true;
      suspensionDuration = 3600; // seconds
      actions.push('Session suspended for 1 hour');
    }

    // Block IP
    let ipBlocked = false;
    let blockedIp: string | undefined;
    let blockDuration: number | undefined;

    if (event.metadata?.ipAddress && typeof event.metadata.ipAddress === 'string') {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      this.blockedIps.set(event.metadata.ipAddress, expiresAt);
      ipBlocked = true;
      blockedIp = event.metadata.ipAddress;
      blockDuration = 86400; // seconds
      actions.push(`IP address ${blockedIp} blocked for 24 hours`);
    }

    // Generate dashboard link
    const dashboardLink = `${this.config.dashboardUrl}?event=${event.id}`;
    actions.push(`Alert dashboard: ${dashboardLink}`);

    return {
      sessionSuspended,
      suspensionDuration,
      ipBlocked,
      blockedIp,
      blockDuration,
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

    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

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
   * Log alert
   */
  private logAlert(event: SecurityEvent): void {
    console.log('[SECURITY ALERT]', {
      timestamp: event.timestamp.toISOString(),
      threatLevel: event.threatLevel,
      anomalyPattern: event.anomalyPattern,
      userId: event.userId,
      description: event.description,
    });
  }

  /**
   * Send email alert
   */
  private async sendEmailAlert(event: SecurityEvent): Promise<void> {
    const subject = `[SECURITY ALERT] ${event.threatLevel.toUpperCase()}: ${event.anomalyPattern}`;

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

Dashboard: ${this.config.dashboardUrl}
    `.trim();

    await this.senders.email!({
      subject,
      body,
      recipients: this.config.emailRecipients,
    });
  }

  /**
   * Send SMS alert
   */
  private async sendSmsAlert(event: SecurityEvent): Promise<void> {
    const message = `[SECURITY] ${event.threatLevel.toUpperCase()}: ${event.anomalyPattern} - User: ${event.userId}. Dashboard: ${this.config.dashboardUrl}`;

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
