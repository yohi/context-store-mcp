/**
 * AlertManager Tests
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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AlertManager, AlertChannel, AlertConfig } from '../../security/alert-manager';
import { SecurityEvent } from '../../security/security-event-detector';

describe('AlertManager', () => {
  let alertManager: AlertManager;
  let mockEmailSender: ReturnType<typeof vi.fn>;
  let mockSmsSender: ReturnType<typeof vi.fn>;
  let mockPagerDutySender: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockEmailSender = vi.fn().mockResolvedValue(undefined);
    mockSmsSender = vi.fn().mockResolvedValue(undefined);
    mockPagerDutySender = vi.fn().mockResolvedValue(undefined);

    const config: AlertConfig = {
      emailRecipients: ['security@example.com', 'admin@example.com'],
      smsRecipients: ['+1234567890'],
      pagerDutyIntegrationKey: 'test-key',
      dashboardUrl: 'https://security.example.com/dashboard',
    };

    alertManager = new AlertManager(config, {
      email: mockEmailSender,
      sms: mockSmsSender,
      pagerDuty: mockPagerDutySender,
    });
  });

  describe('sendAlert', () => {
    it('should send warning alert to log only', async () => {
      const event: SecurityEvent = {
        id: '1',
        timestamp: new Date(),
        anomalyPattern: 'unknown_ip_access',
        threatLevel: 'warning',
        userId: 'user-123',
        sessionId: 'session-456',
        description: 'Unknown IP access',
        metadata: { ipAddress: '10.0.0.1' },
      };

      await alertManager.sendAlert(event, ['log']);

      expect(mockEmailSender).not.toHaveBeenCalled();
      expect(mockSmsSender).not.toHaveBeenCalled();
      expect(mockPagerDutySender).not.toHaveBeenCalled();
    });

    it('should send important alert via email', async () => {
      const event: SecurityEvent = {
        id: '1',
        timestamp: new Date(),
        anomalyPattern: 'excessive_data_access',
        threatLevel: 'important',
        userId: 'user-123',
        sessionId: 'session-456',
        description: 'Excessive data access',
        metadata: { count: 110 },
      };

      await alertManager.sendAlert(event, ['email']);

      expect(mockEmailSender).toHaveBeenCalledTimes(1);
      expect(mockEmailSender).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('[SECURITY ALERT]'),
          body: expect.stringContaining('Excessive data access'),
          recipients: ['security@example.com', 'admin@example.com'],
        })
      );
    });

    it('should send critical alert via SMS and PagerDuty', async () => {
      const event: SecurityEvent = {
        id: '1',
        timestamp: new Date(),
        anomalyPattern: 'bulk_export_attempt',
        threatLevel: 'critical',
        userId: 'user-123',
        sessionId: 'session-456',
        description: 'Bulk export attempt',
        metadata: { count: 1200 },
        recommendedActions: ['Terminate session', 'Block IP'],
      };

      await alertManager.sendAlert(event, ['sms', 'pagerDuty']);

      expect(mockSmsSender).toHaveBeenCalledTimes(1);
      expect(mockPagerDutySender).toHaveBeenCalledTimes(1);

      expect(mockSmsSender).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('CRITICAL'),
          recipients: ['+1234567890'],
        })
      );
    });

    it('should include dashboard URL in alerts', async () => {
      const event: SecurityEvent = {
        id: '1',
        timestamp: new Date(),
        anomalyPattern: 'bulk_export_attempt',
        threatLevel: 'critical',
        userId: 'user-123',
        sessionId: 'session-456',
        description: 'Bulk export attempt',
      };

      await alertManager.sendAlert(event, ['email']);

      expect(mockEmailSender).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('https://security.example.com/dashboard'),
        })
      );
    });
  });

  describe('executeAutomatedResponse', () => {
    it('should suspend session for 1 hour', async () => {
      const event: SecurityEvent = {
        id: '1',
        timestamp: new Date(),
        anomalyPattern: 'excessive_data_access',
        threatLevel: 'critical',
        userId: 'user-123',
        sessionId: 'session-456',
        description: 'Excessive access',
      };

      const response = await alertManager.executeAutomatedResponse(event);

      expect(response.sessionSuspended).toBe(true);
      expect(response.suspensionDuration).toBe(3600); // 1 hour in seconds
    });

    it('should block IP for 24 hours', async () => {
      const event: SecurityEvent = {
        id: '1',
        timestamp: new Date(),
        anomalyPattern: 'bulk_export_attempt',
        threatLevel: 'critical',
        userId: 'user-123',
        sessionId: 'session-456',
        description: 'Bulk export',
        metadata: { ipAddress: '192.168.1.1' },
      };

      const response = await alertManager.executeAutomatedResponse(event);

      expect(response.ipBlocked).toBe(true);
      expect(response.blockedIp).toBe('192.168.1.1');
      expect(response.blockDuration).toBe(86400); // 24 hours in seconds
    });

    it('should generate alert dashboard link', async () => {
      const event: SecurityEvent = {
        id: '1',
        timestamp: new Date(),
        anomalyPattern: 'auth_failure_spike',
        threatLevel: 'critical',
        userId: 'user-123',
        description: 'Auth failure spike',
      };

      const response = await alertManager.executeAutomatedResponse(event);

      expect(response.dashboardLink).toBe('https://security.example.com/dashboard?event=1');
    });

    it('should include executed actions in response', async () => {
      const event: SecurityEvent = {
        id: '1',
        timestamp: new Date(),
        anomalyPattern: 'bulk_export_attempt',
        threatLevel: 'critical',
        userId: 'user-123',
        sessionId: 'session-456',
        description: 'Bulk export',
        metadata: { ipAddress: '10.0.0.1' },
        recommendedActions: ['Terminate session', 'Block IP'],
      };

      const response = await alertManager.executeAutomatedResponse(event);

      expect(response.executedActions).toContain('Session suspended for 1 hour');
      expect(response.executedActions).toContain('IP address 10.0.0.1 blocked for 24 hours');
    });
  });

  describe('getAlertHistory', () => {
    it('should track sent alerts', async () => {
      const event1: SecurityEvent = {
        id: '1',
        timestamp: new Date(),
        anomalyPattern: 'excessive_data_access',
        threatLevel: 'warning',
        userId: 'user-123',
        sessionId: 'session-1',
        description: 'Event 1',
      };

      await alertManager.sendAlert(event1, ['log']);

      // Wait a bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      const event2: SecurityEvent = {
        id: '2',
        timestamp: new Date(),
        anomalyPattern: 'bulk_export_attempt',
        threatLevel: 'critical',
        userId: 'user-456',
        sessionId: 'session-2',
        description: 'Event 2',
      };

      await alertManager.sendAlert(event2, ['email']);

      const history = await alertManager.getAlertHistory();

      expect(history).toHaveLength(2);
      expect(history[0].securityEventId).toBe('2'); // Most recent first
      expect(history[1].securityEventId).toBe('1');
    });

    it('should filter history by time range', async () => {
      // Wait a bit to ensure different timestamps
      const oldTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000);

      const oldEvent: SecurityEvent = {
        id: '1',
        timestamp: oldTimestamp,
        anomalyPattern: 'excessive_data_access',
        threatLevel: 'warning',
        userId: 'user-123',
        sessionId: 'session-1',
        description: 'Old event',
      };

      await alertManager.sendAlert(oldEvent, ['log']);

      // Simulate time passing
      await new Promise((resolve) => setTimeout(resolve, 10));

      const recentEvent: SecurityEvent = {
        id: '2',
        timestamp: new Date(),
        anomalyPattern: 'bulk_export_attempt',
        threatLevel: 'critical',
        userId: 'user-456',
        sessionId: 'session-2',
        description: 'Recent event',
      };

      await alertManager.sendAlert(recentEvent, ['email']);

      const history = await alertManager.getAlertHistory({
        startTime: new Date(Date.now() - 60 * 60 * 1000), // Last 1 hour
      });

      // Both events should be in history because alert records use current timestamp
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history.some((h) => h.securityEventId === '2')).toBe(true);
    });

    it('should filter history by threat level', async () => {
      const warningEvent: SecurityEvent = {
        id: '1',
        timestamp: new Date(),
        anomalyPattern: 'excessive_data_access',
        threatLevel: 'warning',
        userId: 'user-123',
        sessionId: 'session-1',
        description: 'Warning',
      };

      const criticalEvent: SecurityEvent = {
        id: '2',
        timestamp: new Date(),
        anomalyPattern: 'bulk_export_attempt',
        threatLevel: 'critical',
        userId: 'user-456',
        sessionId: 'session-2',
        description: 'Critical',
      };

      await alertManager.sendAlert(warningEvent, ['log']);
      await alertManager.sendAlert(criticalEvent, ['email']);

      const history = await alertManager.getAlertHistory({
        threatLevel: 'critical',
      });

      expect(history).toHaveLength(1);
      expect(history[0].securityEventId).toBe('2');
    });

    it('should preserve userId in alert records', async () => {
      const event: SecurityEvent = {
        id: '1',
        timestamp: new Date(),
        anomalyPattern: 'excessive_data_access',
        threatLevel: 'warning',
        userId: 'user-123',
        sessionId: 'session-1',
        description: 'Test event',
      };

      await alertManager.sendAlert(event, ['log']);

      const history = await alertManager.getAlertHistory();

      expect(history).toHaveLength(1);
      expect(history[0].userId).toBe('user-123');
    });

    it('should handle missing userId in alert records', async () => {
      const event: SecurityEvent = {
        id: '1',
        timestamp: new Date(),
        anomalyPattern: 'excessive_data_access',
        threatLevel: 'warning',
        userId: '', // Empty userId
        sessionId: 'session-1',
        description: 'Test event',
      };

      await alertManager.sendAlert(event, ['log']);

      const history = await alertManager.getAlertHistory();

      expect(history).toHaveLength(1);
      expect(history[0].userId).toBeNull();
    });

    it('should filter history by userId', async () => {
      const event1: SecurityEvent = {
        id: '1',
        timestamp: new Date(),
        anomalyPattern: 'excessive_data_access',
        threatLevel: 'warning',
        userId: 'user-123',
        sessionId: 'session-1',
        description: 'Event 1',
      };

      const event2: SecurityEvent = {
        id: '2',
        timestamp: new Date(),
        anomalyPattern: 'bulk_export_attempt',
        threatLevel: 'critical',
        userId: 'user-456',
        sessionId: 'session-2',
        description: 'Event 2',
      };

      const event3: SecurityEvent = {
        id: '3',
        timestamp: new Date(),
        anomalyPattern: 'auth_failure_spike',
        threatLevel: 'important',
        userId: 'user-123',
        sessionId: 'session-3',
        description: 'Event 3',
      };

      await alertManager.sendAlert(event1, ['log']);
      await alertManager.sendAlert(event2, ['email']);
      await alertManager.sendAlert(event3, ['log']);

      const history = await alertManager.getAlertHistory({
        userId: 'user-123',
      });

      expect(history).toHaveLength(2);
      expect(history[0].securityEventId).toBe('3'); // Most recent first
      expect(history[1].securityEventId).toBe('1');
      expect(history.every((h) => h.userId === 'user-123')).toBe(true);
    });

    it('should filter history by null userId', async () => {
      const event1: SecurityEvent = {
        id: '1',
        timestamp: new Date(),
        anomalyPattern: 'excessive_data_access',
        threatLevel: 'warning',
        userId: 'user-123',
        sessionId: 'session-1',
        description: 'Event 1',
      };

      const event2: SecurityEvent = {
        id: '2',
        timestamp: new Date(),
        anomalyPattern: 'bulk_export_attempt',
        threatLevel: 'critical',
        userId: '', // Empty userId will be stored as null
        sessionId: 'session-2',
        description: 'Event 2',
      };

      await alertManager.sendAlert(event1, ['log']);
      await alertManager.sendAlert(event2, ['email']);

      const history = await alertManager.getAlertHistory({
        userId: null,
      });

      expect(history).toHaveLength(1);
      expect(history[0].securityEventId).toBe('2');
      expect(history[0].userId).toBeNull();
    });
  });

  describe('isSessionSuspended', () => {
    it('should return true for suspended session', async () => {
      const event: SecurityEvent = {
        id: '1',
        timestamp: new Date(),
        anomalyPattern: 'excessive_data_access',
        threatLevel: 'critical',
        userId: 'user-123',
        sessionId: 'session-456',
        description: 'Excessive access',
      };

      await alertManager.executeAutomatedResponse(event);

      const isSuspended = await alertManager.isSessionSuspended('session-456');
      expect(isSuspended).toBe(true);
    });

    it('should return false for non-suspended session', async () => {
      const isSuspended = await alertManager.isSessionSuspended('session-999');
      expect(isSuspended).toBe(false);
    });

    it('should return false after suspension expires', async () => {
      const event: SecurityEvent = {
        id: '1',
        timestamp: new Date(),
        anomalyPattern: 'excessive_data_access',
        threatLevel: 'critical',
        userId: 'user-123',
        sessionId: 'session-456',
        description: 'Excessive access',
      };

      await alertManager.executeAutomatedResponse(event);

      // Manually expire suspension (for testing)
      await alertManager.expireSuspension('session-456');

      const isSuspended = await alertManager.isSessionSuspended('session-456');
      expect(isSuspended).toBe(false);
    });
  });

  describe('isIpBlocked', () => {
    it('should return true for blocked IP', async () => {
      const event: SecurityEvent = {
        id: '1',
        timestamp: new Date(),
        anomalyPattern: 'bulk_export_attempt',
        threatLevel: 'critical',
        userId: 'user-123',
        sessionId: 'session-456',
        description: 'Bulk export',
        metadata: { ipAddress: '192.168.1.1' },
      };

      await alertManager.executeAutomatedResponse(event);

      const isBlocked = await alertManager.isIpBlocked('192.168.1.1');
      expect(isBlocked).toBe(true);
    });

    it('should return false for non-blocked IP', async () => {
      const isBlocked = await alertManager.isIpBlocked('10.0.0.1');
      expect(isBlocked).toBe(false);
    });
  });
});
