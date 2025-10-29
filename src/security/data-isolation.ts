/**
 * Data Isolation Manager
 *
 * Implements user-specific data isolation (Row-Level Security) including:
 * - Query filter generation for user_id
 * - SQL WHERE clause generation
 * - Neo4j Cypher filter generation
 * - Data ownership validation
 * - Admin bypass for full access
 *
 * Requirements: 6.3 (Access Control & Role Management)
 */

import { RBACManager } from './rbac-manager.js';

/**
 * Query filter for user-specific data
 */
export interface QueryFilter {
  user_id?: string;
}

/**
 * Parameterized SQL filter
 */
export interface ParameterizedFilter {
  clause: string;
  params: any[];
}

/**
 * Parameterized Cypher filter
 */
export interface ParameterizedCypherFilter {
  filter: string;
  params: Record<string, any>;
}

/**
 * Data object with user_id
 */
export interface DataObject {
  user_id?: string;
  [key: string]: any;
}

/**
 * Data Isolation Manager
 *
 * Manages user-specific data access restrictions.
 */
export class DataIsolationManager {
  constructor(private rbacManager: RBACManager) {}

  /**
   * Check if user is admin
   *
   * @param userId - User ID
   * @returns True if user is admin
   */
  private isAdmin(userId: string): boolean {
    return this.rbacManager.hasPermission(userId, 'admin:manage');
  }

  /**
   * Create query filter for user-specific data
   *
   * @param userId - User ID
   * @returns Query filter object (empty for admin)
   */
  createQueryFilter(userId: string): QueryFilter {
    if (this.isAdmin(userId)) {
      return {};
    }

    return { user_id: userId };
  }

  /**
   * Check if user can access data of another user
   *
   * @param userId - Current user ID
   * @param targetUserId - Target user ID
   * @returns True if access is allowed
   */
  canAccessData(userId: string, targetUserId: string): boolean {
    // Admin can access all data
    if (this.isAdmin(userId)) {
      return true;
    }

    // User can only access own data
    return userId === targetUserId;
  }

  /**
   * Generate SQL WHERE clause for user-specific data
   * @deprecated Use generateParameterizedFilter instead to avoid SQL injection risks
   *
   * @param userId - User ID
   * @returns SQL WHERE clause (empty for admin)
   */
  generateSQLFilter(userId: string): string {
    if (this.isAdmin(userId)) {
      return '';
    }

    // Escape single quotes to prevent SQL injection
    const escapedUserId = userId.replace(/'/g, "''");
    return `WHERE user_id = '${escapedUserId}'`;
  }

  /**
   * Generate parameterized SQL filter (safer alternative)
   *
   * @param userId - User ID
   * @returns Parameterized filter with clause and params
   */
  generateParameterizedFilter(userId: string): ParameterizedFilter {
    if (this.isAdmin(userId)) {
      return {
        clause: '',
        params: [],
      };
    }

    return {
      clause: 'WHERE user_id = $1',
      params: [userId],
    };
  }

  /**
   * Generate Neo4j Cypher filter for user-specific data
   * @deprecated Use generateParameterizedCypherFilter instead to avoid injection risks
   *
   * @param userId - User ID
   * @returns Cypher filter string (empty object for admin)
   */
  generateCypherFilter(userId: string): string {
    if (this.isAdmin(userId)) {
      return '{}';
    }

    // Escape single quotes to prevent Cypher injection
    const escapedUserId = userId.replace(/'/g, "\\'");
    return `{user_id: '${escapedUserId}'}`;
  }

  /**
   * Generate parameterized Cypher filter (safer alternative)
   *
   * @param userId - User ID
   * @returns Parameterized Cypher filter with params
   */
  generateParameterizedCypherFilter(userId: string): ParameterizedCypherFilter {
    if (this.isAdmin(userId)) {
      return {
        filter: '{}',
        params: {},
      };
    }

    return {
      filter: '{user_id: $userId}',
      params: { userId },
    };
  }

  /**
   * Validate data ownership
   *
   * @param userId - User ID
   * @param data - Data object with user_id
   * @returns True if user owns the data or is admin
   * @throws Error if data lacks user_id property
   */
  validateOwnership(userId: string, data: DataObject): boolean {
    // Admin can access all data
    if (this.isAdmin(userId)) {
      return true;
    }

    // Validate data has user_id
    if (!data.user_id) {
      throw new Error('Data object must have user_id property');
    }

    // User can only access own data
    return data.user_id === userId;
  }
}
