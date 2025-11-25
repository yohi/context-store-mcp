import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MemoryManager } from '../../memory/memory-manager.js';
import { McpAuthMiddleware, AuthenticationError } from '../../security/mcp-auth-middleware.js';
import { ApiKeyManager } from '../../security/api-key-manager.js';
import { EncryptionManager, LocalMasterKeyProvider } from '../../security/encryption.js';
import { VectorStoreAdapter } from '../../storage/vector-store-adapter.js';
import { PermissionMiddleware } from '../../security/permission-middleware.js';
import { RBACManager } from '../../security/rbac-manager.js';
import { DeletionManager, StorageAdapter, KeyManagementService, JobQueue } from '../../security/deletion-manager.js';

// Mocks
const mockVectorStore = {
  storeWithEmbedding: vi.fn(),
  searchSimilar: vi.fn(),
  deleteVector: vi.fn(),
} as unknown as VectorStoreAdapter;

class MockStorageAdapter implements StorageAdapter {
    async softDelete(id: string) {}
    async hardDelete(id: string) {}
    async exists(id: string) { return false; }
    async getContentChecksum(id: string) { return 'checksum'; }
}

class MockJobQueue implements JobQueue {
    async schedulePurge(id: string, delay?: number) { return 'job-id'; }
}

class MockKeyManagement implements KeyManagementService {
    async destroyKey(id: string) {}
    async keyExists(id: string) { return false; }
}

describe('Security Integration Tests (Task 12.2)', () => {
  let authMiddleware: McpAuthMiddleware;
  let apiKeyManager: ApiKeyManager;
  let encryptionManager: EncryptionManager;
  let rbacManager: RBACManager;
  let permissionMiddleware: PermissionMiddleware;
  let deletionManager: DeletionManager;

  beforeEach(() => {
    process.env['API_KEY_PEPPER'] = 'test-pepper';
    process.env['SIGNATURE_SECRET'] = 'test-signature-secret';
    
    apiKeyManager = new ApiKeyManager();
    
    // Auth Middleware with strict limits for testing
    authMiddleware = new McpAuthMiddleware(apiKeyManager, {
        windowMs: 1000,
        maxAttempts: 2,
        blockDurationMs: 5000
    });
    
    // Encryption
    const masterKey = '0'.repeat(64);
    const provider = new LocalMasterKeyProvider(masterKey);
    encryptionManager = new EncryptionManager(provider);
    
    // RBAC & Permissions
    rbacManager = new RBACManager();
    permissionMiddleware = new PermissionMiddleware(rbacManager);

    // Deletion
    deletionManager = new DeletionManager(
        new MockStorageAdapter(),
        new MockStorageAdapter(),
        new MockKeyManagement(),
        new MockJobQueue(),
        { signatureSecret: 'test-secret' }
    );
  });

  afterEach(() => {
      vi.restoreAllMocks();
  });

  // 1. Authentication Failure Verification
  describe('Authentication Security', () => {
    it('should enforce rate limiting and block IPs after threshold', async () => {
      const ip = '192.168.1.100';
      const headers = { Authorization: 'Bearer invalid-token' };
      
      // Attempt 1 (Fail)
      await expect(authMiddleware.authenticate(headers, ip)).rejects.toThrow(AuthenticationError);
      
      // Attempt 2 (Fail - limit reached)
      await expect(authMiddleware.authenticate(headers, ip)).rejects.toThrow(AuthenticationError);
      
      // Attempt 3 (Blocked)
      try {
        await authMiddleware.authenticate(headers, ip);
        expect.fail('Should have thrown blocked error');
      } catch (error: any) {
        expect(error).toBeInstanceOf(AuthenticationError);
        expect(error.message).toMatch(/blocked/);
        expect(error.type).toBe('rate_limit_exceeded');
      }
    });
  });

  // 2. Data Encryption Verification
  describe('Data Encryption', () => {
      it('should provide encryption and decryption capabilities', async () => {
          const sensitiveData = "Secret User Data";
          const dek = await encryptionManager.generateDataKey();
          
          const encrypted = await encryptionManager.encrypt(sensitiveData, dek);
          expect(encrypted.ciphertext).not.toBe(sensitiveData);
          expect(encrypted.iv).toBeDefined();
          expect(encrypted.authTag).toBeDefined();
          
          const decrypted = await encryptionManager.decrypt(encrypted, dek);
          expect(decrypted.toString('utf-8')).toBe(sensitiveData);
      });
  });

  // 3. Access Control Verification
  describe('Access Control (RBAC)', () => {
      it('should deny access if user role does not have required permission', async () => {
          const userId = 'user-readonly';
          rbacManager.assignRole(userId, 'read_only');
          
          // read_only only has memories:read
          const hasWritePermission = rbacManager.hasPermission(userId, 'memories:write');
          expect(hasWritePermission).toBe(false);
          
          const hasReadPermission = rbacManager.hasPermission(userId, 'memories:read');
          expect(hasReadPermission).toBe(true);
          
          const adminId = 'user-admin';
          rbacManager.assignRole(adminId, 'admin');
          const hasAdminPermission = rbacManager.hasPermission(adminId, 'memories:write');
          expect(hasAdminPermission).toBe(true);
      });
  });

  // 4. GDPR Deletion Verification
  describe('GDPR Deletion Compliance', () => {
      it('should generate a valid deletion receipt with signature', async () => {
          const memoryId = 'mem-123';
          const userId = 'user-123';
          
          // Mock audit logs for verification
          // DeletionManager relies on internal audit logs which are populated by initiateDeletion/executePurge
          // We need to run through the flow
          
          await deletionManager.initiateDeletion(memoryId, userId, 'user_request');
          // Since executePurge is separate, verifyDeletion might return PENDING for some statuses
          
          const result = await deletionManager.verifyDeletion(memoryId, userId);
          
          expect(result.memoryId).toBe(memoryId);
          expect(result.complianceStatement).toContain('GDPR Article 17');
          expect(result.digitalSignature).toBeDefined();
          
          // Initially it might be PENDING/DELETED depending on mock
          // Our mock exists() returns false, so it looks DELETED
          expect(result.storageLocations.postgresql).toBe('DELETED'); 
      });
  });
});