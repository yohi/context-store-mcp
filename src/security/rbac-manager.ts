/**
 * RBAC Manager
 *
 * Implements Role-Based Access Control with:
 * - Predefined roles (admin, user, read_only)
 * - Custom role creation
 * - User-role assignment
 * - Permission checking
 * - Role caching with TTL
 * - Principle of least privilege
 *
 * Requirements: 6.3 (Access Control & Role Management)
 */

/**
 * Permission types representing granular access rights
 */
export type Permission =
  | 'memories:read'
  | 'memories:write'
  | 'memories:delete'
  | 'memories:export'
  | 'admin:manage';

/**
 * Role definition with permissions and metadata
 */
export interface Role {
  name: string;
  permissions: Permission[];
  description?: string;
  isDefault: boolean; // Cannot be deleted if true
}

/**
 * User-role assignment
 */
export interface UserRole {
  userId: string;
  roles: string[];
}

/**
 * Cache entry for user roles
 */
interface CacheEntry {
  roles: string[];
  cachedAt: Date;
  expiresAt: Date;
}

/**
 * RBAC Manager configuration
 */
export interface RBACConfig {
  cacheTTLMs?: number; // Cache TTL in milliseconds (default: 5 minutes)
}

/**
 * RBAC Manager
 *
 * Manages roles, permissions, and user-role assignments with caching.
 */
export class RBACManager {
  private roles: Map<string, Role> = new Map();
  private userRoles: Map<string, string[]> = new Map();
  private cache: Map<string, CacheEntry> = new Map();
  private cacheTTLMs: number;

  constructor(config: RBACConfig = {}) {
    this.cacheTTLMs = config.cacheTTLMs ?? 5 * 60 * 1000; // Default: 5 minutes
    this.initializeDefaultRoles();
  }

  /**
   * Initialize default roles with predefined permissions
   */
  private initializeDefaultRoles(): void {
    // Admin: Full access
    this.roles.set('admin', {
      name: 'admin',
      permissions: [
        'memories:read',
        'memories:write',
        'memories:delete',
        'memories:export',
        'admin:manage',
      ],
      description: 'Full access to all resources',
      isDefault: true,
    });

    // User: Read and write access
    this.roles.set('user', {
      name: 'user',
      permissions: ['memories:read', 'memories:write'],
      description: 'Read and write access to own data',
      isDefault: true,
    });

    // Read-only: Read access only (principle of least privilege)
    this.roles.set('read_only', {
      name: 'read_only',
      permissions: ['memories:read'],
      description: 'Read-only access',
      isDefault: true,
    });
  }

  /**
   * Create a custom role with specified permissions
   *
   * @param name - Role name
   * @param permissions - Array of permissions
   * @param description - Optional description
   * @throws Error if role already exists
   */
  createRole(name: string, permissions: Permission[], description?: string): void {
    if (this.roles.has(name)) {
      throw new Error('Role already exists');
    }

    const role: Role = {
      name,
      permissions,
      isDefault: false,
    };

    if (description !== undefined) {
      role.description = description;
    }

    this.roles.set(name, role);
  }

  /**
   * Get role definition
   *
   * @param name - Role name
   * @returns Role definition or undefined
   */
  getRole(name: string): Role | undefined {
    return this.roles.get(name);
  }

  /**
   * Delete a custom role
   *
   * @param name - Role name
   * @throws Error if role is a default role or does not exist
   */
  deleteRole(name: string): void {
    const role = this.roles.get(name);
    if (!role) {
      throw new Error('Role does not exist');
    }

    if (role.isDefault) {
      throw new Error('Cannot delete default role');
    }

    this.roles.delete(name);
  }

  /**
   * Assign role to user
   *
   * @param userId - User ID
   * @param roleName - Role name
   * @throws Error if role does not exist
   */
  assignRole(userId: string, roleName: string): void {
    if (!this.roles.has(roleName)) {
      throw new Error('Role does not exist');
    }

    const roles = this.userRoles.get(userId) ?? [];
    if (!roles.includes(roleName)) {
      roles.push(roleName);
      this.userRoles.set(userId, roles);
      this.invalidateCache(userId);
    }
  }

  /**
   * Revoke role from user
   *
   * @param userId - User ID
   * @param roleName - Role name
   */
  revokeRole(userId: string, roleName: string): void {
    const roles = this.userRoles.get(userId);
    if (roles) {
      const filteredRoles = roles.filter(r => r !== roleName);
      this.userRoles.set(userId, filteredRoles);
      this.invalidateCache(userId);
    }
  }

  /**
   * Revoke all roles from user
   *
   * @param userId - User ID
   */
  revokeAllRoles(userId: string): void {
    this.userRoles.set(userId, []);
    this.invalidateCache(userId);
  }

  /**
   * Get user roles (from cache or fresh)
   *
   * @param userId - User ID
   * @returns Array of role names
   */
  getUserRoles(userId: string): string[] {
    // Check cache first
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > new Date()) {
      return cached.roles;
    }

    // Fetch from storage
    const roles = this.userRoles.get(userId) ?? [];

    // Update cache
    this.updateCache(userId, roles);

    return roles;
  }

  /**
   * Ensure user has at least one role (assign default if none)
   *
   * @param userId - User ID
   */
  ensureUserHasRole(userId: string): void {
    const roles = this.getUserRoles(userId);
    if (roles.length === 0) {
      this.assignRole(userId, 'read_only'); // Least privilege principle
    }
  }

  /**
   * Check if user has permission
   *
   * @param userId - User ID
   * @param permission - Permission to check
   * @returns True if user has permission
   */
  hasPermission(userId: string, permission: Permission): boolean {
    const roles = this.getUserRoles(userId);

    for (const roleName of roles) {
      const role = this.roles.get(roleName);
      if (role && role.permissions.includes(permission)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get all permissions for user (aggregated from all roles)
   *
   * @param userId - User ID
   * @returns Array of unique permissions
   */
  getAllPermissions(userId: string): Permission[] {
    const roles = this.getUserRoles(userId);
    const permissions: Set<Permission> = new Set();

    for (const roleName of roles) {
      const role = this.roles.get(roleName);
      if (role) {
        role.permissions.forEach(p => permissions.add(p));
      }
    }

    return Array.from(permissions);
  }

  /**
   * Update cache for user roles
   *
   * @param userId - User ID
   * @param roles - Array of role names
   */
  private updateCache(userId: string, roles: string[]): void {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.cacheTTLMs);

    this.cache.set(userId, {
      roles,
      cachedAt: now,
      expiresAt,
    });
  }

  /**
   * Invalidate cache for user
   *
   * @param userId - User ID
   */
  invalidateCache(userId: string): void {
    this.cache.delete(userId);
  }

  /**
   * Get cache info for user (for testing/debugging)
   *
   * @param userId - User ID
   * @returns Cache entry or undefined
   */
  getCacheInfo(userId: string): CacheEntry | undefined {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > new Date()) {
      return cached;
    }
    return undefined;
  }
}
