/**
 * Data Isolation Test Suite
 *
 * Tests user-specific data isolation including:
 * - User ID filtering in queries
 * - Admin access to all data
 * - User access restricted to own data
 * - Row-Level Security (RLS) simulation
 *
 * Requirements: 6.3 (Access Control & Role Management)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DataIsolationManager } from '../../security/data-isolation';
import { RBACManager } from '../../security/rbac-manager';

describe('DataIsolationManager', () => {
  let rbacManager: RBACManager;
  let isolationManager: DataIsolationManager;

  beforeEach(() => {
    rbacManager = new RBACManager();
    isolationManager = new DataIsolationManager(rbacManager);
  });

  describe('Query Filtering', () => {
    it('should add user_id filter for regular users', () => {
      const userId = 'user-123';
      rbacManager.assignRole(userId, 'user');

      const filter = isolationManager.createQueryFilter(userId);

      expect(filter).toEqual({ user_id: userId });
    });

    it('should not add filter for admin users', () => {
      const adminId = 'admin-123';
      rbacManager.assignRole(adminId, 'admin');

      const filter = isolationManager.createQueryFilter(adminId);

      expect(filter).toEqual({});
    });

    it('should add user_id filter for read_only users', () => {
      const userId = 'user-123';
      rbacManager.assignRole(userId, 'read_only');

      const filter = isolationManager.createQueryFilter(userId);

      expect(filter).toEqual({ user_id: userId });
    });
  });

  describe('Access Validation', () => {
    it('should allow user to access own data', () => {
      const userId = 'user-123';
      rbacManager.assignRole(userId, 'user');

      const canAccess = isolationManager.canAccessData(userId, userId);

      expect(canAccess).toBe(true);
    });

    it('should deny user access to other user data', () => {
      const userId = 'user-123';
      const otherUserId = 'user-456';
      rbacManager.assignRole(userId, 'user');

      const canAccess = isolationManager.canAccessData(userId, otherUserId);

      expect(canAccess).toBe(false);
    });

    it('should allow admin to access any user data', () => {
      const adminId = 'admin-123';
      const otherUserId = 'user-456';
      rbacManager.assignRole(adminId, 'admin');

      const canAccess = isolationManager.canAccessData(adminId, otherUserId);

      expect(canAccess).toBe(true);
    });
  });

  describe('SQL Filter Generation', () => {
    it('should generate WHERE clause for regular users', () => {
      const userId = 'user-123';
      rbacManager.assignRole(userId, 'user');

      const whereClause = isolationManager.generateSQLFilter(userId);

      expect(whereClause).toBe("WHERE user_id = 'user-123'");
    });

    it('should generate empty WHERE clause for admin users', () => {
      const adminId = 'admin-123';
      rbacManager.assignRole(adminId, 'admin');

      const whereClause = isolationManager.generateSQLFilter(adminId);

      expect(whereClause).toBe('');
    });

    it('should support parameterized queries', () => {
      const userId = 'user-123';
      rbacManager.assignRole(userId, 'user');

      const { clause, params } = isolationManager.generateParameterizedFilter(userId);

      expect(clause).toBe('WHERE user_id = $1');
      expect(params).toEqual([userId]);
    });

    it('should return empty params for admin users', () => {
      const adminId = 'admin-123';
      rbacManager.assignRole(adminId, 'admin');

      const { clause, params } = isolationManager.generateParameterizedFilter(adminId);

      expect(clause).toBe('');
      expect(params).toEqual([]);
    });
  });

  describe('Cypher Filter Generation', () => {
    it('should generate Neo4j filter for regular users', () => {
      const userId = 'user-123';
      rbacManager.assignRole(userId, 'user');

      const filter = isolationManager.generateCypherFilter(userId);

      expect(filter).toBe("{user_id: 'user-123'}");
    });

    it('should generate empty filter for admin users', () => {
      const adminId = 'admin-123';
      rbacManager.assignRole(adminId, 'admin');

      const filter = isolationManager.generateCypherFilter(adminId);

      expect(filter).toBe('{}');
    });

    it('should support parameterized Cypher queries', () => {
      const userId = 'user-123';
      rbacManager.assignRole(userId, 'user');

      const { filter, params } = isolationManager.generateParameterizedCypherFilter(userId);

      expect(filter).toBe('{user_id: $userId}');
      expect(params).toEqual({ userId });
    });
  });

  describe('Validation', () => {
    it('should validate data ownership', () => {
      const userId = 'user-123';
      const data = { id: 'mem-1', user_id: userId, content: 'test' };
      rbacManager.assignRole(userId, 'user');

      const isOwner = isolationManager.validateOwnership(userId, data);

      expect(isOwner).toBe(true);
    });

    it('should reject data with mismatched user_id', () => {
      const userId = 'user-123';
      const data = { id: 'mem-1', user_id: 'user-456', content: 'test' };
      rbacManager.assignRole(userId, 'user');

      const isOwner = isolationManager.validateOwnership(userId, data);

      expect(isOwner).toBe(false);
    });

    it('should allow admin to access any data', () => {
      const adminId = 'admin-123';
      const data = { id: 'mem-1', user_id: 'user-456', content: 'test' };
      rbacManager.assignRole(adminId, 'admin');

      const isOwner = isolationManager.validateOwnership(adminId, data);

      expect(isOwner).toBe(true);
    });

    it('should throw error for data without user_id', () => {
      const userId = 'user-123';
      const data = { id: 'mem-1', content: 'test' };
      rbacManager.assignRole(userId, 'user');

      expect(() => {
        isolationManager.validateOwnership(userId, data);
      }).toThrow('Data object must have user_id property');
    });
  });
});
