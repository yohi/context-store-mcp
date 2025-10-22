/**
 * AuditLogger Tests
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

import { describe, it, expect, beforeEach } from 'vitest';
import { AuditLogger, AuditLogEntry, EventType, EventResult } from '../../security/audit-logger';

describe('AuditLogger', () => {
  let auditLogger: AuditLogger;

  beforeEach(() => {
    auditLogger = new AuditLogger();
  });

  describe('logEvent', () => {
    it('should log an audit event with all required fields', async () => {
      const entry = await auditLogger.logEvent({
        eventType: 'memory_created',
        userId: 'user-123',
        sessionId: 'session-456',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-789',
        action: 'create memory with content',
        result: 'success',
        metadata: {
          userAgent: 'Claude/1.0',
          requestId: 'req-abc',
        },
      });

      expect(entry.id).toBeDefined();
      expect(entry.timestamp).toBeInstanceOf(Date);
      expect(entry.eventType).toBe('memory_created');
      expect(entry.userId).toBe('user-123');
      expect(entry.sessionId).toBe('session-456');
      expect(entry.ipAddress).toBe('192.168.1.1');
      expect(entry.resourceId).toBe('memory-789');
      expect(entry.action).toBe('create memory with content');
      expect(entry.result).toBe('success');
      expect(entry.metadata).toEqual({
        userAgent: 'Claude/1.0',
        requestId: 'req-abc',
      });
      expect(entry.signature).toBeDefined();
    });

    it('should generate unique IDs for each log entry', async () => {
      const entry1 = await auditLogger.logEvent({
        eventType: 'memory_created',
        userId: 'user-1',
        sessionId: 'session-1',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-1',
        action: 'create',
        result: 'success',
      });

      const entry2 = await auditLogger.logEvent({
        eventType: 'memory_created',
        userId: 'user-2',
        sessionId: 'session-2',
        ipAddress: '192.168.1.2',
        resourceId: 'memory-2',
        action: 'create',
        result: 'success',
      });

      expect(entry1.id).not.toBe(entry2.id);
    });

    it('should add digital signature (HMAC-SHA256) to prevent tampering', async () => {
      const entry = await auditLogger.logEvent({
        eventType: 'memory_deleted',
        userId: 'user-123',
        sessionId: 'session-456',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-789',
        action: 'delete memory',
        result: 'success',
      });

      expect(entry.signature).toBeDefined();
      expect(entry.signature).toMatch(/^[a-f0-9]{64}$/); // SHA-256 produces 64 hex characters
    });

    it('should handle error events with error codes', async () => {
      const entry = await auditLogger.logEvent({
        eventType: 'auth_failed',
        userId: 'user-123',
        sessionId: 'session-456',
        ipAddress: '192.168.1.1',
        resourceId: 'api-key-invalid',
        action: 'authenticate with invalid key',
        result: 'failure',
        errorCode: 'INVALID_API_KEY',
      });

      expect(entry.result).toBe('failure');
      expect(entry.errorCode).toBe('INVALID_API_KEY');
    });
  });

  describe('queryLogs', () => {
    beforeEach(async () => {
      // Create test data
      await auditLogger.logEvent({
        eventType: 'memory_created',
        userId: 'user-1',
        sessionId: 'session-1',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-1',
        action: 'create',
        result: 'success',
      });

      await auditLogger.logEvent({
        eventType: 'memory_deleted',
        userId: 'user-1',
        sessionId: 'session-2',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-1',
        action: 'delete',
        result: 'success',
      });

      await auditLogger.logEvent({
        eventType: 'auth_failed',
        userId: 'user-2',
        sessionId: 'session-3',
        ipAddress: '192.168.1.2',
        resourceId: 'api-key-xxx',
        action: 'authenticate',
        result: 'failure',
        errorCode: 'INVALID_API_KEY',
      });
    });

    it('should query logs by user ID', async () => {
      const logs = await auditLogger.queryLogs({
        userId: 'user-1',
      });

      expect(logs).toHaveLength(2);
      expect(logs.every((log) => log.userId === 'user-1')).toBe(true);
    });

    it('should query logs by event type', async () => {
      const logs = await auditLogger.queryLogs({
        eventType: 'auth_failed',
      });

      expect(logs).toHaveLength(1);
      expect(logs[0].eventType).toBe('auth_failed');
      expect(logs[0].result).toBe('failure');
    });

    it('should query logs by time range', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      const logs = await auditLogger.queryLogs({
        startTime: oneHourAgo,
        endTime: now,
      });

      expect(logs.length).toBeGreaterThan(0);
      logs.forEach((log) => {
        expect(log.timestamp.getTime()).toBeGreaterThanOrEqual(oneHourAgo.getTime());
        expect(log.timestamp.getTime()).toBeLessThanOrEqual(now.getTime());
      });
    });

    it('should query logs by resource ID', async () => {
      const logs = await auditLogger.queryLogs({
        resourceId: 'memory-1',
      });

      expect(logs).toHaveLength(2);
      expect(logs.every((log) => log.resourceId === 'memory-1')).toBe(true);
    });

    it('should support pagination with limit and offset', async () => {
      const page1 = await auditLogger.queryLogs({
        limit: 2,
        offset: 0,
      });

      const page2 = await auditLogger.queryLogs({
        limit: 2,
        offset: 2,
      });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(1);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    it('should meet SLA: query hot storage (last 30 days) within 5 seconds', async () => {
      const startTime = Date.now();

      await auditLogger.queryLogs({
        startTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      });

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(5000); // 5 seconds
    });
  });

  describe('verifySignature', () => {
    it('should verify valid signature', async () => {
      const entry = await auditLogger.logEvent({
        eventType: 'memory_created',
        userId: 'user-123',
        sessionId: 'session-456',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-789',
        action: 'create',
        result: 'success',
      });

      const isValid = await auditLogger.verifySignature(entry);
      expect(isValid).toBe(true);
    });

    it('should detect tampered log entry', async () => {
      const entry = await auditLogger.logEvent({
        eventType: 'memory_created',
        userId: 'user-123',
        sessionId: 'session-456',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-789',
        action: 'create',
        result: 'success',
      });

      // Tamper with the entry
      entry.action = 'tampered action';

      const isValid = await auditLogger.verifySignature(entry);
      expect(isValid).toBe(false);
    });
  });

  describe('getAccessHistory', () => {
    beforeEach(async () => {
      // Create test data
      await auditLogger.logEvent({
        eventType: 'memory_searched',
        userId: 'user-1',
        sessionId: 'session-1',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-123',
        action: 'search and retrieve',
        result: 'success',
      });

      await auditLogger.logEvent({
        eventType: 'memory_searched',
        userId: 'user-2',
        sessionId: 'session-2',
        ipAddress: '192.168.1.2',
        resourceId: 'memory-123',
        action: 'search and retrieve',
        result: 'success',
      });

      await auditLogger.logEvent({
        eventType: 'memory_updated',
        userId: 'user-1',
        sessionId: 'session-3',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-123',
        action: 'update content',
        result: 'success',
      });
    });

    it('should retrieve access history for a memory', async () => {
      const history = await auditLogger.getAccessHistory('memory-123');

      expect(history.memoryId).toBe('memory-123');
      expect(history.totalAccesses).toBe(3);
      expect(history.accessLog).toHaveLength(3);
      expect(history.lastAccessedAt).toBeInstanceOf(Date);
    });

    it('should calculate access count correctly', async () => {
      const history = await auditLogger.getAccessHistory('memory-123');

      expect(history.totalAccesses).toBe(3);
    });

    it('should track unique users who accessed the memory', async () => {
      const history = await auditLogger.getAccessHistory('memory-123');

      expect(history.uniqueUsers.size).toBe(2);
      expect(history.uniqueUsers.has('user-1')).toBe(true);
      expect(history.uniqueUsers.has('user-2')).toBe(true);
    });

    it('should return empty history for non-existent memory', async () => {
      const history = await auditLogger.getAccessHistory('non-existent');

      expect(history.memoryId).toBe('non-existent');
      expect(history.totalAccesses).toBe(0);
      expect(history.accessLog).toHaveLength(0);
      expect(history.lastAccessedAt).toBeNull();
    });
  });

  describe('purgeOldLogs', () => {
    it('should delete logs older than retention period', async () => {
      // Create an old log entry (simulate by modifying timestamp)
      const oldEntry = await auditLogger.logEvent({
        eventType: 'memory_created',
        userId: 'user-1',
        sessionId: 'session-1',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-old',
        action: 'create',
        result: 'success',
      });

      // Manually set timestamp to 400 days ago
      const fourHundredDaysAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
      await auditLogger.updateTimestamp(oldEntry.id, fourHundredDaysAgo);

      // Create a recent log entry
      await auditLogger.logEvent({
        eventType: 'memory_created',
        userId: 'user-2',
        sessionId: 'session-2',
        ipAddress: '192.168.1.2',
        resourceId: 'memory-recent',
        action: 'create',
        result: 'success',
      });

      // Purge logs older than 365 days
      const purgedCount = await auditLogger.purgeOldLogs(365);

      expect(purgedCount).toBe(1);

      // Verify old log is deleted
      const remainingLogs = await auditLogger.queryLogs({});
      expect(remainingLogs.find((log) => log.id === oldEntry.id)).toBeUndefined();
      expect(remainingLogs.find((log) => log.resourceId === 'memory-recent')).toBeDefined();
    });

    it('should not delete logs within retention period', async () => {
      await auditLogger.logEvent({
        eventType: 'memory_created',
        userId: 'user-1',
        sessionId: 'session-1',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-1',
        action: 'create',
        result: 'success',
      });

      const purgedCount = await auditLogger.purgeOldLogs(365);

      expect(purgedCount).toBe(0);
    });
  });

  describe('exportLogs', () => {
    beforeEach(async () => {
      await auditLogger.logEvent({
        eventType: 'memory_created',
        userId: 'user-1',
        sessionId: 'session-1',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-1',
        action: 'create',
        result: 'success',
      });

      await auditLogger.logEvent({
        eventType: 'memory_deleted',
        userId: 'user-1',
        sessionId: 'session-2',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-1',
        action: 'delete',
        result: 'success',
      });
    });

    it('should export logs in JSON format', async () => {
      const exported = await auditLogger.exportLogs({
        format: 'json',
      });

      expect(typeof exported).toBe('string');
      const parsed = JSON.parse(exported);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
    });

    it('should export logs in CSV format', async () => {
      const exported = await auditLogger.exportLogs({
        format: 'csv',
      });

      expect(typeof exported).toBe('string');
      expect(exported).toContain('id,timestamp,eventType,userId,sessionId');
      expect(exported.split('\n').length).toBeGreaterThan(1);
    });

    it('should support time range filtering in export', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      const exported = await auditLogger.exportLogs({
        format: 'json',
        startTime: oneHourAgo,
        endTime: now,
      });

      const parsed = JSON.parse(exported);
      parsed.forEach((log: AuditLogEntry) => {
        const timestamp = new Date(log.timestamp);
        expect(timestamp.getTime()).toBeGreaterThanOrEqual(oneHourAgo.getTime());
        expect(timestamp.getTime()).toBeLessThanOrEqual(now.getTime());
      });
    });
  });
});
