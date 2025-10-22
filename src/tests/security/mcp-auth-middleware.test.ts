/**
 * MCP Authentication Middleware Unit Tests
 *
 * テスト対象:
 * - 認証処理
 * - レート制限
 * - 権限スコープチェック
 * - 監査ログ生成
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ApiKeyManager } from '../../security/api-key-manager.js';
import { McpAuthMiddleware, AuthenticationError } from '../../security/mcp-auth-middleware.js';

describe('McpAuthMiddleware', () => {
  let apiKeyManager: ApiKeyManager;
  let middleware: McpAuthMiddleware;

  beforeEach(() => {
    apiKeyManager = new ApiKeyManager();
    middleware = new McpAuthMiddleware(apiKeyManager, {
      windowMs: 5 * 60 * 1000, // 5分
      maxAttempts: 3, // テスト用に3回に設定
      blockDurationMs: 15 * 60 * 1000, // 15分
    });
  });

  describe('authenticate', () => {
    it('should successfully authenticate with valid Bearer token', async () => {
      const { plainKey } = apiKeyManager.generateApiKey('test-key');
      const headers = {
        Authorization: `Bearer ${plainKey}`,
      };

      const authContext = await middleware.authenticate(headers, '127.0.0.1', 'Test-Agent');

      expect(authContext.authenticated).toBe(true);
      expect(authContext.apiKey).toBeDefined();
      expect(authContext.sessionId).toBeDefined();
      expect(authContext.scopes).toEqual(['read', 'write']);
      expect(authContext.metadata.ipAddress).toBe('127.0.0.1');
      expect(authContext.metadata.userAgent).toBe('Test-Agent');
    });

    it('should successfully authenticate with X-API-Key header', async () => {
      const { plainKey } = apiKeyManager.generateApiKey('test-key');
      const headers = {
        'X-API-Key': plainKey,
      };

      const authContext = await middleware.authenticate(headers, '127.0.0.1');

      expect(authContext.authenticated).toBe(true);
    });

    it('should fail authentication with missing credentials', async () => {
      const headers = {};

      await expect(middleware.authenticate(headers, '127.0.0.1')).rejects.toThrow(AuthenticationError);

      try {
        await middleware.authenticate(headers, '127.0.0.1');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthenticationError);
        expect((error as AuthenticationError).type).toBe('missing_auth');
        expect((error as AuthenticationError).getMcpErrorCode()).toBe('mcp.error.unauthorized');
        expect((error as AuthenticationError).getHttpStatusCode()).toBe(401);
      }
    });

    it('should fail authentication with invalid API key', async () => {
      const headers = {
        Authorization: 'Bearer invalid-key',
      };

      await expect(middleware.authenticate(headers, '127.0.0.1')).rejects.toThrow(AuthenticationError);

      try {
        await middleware.authenticate(headers, '127.0.0.1');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthenticationError);
        expect((error as AuthenticationError).type).toBe('invalid_token');
      }
    });

    it('should fail authentication with expired API key', async () => {
      const { plainKey } = apiKeyManager.generateApiKey('expired-key', ['read'], 100);

      // 有効期限が切れるまで待機
      await new Promise((resolve) => setTimeout(resolve, 150));

      const headers = {
        Authorization: `Bearer ${plainKey}`,
      };

      await expect(middleware.authenticate(headers, '127.0.0.1')).rejects.toThrow(AuthenticationError);

      try {
        await middleware.authenticate(headers, '127.0.0.1');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthenticationError);
        expect((error as AuthenticationError).type).toBe('expired_token');
      }
    });

    it('should fail authentication with revoked API key', async () => {
      const { key, plainKey } = apiKeyManager.generateApiKey('revoked-key');
      apiKeyManager.revokeApiKey(key.id);

      const headers = {
        Authorization: `Bearer ${plainKey}`,
      };

      await expect(middleware.authenticate(headers, '127.0.0.1')).rejects.toThrow(AuthenticationError);

      try {
        await middleware.authenticate(headers, '127.0.0.1');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthenticationError);
        expect((error as AuthenticationError).type).toBe('revoked_token');
      }
    });
  });

  describe('rate limiting', () => {
    it('should block IP after maximum failed attempts', async () => {
      const headers = {
        Authorization: 'Bearer invalid-key',
      };

      // 3回失敗させる
      for (let i = 0; i < 3; i++) {
        try {
          await middleware.authenticate(headers, '192.168.1.1');
        } catch {
          // エラーは無視
        }
      }

      // 4回目はレート制限エラー
      await expect(middleware.authenticate(headers, '192.168.1.1')).rejects.toThrow(AuthenticationError);

      try {
        await middleware.authenticate(headers, '192.168.1.1');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthenticationError);
        expect((error as AuthenticationError).type).toBe('rate_limit_exceeded');
        expect((error as AuthenticationError).getMcpErrorCode()).toBe('mcp.error.rate_limit');
        expect((error as AuthenticationError).getHttpStatusCode()).toBe(429);
      }
    });

    it('should not block different IPs', async () => {
      const headers = {
        Authorization: 'Bearer invalid-key',
      };

      // IP1で3回失敗
      for (let i = 0; i < 3; i++) {
        try {
          await middleware.authenticate(headers, '192.168.1.1');
        } catch {
          // エラーは無視
        }
      }

      // IP2は影響を受けない
      try {
        await middleware.authenticate(headers, '192.168.1.2');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthenticationError);
        expect((error as AuthenticationError).type).not.toBe('rate_limit_exceeded');
      }
    });

    it('should allow successful authentication after failed attempts', async () => {
      const { plainKey: validKey } = apiKeyManager.generateApiKey('valid-key');
      const invalidHeaders = {
        Authorization: 'Bearer invalid-key',
      };
      const validHeaders = {
        Authorization: `Bearer ${validKey}`,
      };

      // 2回失敗
      for (let i = 0; i < 2; i++) {
        try {
          await middleware.authenticate(invalidHeaders, '192.168.1.3');
        } catch {
          // エラーは無視
        }
      }

      // 正しいキーで認証成功（成功してもカウントは残る）
      const authContext = await middleware.authenticate(validHeaders, '192.168.1.3');
      expect(authContext.authenticated).toBe(true);

      // さらに1回失敗で合計3回になりブロックされる
      try {
        await middleware.authenticate(invalidHeaders, '192.168.1.3');
      } catch {
        // エラーは無視
      }

      // 4回目の試行はブロックされる
      try {
        await middleware.authenticate(invalidHeaders, '192.168.1.3');
      } catch (error) {
        expect((error as AuthenticationError).type).toBe('rate_limit_exceeded');
      }
    });
  });

  describe('checkScopes', () => {
    it('should pass when all required scopes are present', async () => {
      const { plainKey } = apiKeyManager.generateApiKey('scoped-key', ['read', 'write', 'delete']);
      const headers = {
        Authorization: `Bearer ${plainKey}`,
      };

      const authContext = await middleware.authenticate(headers, '127.0.0.1');

      expect(() => middleware.checkScopes(authContext, ['read'])).not.toThrow();
      expect(() => middleware.checkScopes(authContext, ['read', 'write'])).not.toThrow();
    });

    it('should fail when required scope is missing', async () => {
      const { plainKey } = apiKeyManager.generateApiKey('limited-key', ['read']);
      const headers = {
        Authorization: `Bearer ${plainKey}`,
      };

      const authContext = await middleware.authenticate(headers, '127.0.0.1');

      expect(() => middleware.checkScopes(authContext, ['write'])).toThrow(AuthenticationError);

      try {
        middleware.checkScopes(authContext, ['write']);
      } catch (error) {
        expect(error).toBeInstanceOf(AuthenticationError);
        expect((error as AuthenticationError).type).toBe('insufficient_scope');
        expect((error as AuthenticationError).getMcpErrorCode()).toBe('mcp.error.forbidden');
        expect((error as AuthenticationError).getHttpStatusCode()).toBe(403);
      }
    });

    it('should fail when not authenticated', () => {
      const authContext = {
        authenticated: false,
        scopes: [],
        metadata: {
          requestedAt: new Date(),
        },
      };

      expect(() => middleware.checkScopes(authContext, ['read'])).toThrow(AuthenticationError);

      try {
        middleware.checkScopes(authContext, ['read']);
      } catch (error) {
        expect(error).toBeInstanceOf(AuthenticationError);
        expect((error as AuthenticationError).type).toBe('missing_auth');
      }
    });
  });

  describe('createAuditLog', () => {
    it('should create a complete audit log entry', async () => {
      const { key, plainKey } = apiKeyManager.generateApiKey('audit-key');
      key.metadata = { userId: 'user-123' };
      const headers = {
        Authorization: `Bearer ${plainKey}`,
      };

      const authContext = await middleware.authenticate(headers, '10.0.0.1', 'Mozilla/5.0');

      const auditLog = middleware.createAuditLog(authContext, 'memory_created', true, {
        memory_id: 'mem-456',
      });

      expect(auditLog.timestamp).toBeDefined();
      expect(auditLog.event_type).toBe('memory_created');
      expect(auditLog.success).toBe(true);
      expect(auditLog.user_id).toBe('user-123');
      expect(auditLog.session_id).toBe(authContext.sessionId);
      expect(auditLog.ip_address).toBe('10.0.0.1');
      expect(auditLog.user_agent).toBe('Mozilla/5.0');
      expect(auditLog.api_key_id).toBe(key.id);
      expect(auditLog.scopes).toEqual(['read', 'write']);
      expect(auditLog.memory_id).toBe('mem-456');
    });

    it('should create audit log for failed operation', async () => {
      const { plainKey } = apiKeyManager.generateApiKey('fail-key');
      const headers = {
        Authorization: `Bearer ${plainKey}`,
      };

      const authContext = await middleware.authenticate(headers, '10.0.0.2');

      const auditLog = middleware.createAuditLog(authContext, 'memory_deleted', false, {
        error: 'Not found',
      });

      expect(auditLog.success).toBe(false);
      expect(auditLog.error).toBe('Not found');
    });
  });

  describe('getStatistics', () => {
    it('should return correct statistics', async () => {
      const { plainKey } = apiKeyManager.generateApiKey('stats-key');
      const validHeaders = {
        Authorization: `Bearer ${plainKey}`,
      };
      const invalidHeaders = {
        Authorization: 'Bearer invalid-key',
      };

      // 成功2回
      await middleware.authenticate(validHeaders, '192.168.2.1');
      await middleware.authenticate(validHeaders, '192.168.2.1');

      // 失敗3回（同じIP）
      for (let i = 0; i < 3; i++) {
        try {
          await middleware.authenticate(invalidHeaders, '192.168.2.2');
        } catch {
          // エラーは無視
        }
      }

      const stats = middleware.getStatistics();

      expect(stats.totalAttempts).toBe(5);
      expect(stats.failedAttempts).toBe(3);
      expect(stats.blockedIps).toBe(0); // まだブロックされていない

      // さらに1回失敗でブロック
      try {
        await middleware.authenticate(invalidHeaders, '192.168.2.2');
      } catch {
        // エラーは無視
      }

      const stats2 = middleware.getStatistics();
      expect(stats2.blockedIps).toBe(1);
    });
  });

  describe('clearAll', () => {
    it('should clear all authentication data', async () => {
      const headers = {
        Authorization: 'Bearer invalid-key',
      };

      // 3回失敗してブロック
      for (let i = 0; i < 4; i++) {
        try {
          await middleware.authenticate(headers, '192.168.3.1');
        } catch {
          // エラーは無視
        }
      }

      middleware.clearAll();

      const stats = middleware.getStatistics();
      expect(stats.totalAttempts).toBe(0);
      expect(stats.failedAttempts).toBe(0);
      expect(stats.blockedIps).toBe(0);

      // ブロックがクリアされたので認証試行可能
      try {
        await middleware.authenticate(headers, '192.168.3.1');
      } catch (error) {
        expect((error as AuthenticationError).type).not.toBe('rate_limit_exceeded');
      }
    });
  });
});
