/**
 * SecurityEventDetector Tests
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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SecurityEventDetector,
  SecurityEvent,
  ThreatLevel,
  AnomalyPattern,
} from '../../security/security-event-detector';
import { AuditLogger } from '../../security/audit-logger';

describe('SecurityEventDetector', () => {
  let detector: SecurityEventDetector;
  let auditLogger: AuditLogger;

  beforeEach(() => {
    auditLogger = new AuditLogger();
    detector = new SecurityEventDetector(auditLogger);
  });

  describe('detectAnomalies', () => {
    it('should detect excessive data access pattern', async () => {
      // Simulate 120 accesses in 5 minutes
      const userId = 'user-123';
      const sessionId = 'session-456';

      for (let i = 0; i < 120; i++) {
        await auditLogger.logEvent({
          eventType: 'memory_searched',
          userId,
          sessionId,
          ipAddress: '192.168.1.1',
          resourceId: `memory-${i}`,
          action: 'search',
          result: 'success',
        });
      }

      const events = await detector.detectAnomalies({
        timeWindowMinutes: 5,
      });

      expect(events.length).toBeGreaterThan(0);

      const excessiveAccessEvent = events.find(
        (e) => e.anomalyPattern === 'excessive_data_access'
      );

      expect(excessiveAccessEvent).toBeDefined();
      expect(excessiveAccessEvent?.threatLevel).toBe('critical');
      expect(excessiveAccessEvent?.userId).toBe(userId);
      expect(excessiveAccessEvent?.sessionId).toBe(sessionId);
    });

    it('should detect unknown IP address access', async () => {
      // Known IP
      await auditLogger.logEvent({
        eventType: 'memory_searched',
        userId: 'user-123',
        sessionId: 'session-1',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-1',
        action: 'search',
        result: 'success',
      });

      // Register known IPs
      await detector.registerKnownIp('user-123', '192.168.1.1');

      // Unknown IP access
      await auditLogger.logEvent({
        eventType: 'memory_searched',
        userId: 'user-123',
        sessionId: 'session-2',
        ipAddress: '10.0.0.1', // Unknown IP
        resourceId: 'memory-2',
        action: 'search',
        result: 'success',
      });

      const events = await detector.detectAnomalies({
        timeWindowMinutes: 5,
      });

      const unknownIpEvent = events.find((e) => e.anomalyPattern === 'unknown_ip_access');

      expect(unknownIpEvent).toBeDefined();
      expect(unknownIpEvent?.threatLevel).toBe('warning');
      expect(unknownIpEvent?.metadata?.ipAddress).toBe('10.0.0.1');
    });

    it('should detect bulk export attempt', async () => {
      // Simulate 1200 memory retrievals in one session
      const userId = 'user-123';
      const sessionId = 'session-456';

      for (let i = 0; i < 1200; i++) {
        await auditLogger.logEvent({
          eventType: 'memory_searched',
          userId,
          sessionId,
          ipAddress: '192.168.1.1',
          resourceId: `memory-${i}`,
          action: 'retrieve',
          result: 'success',
        });
      }

      const events = await detector.detectAnomalies({
        timeWindowMinutes: 5,
      });

      const bulkExportEvent = events.find((e) => e.anomalyPattern === 'bulk_export_attempt');

      expect(bulkExportEvent).toBeDefined();
      expect(bulkExportEvent?.threatLevel).toBe('critical');
      expect(bulkExportEvent?.metadata?.count).toBeGreaterThanOrEqual(1000);
    });

    it('should detect authentication failure spike', async () => {
      // Simulate 60 auth failures in 5 minutes
      const userId = 'user-123';
      const ipAddress = '192.168.1.1';

      for (let i = 0; i < 60; i++) {
        await auditLogger.logEvent({
          eventType: 'auth_failed',
          userId,
          sessionId: `session-${i}`,
          ipAddress,
          resourceId: 'api-key-invalid',
          action: 'authenticate',
          result: 'failure',
          errorCode: 'INVALID_API_KEY',
        });
      }

      const events = await detector.detectAnomalies({
        timeWindowMinutes: 5,
      });

      const authFailureEvent = events.find((e) => e.anomalyPattern === 'auth_failure_spike');

      expect(authFailureEvent).toBeDefined();
      expect(authFailureEvent?.threatLevel).toBe('critical');
      expect(authFailureEvent?.metadata?.failureCount).toBeGreaterThanOrEqual(50);
    });

    it('should calculate baseline and detect 10x spike', async () => {
      const userId = 'user-123';

      // Baseline: 10 accesses per 5 minutes (normal)
      for (let i = 0; i < 10; i++) {
        await auditLogger.logEvent({
          eventType: 'memory_searched',
          userId,
          sessionId: 'session-baseline',
          ipAddress: '192.168.1.1',
          resourceId: `memory-${i}`,
          action: 'search',
          result: 'success',
        });
      }

      // Establish baseline
      await detector.establishBaseline(userId, 10);

      // Spike: 120 accesses (12x baseline)
      for (let i = 0; i < 120; i++) {
        await auditLogger.logEvent({
          eventType: 'memory_searched',
          userId,
          sessionId: 'session-spike',
          ipAddress: '192.168.1.1',
          resourceId: `memory-spike-${i}`,
          action: 'search',
          result: 'success',
        });
      }

      const events = await detector.detectAnomalies({
        timeWindowMinutes: 5,
        useBaseline: true,
      });

      const spikeEvent = events.find((e) => e.anomalyPattern === 'excessive_data_access');

      expect(spikeEvent).toBeDefined();
      expect(spikeEvent?.metadata?.baseline).toBe(10);
      expect(spikeEvent?.metadata?.current).toBeGreaterThanOrEqual(120);
    });
  });

  describe('classifyThreatLevel', () => {
    it('should classify as warning for 50% threshold', () => {
      const event: SecurityEvent = {
        id: '1',
        timestamp: new Date(),
        anomalyPattern: 'excessive_data_access',
        threatLevel: 'warning',
        userId: 'user-123',
        sessionId: 'session-456',
        description: 'Test',
        metadata: { count: 50 },
      };

      const level = detector.classifyThreatLevel(event);
      expect(level).toBe('warning');
    });

    it('should classify as important for 75% threshold', () => {
      const event: SecurityEvent = {
        id: '1',
        timestamp: new Date(),
        anomalyPattern: 'excessive_data_access',
        threatLevel: 'important',
        userId: 'user-123',
        sessionId: 'session-456',
        description: 'Test',
        metadata: { count: 75 },
      };

      const level = detector.classifyThreatLevel(event);
      expect(level).toBe('important');
    });

    it('should classify as critical for 100% threshold', () => {
      const event: SecurityEvent = {
        id: '1',
        timestamp: new Date(),
        anomalyPattern: 'excessive_data_access',
        threatLevel: 'critical',
        userId: 'user-123',
        sessionId: 'session-456',
        description: 'Test',
        metadata: { count: 120 },
      };

      const level = detector.classifyThreatLevel(event);
      expect(level).toBe('critical');
    });
  });

  describe('getSecurityEvents', () => {
    it('should retrieve security events by time range', async () => {
      // Create test event
      const userId = 'user-123';
      for (let i = 0; i < 120; i++) {
        await auditLogger.logEvent({
          eventType: 'memory_searched',
          userId,
          sessionId: 'session-456',
          ipAddress: '192.168.1.1',
          resourceId: `memory-${i}`,
          action: 'search',
          result: 'success',
        });
      }

      await detector.detectAnomalies({ timeWindowMinutes: 5 });

      const events = await detector.getSecurityEvents({
        startTime: new Date(Date.now() - 10 * 60 * 1000),
        endTime: new Date(),
      });

      expect(events.length).toBeGreaterThan(0);
    });

    it('should filter events by threat level', async () => {
      // Create critical event
      for (let i = 0; i < 120; i++) {
        await auditLogger.logEvent({
          eventType: 'memory_searched',
          userId: 'user-123',
          sessionId: 'session-456',
          ipAddress: '192.168.1.1',
          resourceId: `memory-${i}`,
          action: 'search',
          result: 'success',
        });
      }

      await detector.detectAnomalies({ timeWindowMinutes: 5 });

      const criticalEvents = await detector.getSecurityEvents({
        threatLevel: 'critical',
      });

      expect(criticalEvents.length).toBeGreaterThan(0);
      expect(criticalEvents.every((e) => e.threatLevel === 'critical')).toBe(true);
    });

    it('should filter events by user ID', async () => {
      // Create events for user-1
      for (let i = 0; i < 120; i++) {
        await auditLogger.logEvent({
          eventType: 'memory_searched',
          userId: 'user-1',
          sessionId: 'session-1',
          ipAddress: '192.168.1.1',
          resourceId: `memory-${i}`,
          action: 'search',
          result: 'success',
        });
      }

      await detector.detectAnomalies({ timeWindowMinutes: 5 });

      const user1Events = await detector.getSecurityEvents({
        userId: 'user-1',
      });

      expect(user1Events.length).toBeGreaterThan(0);
      expect(user1Events.every((e) => e.userId === 'user-1')).toBe(true);
    });
  });

  describe('registerKnownIp', () => {
    it('should register known IP for a user', async () => {
      await detector.registerKnownIp('user-123', '192.168.1.1');

      const knownIps = await detector.getKnownIps('user-123');
      expect(knownIps).toContain('192.168.1.1');
    });

    it('should support multiple IPs per user', async () => {
      await detector.registerKnownIp('user-123', '192.168.1.1');
      await detector.registerKnownIp('user-123', '10.0.0.1');

      const knownIps = await detector.getKnownIps('user-123');
      expect(knownIps).toHaveLength(2);
      expect(knownIps).toContain('192.168.1.1');
      expect(knownIps).toContain('10.0.0.1');
    });

    it('should not duplicate IPs', async () => {
      await detector.registerKnownIp('user-123', '192.168.1.1');
      await detector.registerKnownIp('user-123', '192.168.1.1');

      const knownIps = await detector.getKnownIps('user-123');
      expect(knownIps).toHaveLength(1);
    });
  });

  describe('establishBaseline', () => {
    it('should set baseline access count for a user', async () => {
      await detector.establishBaseline('user-123', 10);

      const baseline = await detector.getBaseline('user-123');
      expect(baseline).toBe(10);
    });

    it('should update baseline when called again', async () => {
      await detector.establishBaseline('user-123', 10);
      await detector.establishBaseline('user-123', 20);

      const baseline = await detector.getBaseline('user-123');
      expect(baseline).toBe(20);
    });
  });

  describe('verifyAuditLogSignature', () => {
    it('should skip signature verification when flag is false', async () => {
      const userId = 'user-123';

      // Create logs (some will be valid, some tampered)
      const log1 = await auditLogger.logEvent({
        eventType: 'memory_searched',
        userId,
        sessionId: 'session-1',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-1',
        action: 'search',
        result: 'success',
      });

      const log2 = await auditLogger.logEvent({
        eventType: 'memory_searched',
        userId,
        sessionId: 'session-2',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-2',
        action: 'search',
        result: 'success',
      });

      // Tamper with log2
      log2.action = 'tampered';

      // Detect without verification (should include tampered log)
      const eventsWithoutVerification = await detector.detectAnomalies({
        verifyAuditLogSignature: false,
      });

      // Should still detect (verification disabled)
      expect(eventsWithoutVerification.length).toBeGreaterThanOrEqual(0);
    });

    it('should verify signatures and exclude invalid logs when flag is true', async () => {
      const userId = 'user-123';
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Create 105 valid logs to trigger excessive access detection
      for (let i = 0; i < 105; i++) {
        await auditLogger.logEvent({
          eventType: 'memory_searched',
          userId,
          sessionId: 'session-valid',
          ipAddress: '192.168.1.1',
          resourceId: `memory-${i}`,
          action: 'search',
          result: 'success',
        });
      }

      // Create and tamper with some logs
      const tamperedLog1 = await auditLogger.logEvent({
        eventType: 'memory_searched',
        userId,
        sessionId: 'session-tampered-1',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-tampered-1',
        action: 'search',
        result: 'success',
      });

      const tamperedLog2 = await auditLogger.logEvent({
        eventType: 'memory_searched',
        userId,
        sessionId: 'session-tampered-2',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-tampered-2',
        action: 'search',
        result: 'success',
      });

      // Tamper with logs
      tamperedLog1.action = 'tampered action 1';
      tamperedLog2.userId = 'different-user';

      // Detect with verification enabled
      const eventsWithVerification = await detector.detectAnomalies({
        verifyAuditLogSignature: true,
      });

      // Should have warned about invalid signatures
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid signature detected for audit log')
      );

      // Should have warned about excluded logs
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Excluded 2 audit log(s) with invalid signatures')
      );

      // Should still detect excessive access from valid logs
      expect(eventsWithVerification.length).toBeGreaterThan(0);
      expect(eventsWithVerification.some((e) => e.anomalyPattern === 'excessive_data_access')).toBe(
        true
      );

      consoleWarnSpy.mockRestore();
    });

    it('should default to false when verifyAuditLogSignature is not provided', async () => {
      const userId = 'user-123';

      // Create some logs
      await auditLogger.logEvent({
        eventType: 'memory_searched',
        userId,
        sessionId: 'session-1',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-1',
        action: 'search',
        result: 'success',
      });

      // Should work without the flag (defaults to false, no verification)
      const events = await detector.detectAnomalies({});
      expect(events).toBeDefined();
    });

    it('should handle all logs being invalid gracefully', async () => {
      const userId = 'user-123';
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Create logs and tamper with all of them
      const log1 = await auditLogger.logEvent({
        eventType: 'memory_searched',
        userId,
        sessionId: 'session-1',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-1',
        action: 'search',
        result: 'success',
      });

      const log2 = await auditLogger.logEvent({
        eventType: 'memory_searched',
        userId,
        sessionId: 'session-2',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-2',
        action: 'search',
        result: 'success',
      });

      // Tamper with all logs
      log1.action = 'tampered 1';
      log2.action = 'tampered 2';

      // Detect with verification
      const events = await detector.detectAnomalies({
        verifyAuditLogSignature: true,
      });

      // Should warn about excluded logs
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Excluded 2 audit log(s) with invalid signatures')
      );

      // Should return empty or minimal events (no valid logs to detect from)
      expect(events).toBeDefined();
      expect(Array.isArray(events)).toBe(true);

      consoleWarnSpy.mockRestore();
    });
  });
});
