/**
 * RBAC Manager Test Suite
 *
 * Tests role-based access control functionality including:
 * - Role management (create, read, delete)
 * - User-role assignment
 * - Permission checking
 * - Principle of least privilege
 *
 * Requirements: 6.3 (Access Control & Role Management)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RBACManager, Role, Permission, UserRole } from '../../security/rbac-manager';

describe('RBACManager', () => {
  let rbacManager: RBACManager;

  beforeEach(() => {
    rbacManager = new RBACManager();
  });

  describe('Role Management', () => {
    it('should define default roles (admin, user, read_only)', () => {
      const adminRole = rbacManager.getRole('admin');
      const userRole = rbacManager.getRole('user');
      const readOnlyRole = rbacManager.getRole('read_only');

      expect(adminRole).toBeDefined();
      expect(userRole).toBeDefined();
      expect(readOnlyRole).toBeDefined();
    });

    it('should create a custom role with specified permissions', () => {
      const permissions: Permission[] = ['memories:read', 'memories:write'];
      rbacManager.createRole('custom_role', permissions, 'Custom test role');

      const role = rbacManager.getRole('custom_role');
      expect(role).toBeDefined();
      expect(role?.permissions).toEqual(permissions);
      expect(role?.description).toBe('Custom test role');
    });

    it('should throw error when creating duplicate role', () => {
      const permissions: Permission[] = ['memories:read'];
      rbacManager.createRole('duplicate', permissions);

      expect(() => {
        rbacManager.createRole('duplicate', permissions);
      }).toThrow('Role already exists');
    });

    it('should delete a custom role', () => {
      const permissions: Permission[] = ['memories:read'];
      rbacManager.createRole('to_delete', permissions);

      rbacManager.deleteRole('to_delete');
      expect(rbacManager.getRole('to_delete')).toBeUndefined();
    });

    it('should not allow deletion of default roles', () => {
      expect(() => {
        rbacManager.deleteRole('admin');
      }).toThrow('Cannot delete default role');
    });
  });

  describe('User-Role Assignment', () => {
    const userId = 'user-123';

    it('should assign role to user', () => {
      rbacManager.assignRole(userId, 'user');

      const userRoles = rbacManager.getUserRoles(userId);
      expect(userRoles).toContain('user');
    });

    it('should assign multiple roles to user', () => {
      rbacManager.assignRole(userId, 'user');
      rbacManager.assignRole(userId, 'read_only');

      const userRoles = rbacManager.getUserRoles(userId);
      expect(userRoles).toHaveLength(2);
      expect(userRoles).toContain('user');
      expect(userRoles).toContain('read_only');
    });

    it('should throw error when assigning non-existent role', () => {
      expect(() => {
        rbacManager.assignRole(userId, 'non_existent_role');
      }).toThrow('Role does not exist');
    });

    it('should revoke role from user', () => {
      rbacManager.assignRole(userId, 'user');
      rbacManager.revokeRole(userId, 'user');

      const userRoles = rbacManager.getUserRoles(userId);
      expect(userRoles).not.toContain('user');
    });

    it('should assign default role (read_only) to new users', () => {
      const newUserId = 'new-user-456';
      rbacManager.ensureUserHasRole(newUserId);

      const userRoles = rbacManager.getUserRoles(newUserId);
      expect(userRoles).toContain('read_only');
    });
  });

  describe('Permission Checking', () => {
    const userId = 'user-123';

    beforeEach(() => {
      // Clear any previous role assignments
      rbacManager.revokeAllRoles(userId);
    });

    it('should grant admin full access to all permissions', () => {
      rbacManager.assignRole(userId, 'admin');

      expect(rbacManager.hasPermission(userId, 'memories:read')).toBe(true);
      expect(rbacManager.hasPermission(userId, 'memories:write')).toBe(true);
      expect(rbacManager.hasPermission(userId, 'memories:delete')).toBe(true);
      expect(rbacManager.hasPermission(userId, 'admin:manage')).toBe(true);
    });

    it('should grant user read and write permissions only', () => {
      rbacManager.assignRole(userId, 'user');

      expect(rbacManager.hasPermission(userId, 'memories:read')).toBe(true);
      expect(rbacManager.hasPermission(userId, 'memories:write')).toBe(true);
      expect(rbacManager.hasPermission(userId, 'memories:delete')).toBe(false);
      expect(rbacManager.hasPermission(userId, 'admin:manage')).toBe(false);
    });

    it('should grant read_only user read permission only', () => {
      rbacManager.assignRole(userId, 'read_only');

      expect(rbacManager.hasPermission(userId, 'memories:read')).toBe(true);
      expect(rbacManager.hasPermission(userId, 'memories:write')).toBe(false);
      expect(rbacManager.hasPermission(userId, 'memories:delete')).toBe(false);
    });

    it('should aggregate permissions from multiple roles', () => {
      // User has read_only + custom role with write permission
      rbacManager.createRole('writer', ['memories:write']);
      rbacManager.assignRole(userId, 'read_only');
      rbacManager.assignRole(userId, 'writer');

      expect(rbacManager.hasPermission(userId, 'memories:read')).toBe(true);
      expect(rbacManager.hasPermission(userId, 'memories:write')).toBe(true);
      expect(rbacManager.hasPermission(userId, 'memories:delete')).toBe(false);
    });

    it('should deny permission for user with no roles', () => {
      expect(rbacManager.hasPermission(userId, 'memories:read')).toBe(false);
    });
  });

  describe('Least Privilege Principle', () => {
    it('should default to read_only role with minimal permissions', () => {
      const readOnlyRole = rbacManager.getRole('read_only');
      expect(readOnlyRole?.permissions).toEqual(['memories:read']);
    });

    it('should require explicit permission grant for write operations', () => {
      const userId = 'new-user';
      rbacManager.ensureUserHasRole(userId); // Assigns default read_only

      expect(rbacManager.hasPermission(userId, 'memories:write')).toBe(false);
    });

    it('should require admin role for delete operations', () => {
      const userId = 'user-123';
      rbacManager.assignRole(userId, 'user');

      expect(rbacManager.hasPermission(userId, 'memories:delete')).toBe(false);
    });
  });

  describe('Role Metadata', () => {
    const userId = 'user-123';

    it('should cache user roles with TTL', async () => {
      rbacManager.assignRole(userId, 'user');
      // Trigger cache population by calling getUserRoles
      rbacManager.getUserRoles(userId);

      const cacheInfo = rbacManager.getCacheInfo(userId);

      expect(cacheInfo).toBeDefined();
      expect(cacheInfo?.roles).toContain('user');
      expect(cacheInfo?.cachedAt).toBeInstanceOf(Date);
    });

    it('should invalidate cache after TTL expiration', async () => {
      const shortTTL = 100; // 100ms
      const manager = new RBACManager({ cacheTTLMs: shortTTL });
      manager.assignRole(userId, 'user');

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, shortTTL + 50));

      const cacheInfo = manager.getCacheInfo(userId);
      expect(cacheInfo).toBeUndefined();
    });

    it('should manually invalidate user cache', () => {
      rbacManager.assignRole(userId, 'user');
      rbacManager.invalidateCache(userId);

      const cacheInfo = rbacManager.getCacheInfo(userId);
      expect(cacheInfo).toBeUndefined();
    });
  });

  describe('getAllPermissions', () => {
    it('should return all permissions for a user with multiple roles', () => {
      const userId = 'user-123';
      rbacManager.assignRole(userId, 'user');
      rbacManager.createRole('custom', ['memories:export']);
      rbacManager.assignRole(userId, 'custom');

      const permissions = rbacManager.getAllPermissions(userId);
      expect(permissions).toContain('memories:read');
      expect(permissions).toContain('memories:write');
      expect(permissions).toContain('memories:export');
    });

    it('should return unique permissions (no duplicates)', () => {
      const userId = 'user-123';
      rbacManager.assignRole(userId, 'user');
      rbacManager.assignRole(userId, 'read_only'); // Both have memories:read

      const permissions = rbacManager.getAllPermissions(userId);
      const readPermissions = permissions.filter(p => p === 'memories:read');
      expect(readPermissions).toHaveLength(1);
    });
  });
});
