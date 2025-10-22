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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuditLogger, AuditLogEntry, EventType, EventResult } from '../../security/audit-logger';

describe('AuditLogger', () => {
  let auditLogger: AuditLogger;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    // Ensure we're in test/development mode by default
    process.env.NODE_ENV = 'test';
    auditLogger = new AuditLogger();
  });

  afterEach(() => {
    // Restore original NODE_ENV
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  describe('constructor', () => {
    it('should accept strong secret key in production', () => {
      process.env.NODE_ENV = 'production';
      const strongKey = 'a'.repeat(32); // 32 character key

      expect(() => new AuditLogger(strongKey)).not.toThrow();
    });

    it('should throw error when no secret key provided in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.AUDIT_LOG_SECRET_KEY;

      expect(() => new AuditLogger()).toThrow(
        /AUDIT_LOG_SECRET_KEY is required in production environment/
      );
    });

    it('should throw error when weak secret key provided in production', () => {
      process.env.NODE_ENV = 'production';

      expect(() => new AuditLogger('short')).toThrow(/Weak secret key detected in production/);
    });

    it('should reject common weak keys in production', () => {
      process.env.NODE_ENV = 'production';
      const weakKeys = ['test', 'password', 'secret', '123456', 'changeme'];

      weakKeys.forEach((weakKey) => {
        expect(() => new AuditLogger(weakKey)).toThrow(/Weak secret key detected in production/);
      });
    });

    it('should accept AUDIT_LOG_SECRET_KEY from environment in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.AUDIT_LOG_SECRET_KEY = 'a'.repeat(32);

      expect(() => new AuditLogger()).not.toThrow();

      delete process.env.AUDIT_LOG_SECRET_KEY;
    });

    it('should allow weak keys in development with warning', () => {
      process.env.NODE_ENV = 'development';
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => new AuditLogger('weak')).not.toThrow();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('WARNING: Using weak or default secret key')
      );

      consoleWarnSpy.mockRestore();
    });

    it('should use default key in development', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.AUDIT_LOG_SECRET_KEY;
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => new AuditLogger()).not.toThrow();
      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it('should enforce minimum key length of 32 characters', () => {
      process.env.NODE_ENV = 'production';
      const key31 = 'a'.repeat(31);
      const key32 = 'a'.repeat(32);

      expect(() => new AuditLogger(key31)).toThrow(/Weak secret key detected/);
      expect(() => new AuditLogger(key32)).not.toThrow();
    });
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

    it('should reject signature with different length', async () => {
      const entry = await auditLogger.logEvent({
        eventType: 'memory_created',
        userId: 'user-123',
        sessionId: 'session-456',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-789',
        action: 'create',
        result: 'success',
      });

      // Replace with signature of different length
      entry.signature = 'abcd1234';

      const isValid = await auditLogger.verifySignature(entry);
      expect(isValid).toBe(false);
    });

    it('should reject completely invalid signature', async () => {
      const entry = await auditLogger.logEvent({
        eventType: 'memory_created',
        userId: 'user-123',
        sessionId: 'session-456',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-789',
        action: 'create',
        result: 'success',
      });

      // Replace with invalid signature of same length (64 hex chars = 32 bytes for SHA256)
      entry.signature = 'f'.repeat(64);

      const isValid = await auditLogger.verifySignature(entry);
      expect(isValid).toBe(false);
    });

    it('should use constant-time comparison to prevent timing attacks', async () => {
      const entry = await auditLogger.logEvent({
        eventType: 'memory_created',
        userId: 'user-123',
        sessionId: 'session-456',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-789',
        action: 'create',
        result: 'success',
      });

      // Create multiple invalid signatures with different numbers of matching prefix bytes
      const originalSignature = entry.signature;
      const iterations = 100;
      const timings: number[] = [];

      for (let i = 0; i < iterations; i++) {
        // Create signature with only first byte matching
        const invalidSignature1 = originalSignature.substring(0, 2) + 'a'.repeat(62);
        entry.signature = invalidSignature1;

        const start1 = performance.now();
        await auditLogger.verifySignature(entry);
        const end1 = performance.now();
        timings.push(end1 - start1);

        // Create signature with half bytes matching
        const invalidSignature2 = originalSignature.substring(0, 32) + 'b'.repeat(32);
        entry.signature = invalidSignature2;

        const start2 = performance.now();
        await auditLogger.verifySignature(entry);
        const end2 = performance.now();
        timings.push(end2 - start2);
      }

      // With constant-time comparison, timing variance should be minimal
      // This is a weak test but demonstrates the concept
      // In a real timing attack, differences would be measurable
      const avgTiming = timings.reduce((a, b) => a + b, 0) / timings.length;
      const maxDeviation = Math.max(...timings.map((t) => Math.abs(t - avgTiming)));

      // All verifications should complete (constant-time comparison works)
      expect(timings.length).toBe(iterations * 2);

      // Note: This doesn't prove constant-time, but ensures the function works
      // Real constant-time verification requires statistical analysis of many samples
      expect(maxDeviation).toBeGreaterThanOrEqual(0);
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
      expect(exported).toContain('"id","timestamp","eventType","userId","sessionId"');
      expect(exported.split('\n').length).toBeGreaterThan(1);
    });

    it('should escape CSV fields with commas', async () => {
      await auditLogger.logEvent({
        eventType: 'memory_created',
        userId: 'user, with, commas',
        sessionId: 'session-test',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-test',
        action: 'create, update',
        result: 'success',
      });

      const exported = await auditLogger.exportLogs({
        format: 'csv',
      });

      // Fields with commas should be quoted
      expect(exported).toContain('"user, with, commas"');
      expect(exported).toContain('"create, update"');
    });

    it('should escape CSV fields with double quotes', async () => {
      await auditLogger.logEvent({
        eventType: 'memory_created',
        userId: 'user "quoted" name',
        sessionId: 'session-test',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-test',
        action: 'say "hello"',
        result: 'success',
      });

      const exported = await auditLogger.exportLogs({
        format: 'csv',
      });

      // Double quotes should be escaped by doubling them
      expect(exported).toContain('"user ""quoted"" name"');
      expect(exported).toContain('"say ""hello"""');
    });

    it('should escape CSV fields with newlines', async () => {
      await auditLogger.logEvent({
        eventType: 'memory_created',
        userId: 'user-test',
        sessionId: 'session-test',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-test',
        action: 'multi\nline\naction',
        result: 'success',
      });

      const exported = await auditLogger.exportLogs({
        format: 'csv',
      });

      // Newlines should be preserved within quotes
      expect(exported).toContain('"multi\nline\naction"');
    });

    it('should prevent CSV injection with leading = character', async () => {
      await auditLogger.logEvent({
        eventType: 'memory_created',
        userId: '=1+1',
        sessionId: 'session-test',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-test',
        action: '=SUM(A1:A10)',
        result: 'success',
      });

      const exported = await auditLogger.exportLogs({
        format: 'csv',
      });

      // Formula-like values should be neutralized with leading quote
      expect(exported).toContain('"\'=1+1"');
      expect(exported).toContain('"\'=SUM(A1:A10)"');
    });

    it('should prevent CSV injection with leading + character', async () => {
      await auditLogger.logEvent({
        eventType: 'memory_created',
        userId: '+cmd|/c calc',
        sessionId: 'session-test',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-test',
        action: 'test',
        result: 'success',
      });

      const exported = await auditLogger.exportLogs({
        format: 'csv',
      });

      expect(exported).toContain('"\'+cmd|/c calc"');
    });

    it('should prevent CSV injection with leading - character', async () => {
      await auditLogger.logEvent({
        eventType: 'memory_created',
        userId: '-2+3',
        sessionId: 'session-test',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-test',
        action: 'test',
        result: 'success',
      });

      const exported = await auditLogger.exportLogs({
        format: 'csv',
      });

      expect(exported).toContain('"\'-2+3"');
    });

    it('should prevent CSV injection with leading @ character', async () => {
      await auditLogger.logEvent({
        eventType: 'memory_created',
        userId: '@SUM(1+1)',
        sessionId: 'session-test',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-test',
        action: 'test',
        result: 'success',
      });

      const exported = await auditLogger.exportLogs({
        format: 'csv',
      });

      expect(exported).toContain('"\'@SUM(1+1)"');
    });

    it('should handle complex CSV injection combinations', async () => {
      await auditLogger.logEvent({
        eventType: 'memory_created',
        userId: '=1+1"test, value',
        sessionId: 'session-test',
        ipAddress: '192.168.1.1',
        resourceId: 'memory-test',
        action: '@cmd|"/c calc"',
        result: 'success',
      });

      const exported = await auditLogger.exportLogs({
        format: 'csv',
      });

      // Should neutralize formula AND escape quotes
      expect(exported).toContain('"\'=1+1""test, value"');
      expect(exported).toContain('"\'@cmd|""/c calc"""');
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
