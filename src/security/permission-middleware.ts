/**
 * Permission Middleware
 *
 * Provides permission validation for MCP tool invocations including:
 * - Single permission checks
 * - Multiple permission checks (any/all)
 * - Tool-specific permission mapping
 * - Structured error generation
 *
 * Requirements: 6.3 (Access Control & Role Management)
 */

import type { Permission } from './rbac-manager';
import { RBACManager } from './rbac-manager';

/**
 * Result of permission check
 */
export interface PermissionCheckResult {
  allowed: boolean;
  missingPermissions: Permission[];
}

/**
 * Permission error with structured information
 */
export interface PermissionError extends Error {
  code: 'PERMISSION_DENIED';
  userId: string;
  missingPermissions: Permission[];
  tool?: string;
}

/**
 * MCP tool names
 */
export type MCPTool = 'store_memory' | 'search_memory' | 'update_memory' | 'delete_memory';

/**
 * Tool-to-permission mapping
 */
const TOOL_PERMISSIONS: Record<MCPTool, Permission[]> = {
  store_memory: ['memories:write'],
  search_memory: ['memories:read'],
  update_memory: ['memories:write'],
  delete_memory: ['memories:delete'],
};

/**
 * Permission Middleware
 *
 * Validates user permissions before tool execution.
 */
export class PermissionMiddleware {
  constructor(private rbacManager: RBACManager) {}

  /**
   * Check if user has a single permission
   *
   * @param userId - User ID
   * @param permission - Required permission
   * @returns Permission check result
   */
  async requirePermission(
    userId: string,
    permission: Permission
  ): Promise<PermissionCheckResult> {
    const hasPermission = this.rbacManager.hasPermission(userId, permission);

    return {
      allowed: hasPermission,
      missingPermissions: hasPermission ? [] : [permission],
    };
  }

  /**
   * Check if user has at least one of the permissions
   *
   * @param userId - User ID
   * @param permissions - Array of permissions (any one required)
   * @returns Permission check result
   */
  async requireAnyPermission(
    userId: string,
    permissions: Permission[]
  ): Promise<PermissionCheckResult> {
    for (const permission of permissions) {
      if (this.rbacManager.hasPermission(userId, permission)) {
        return {
          allowed: true,
          missingPermissions: [],
        };
      }
    }

    return {
      allowed: false,
      missingPermissions: permissions,
    };
  }

  /**
   * Check if user has all of the permissions
   *
   * @param userId - User ID
   * @param permissions - Array of permissions (all required)
   * @returns Permission check result
   */
  async requireAllPermissions(
    userId: string,
    permissions: Permission[]
  ): Promise<PermissionCheckResult> {
    const missingPermissions: Permission[] = [];

    for (const permission of permissions) {
      if (!this.rbacManager.hasPermission(userId, permission)) {
        missingPermissions.push(permission);
      }
    }

    return {
      allowed: missingPermissions.length === 0,
      missingPermissions,
    };
  }

  /**
   * Check tool-specific permissions
   *
   * @param userId - User ID
   * @param tool - MCP tool name
   * @returns Permission check result
   * @throws Error if tool is unknown
   */
  async checkToolPermission(userId: string, tool: MCPTool): Promise<PermissionCheckResult> {
    const requiredPermissions = TOOL_PERMISSIONS[tool];

    if (!requiredPermissions) {
      throw new Error(`Unknown tool: ${tool}`);
    }

    return this.requireAllPermissions(userId, requiredPermissions);
  }

  /**
   * Create structured permission error
   *
   * @param userId - User ID
   * @param missingPermissions - Array of missing permissions
   * @param tool - Optional tool name
   * @returns Permission error
   */
  createPermissionError(
    userId: string,
    missingPermissions: Permission[],
    tool?: string
  ): PermissionError {
    const message = tool
      ? `Insufficient permissions to execute tool '${tool}'. Missing: ${missingPermissions.join(', ')}`
      : `Insufficient permissions. Missing: ${missingPermissions.join(', ')}`;

    const error = new Error(message) as PermissionError;
    error.code = 'PERMISSION_DENIED';
    error.userId = userId;
    error.missingPermissions = missingPermissions;
    if (tool !== undefined) {
      error.tool = tool;
    }

    return error;
  }
}
