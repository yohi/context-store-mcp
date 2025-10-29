/**
 * Security Module Exports
 *
 * Central export point for all security-related functionality.
 *
 * Note: LocalMasterKeyProvider is intentionally excluded from public API.
 * It is a development-only implementation with production guards.
 * Use proper key management services (AWS KMS, HashiCorp Vault, etc.) in production.
 */

// Encryption and key management
export {
  ENCRYPTION_ALGORITHM,
  IV_LENGTH,
  AUTH_TAG_LENGTH,
  KEY_LENGTH,
  generateAAD,
  EncryptionManager,
  KeyRotationManager,
} from './encryption.js';
export type {
  AADMetadata,
  EncryptedData,
  DataEncryptionKey,
  MasterKeyProvider,
  EncryptionManagerConfig,
} from './encryption.js';

// API key management
export { ApiKeyManager } from './api-key-manager.js';
export type { ApiKey, ApiKeyView, ApiKeyValidationResult } from './api-key-manager.js';

// MCP authentication middleware
export { McpAuthMiddleware, AuthenticationError } from './mcp-auth-middleware.js';
export type {
  AuthContext,
  AuthErrorType,
  AuthAttempt,
  RateLimitConfig,
} from './mcp-auth-middleware.js';

// Access control and permissions
export { RBACManager } from './rbac-manager.js';
export type { Permission, Role, UserRole, RBACConfig } from './rbac-manager.js';

export { PermissionMiddleware } from './permission-middleware.js';
export type {
  PermissionCheckResult,
  PermissionError,
  MCPTool,
} from './permission-middleware.js';

export { DataIsolationManager } from './data-isolation.js';
export type {
  QueryFilter,
  ParameterizedFilter,
  ParameterizedCypherFilter,
  DataObject,
} from './data-isolation.js';
