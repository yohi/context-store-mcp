/**
 * Permission Middleware Test Suite
 *
 * Tests permission validation middleware for MCP tools including:
 * - Permission checking before tool execution
 * - Multiple permission requirements
 * - Error handling for missing permissions
 * - Integration with RBACManager
 *
 * Requirements: 6.3 (Access Control & Role Management)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PermissionMiddleware } from '../../security/permission-middleware';
import { RBACManager, Permission } from '../../security/rbac-manager';

describe('PermissionMiddleware', () => {
  let rbacManager: RBACManager;
  let middleware: PermissionMiddleware;

  beforeEach(() => {
    rbacManager = new RBACManager();
    middleware = new PermissionMiddleware(rbacManager);
  });

  describe('requirePermission', () => {
    it('should allow access when user has required permission', async () => {
      const userId = 'user-123';
      rbacManager.assignRole(userId, 'user');

      const result = await middleware.requirePermission(userId, 'memories:read');
      expect(result.allowed).toBe(true);
      expect(result.missingPermissions).toEqual([]);
    });

    it('should deny access when user lacks required permission', async () => {
      const userId = 'user-123';
      rbacManager.assignRole(userId, 'read_only');

      const result = await middleware.requirePermission(userId, 'memories:write');
      expect(result.allowed).toBe(false);
      expect(result.missingPermissions).toContain('memories:write');
    });

    it('should deny access for user with no roles', async () => {
      const userId = 'user-123';

      const result = await middleware.requirePermission(userId, 'memories:read');
      expect(result.allowed).toBe(false);
      expect(result.missingPermissions).toContain('memories:read');
    });
  });

  describe('requireAnyPermission', () => {
    it('should allow access when user has at least one permission', async () => {
      const userId = 'user-123';
      rbacManager.assignRole(userId, 'read_only');

      const result = await middleware.requireAnyPermission(userId, [
        'memories:write',
        'memories:read',
      ]);
      expect(result.allowed).toBe(true);
      expect(result.missingPermissions).toEqual([]);
    });

    it('should deny access when user has none of the permissions', async () => {
      const userId = 'user-123';
      rbacManager.assignRole(userId, 'read_only');

      const result = await middleware.requireAnyPermission(userId, [
        'memories:write',
        'memories:delete',
      ]);
      expect(result.allowed).toBe(false);
      expect(result.missingPermissions).toHaveLength(2);
    });
  });

  describe('requireAllPermissions', () => {
    it('should allow access when user has all required permissions', async () => {
      const userId = 'user-123';
      rbacManager.assignRole(userId, 'user');

      const result = await middleware.requireAllPermissions(userId, [
        'memories:read',
        'memories:write',
      ]);
      expect(result.allowed).toBe(true);
      expect(result.missingPermissions).toEqual([]);
    });

    it('should deny access when user lacks any required permission', async () => {
      const userId = 'user-123';
      rbacManager.assignRole(userId, 'user');

      const result = await middleware.requireAllPermissions(userId, [
        'memories:read',
        'memories:delete',
      ]);
      expect(result.allowed).toBe(false);
      expect(result.missingPermissions).toContain('memories:delete');
    });
  });

  describe('Tool-specific permission checks', () => {
    it('should allow store_memory for user role', async () => {
      const userId = 'user-123';
      rbacManager.assignRole(userId, 'user');

      const result = await middleware.checkToolPermission(userId, 'store_memory');
      expect(result.allowed).toBe(true);
    });

    it('should deny store_memory for read_only role', async () => {
      const userId = 'user-123';
      rbacManager.assignRole(userId, 'read_only');

      const result = await middleware.checkToolPermission(userId, 'store_memory');
      expect(result.allowed).toBe(false);
    });

    it('should allow search_memory for all roles', async () => {
      const userId = 'user-123';
      rbacManager.assignRole(userId, 'read_only');

      const result = await middleware.checkToolPermission(userId, 'search_memory');
      expect(result.allowed).toBe(true);
    });

    it('should allow delete_memory for admin role only', async () => {
      const adminId = 'admin-123';
      const userId = 'user-456';

      rbacManager.assignRole(adminId, 'admin');
      rbacManager.assignRole(userId, 'user');

      const adminResult = await middleware.checkToolPermission(adminId, 'delete_memory');
      const userResult = await middleware.checkToolPermission(userId, 'delete_memory');

      expect(adminResult.allowed).toBe(true);
      expect(userResult.allowed).toBe(false);
    });

    it('should throw error for unknown tool', async () => {
      const userId = 'user-123';
      rbacManager.assignRole(userId, 'user');

      await expect(
        middleware.checkToolPermission(userId, 'unknown_tool' as any)
      ).rejects.toThrow('Unknown tool');
    });
  });

  describe('createPermissionError', () => {
    it('should create structured error with missing permissions', () => {
      const error = middleware.createPermissionError('user-123', ['memories:write']);

      expect(error.code).toBe('PERMISSION_DENIED');
      expect(error.message).toContain('Insufficient permissions');
      expect(error.userId).toBe('user-123');
      expect(error.missingPermissions).toEqual(['memories:write']);
    });

    it('should include tool name in error when provided', () => {
      const error = middleware.createPermissionError(
        'user-123',
        ['memories:delete'],
        'delete_memory'
      );

      expect(error.message).toContain('delete_memory');
    });
  });
});
