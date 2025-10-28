import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DeletionManager,
  type StorageAdapter,
  type KeyManagementService,
  type JobQueue,
  type DeletionPhase,
  DeletionFailureMode,
} from '../../security/deletion-manager';

// モックストレージアダプター
class MockStorageAdapter implements StorageAdapter {
  private softDeleted = new Set<string>();
  private hardDeleted = new Set<string>();
  private checksums = new Map<string, string>();

  async softDelete(memoryId: string): Promise<void> {
    this.softDeleted.add(memoryId);
  }

  async hardDelete(memoryId: string): Promise<void> {
    this.hardDeleted.add(memoryId);
    this.checksums.delete(memoryId); // 完全削除時はチェックサムも削除
  }

  async exists(memoryId: string): Promise<boolean> {
    return !this.hardDeleted.has(memoryId);
  }

  async getContentChecksum(memoryId: string): Promise<string | null> {
    return this.checksums.get(memoryId) || null;
  }

  setChecksum(memoryId: string, checksum: string): void {
    this.checksums.set(memoryId, checksum);
  }

  isSoftDeleted(memoryId: string): boolean {
    return this.softDeleted.has(memoryId);
  }

  isHardDeleted(memoryId: string): boolean {
    return this.hardDeleted.has(memoryId);
  }
}

// モックキー管理サービス
class MockKeyManagementService implements KeyManagementService {
  private destroyedKeys = new Set<string>();

  async destroyKey(memoryId: string): Promise<void> {
    this.destroyedKeys.add(memoryId);
  }

  async keyExists(memoryId: string): Promise<boolean> {
    return !this.destroyedKeys.has(memoryId);
  }

  isKeyDestroyed(memoryId: string): boolean {
    return this.destroyedKeys.has(memoryId);
  }
}

// モックジョブキュー
class MockJobQueue implements JobQueue {
  private jobs = new Map<string, string>();
  private jobCounter = 0;

  async schedulePurge(memoryId: string, delay?: number): Promise<string> {
    const jobId = `job_${++this.jobCounter}`;
    this.jobs.set(jobId, memoryId);
    return jobId;
  }

  hasJob(jobId: string): boolean {
    return this.jobs.has(jobId);
  }

  getMemoryId(jobId: string): string | undefined {
    return this.jobs.get(jobId);
  }
}

describe('DeletionManager', () => {
  let deletionManager: DeletionManager;
  let postgresAdapter: MockStorageAdapter;
  let neo4jAdapter: MockStorageAdapter;
  let keyManagement: MockKeyManagementService;
  let jobQueue: MockJobQueue;

  beforeEach(() => {
    postgresAdapter = new MockStorageAdapter();
    neo4jAdapter = new MockStorageAdapter();
    keyManagement = new MockKeyManagementService();
    jobQueue = new MockJobQueue();

    deletionManager = new DeletionManager(
      postgresAdapter,
      neo4jAdapter,
      keyManagement,
      jobQueue,
      {
        retryPolicy: {
          maxAttempts: 3,
          initialDelay: 100,
          multiplier: 2.0,
          maxDelay: 1000,
        },
        signatureSecret: 'test-secret',
      }
    );
  });

  describe('initiateDeletion', () => {
    it('should successfully initiate deletion with all phases', async () => {
      const memoryId = 'mem-123';
      const userId = 'user-456';
      postgresAdapter.setChecksum(memoryId, 'abc123');

      const result = await deletionManager.initiateDeletion(
        memoryId,
        userId,
        'user_request',
        {
          ipAddress: '192.168.1.1',
          sessionId: 'sess-789',
        }
      );

      expect(result.success).toBe(true);
      expect(result.phase).toBe('SOFT_DELETED');
      expect(result.purgeJobId).toBeDefined();
      expect(postgresAdapter.isSoftDeleted(memoryId)).toBe(true);
      expect(keyManagement.isKeyDestroyed(memoryId)).toBe(true);
    });

    it('should record REQUESTED, SOFT_DELETED, and KEY_DESTROYED events', async () => {
      const memoryId = 'mem-123';
      const userId = 'user-456';

      await deletionManager.initiateDeletion(memoryId, userId, 'gdpr_right_to_erasure');

      const logs = await deletionManager['getAuditLogs'](memoryId);
      const eventTypes = logs.map((l) => l.eventType);

      expect(eventTypes).toContain('REQUESTED');
      expect(eventTypes).toContain('SOFT_DELETED');
      expect(eventTypes).toContain('KEY_DESTROYED');
    });

    it('should schedule purge job with correct delay', async () => {
      const memoryId = 'mem-123';
      const userId = 'user-456';

      const result = await deletionManager.initiateDeletion(memoryId, userId, 'user_request');

      expect(result.purgeJobId).toBeDefined();
      expect(jobQueue.hasJob(result.purgeJobId!)).toBe(true);
      expect(jobQueue.getMemoryId(result.purgeJobId!)).toBe(memoryId);
    });

    it('should continue deletion even if key destruction fails', async () => {
      const memoryId = 'mem-123';
      const userId = 'user-456';

      // キー破棄に失敗させる
      vi.spyOn(keyManagement, 'destroyKey').mockRejectedValueOnce(
        new Error('Key destruction failed')
      );

      const result = await deletionManager.initiateDeletion(memoryId, userId, 'user_request');

      expect(result.success).toBe(true);
      expect(result.phase).toBe('SOFT_DELETED');
      expect(postgresAdapter.isSoftDeleted(memoryId)).toBe(true);

      // 失敗が記録されているか確認
      const failures = await deletionManager.getDeletionFailures(memoryId);
      expect(failures.length).toBeGreaterThan(0);
      expect(failures[0].failureMode).toBe(DeletionFailureMode.KEY_DESTRUCTION_FAILED);
    });
  });

  describe('executePurge', () => {
    it('should successfully execute purge and delete from both storages', async () => {
      const memoryId = 'mem-123';
      const userId = 'user-456';

      // 事前にソフト削除を実行
      await deletionManager.initiateDeletion(memoryId, userId, 'user_request');

      const result = await deletionManager.executePurge(memoryId, userId, 'user_request');

      expect(result.success).toBe(true);
      expect(result.phase).toBe('PURGED');
      expect(neo4jAdapter.isHardDeleted(memoryId)).toBe(true);
      expect(postgresAdapter.isHardDeleted(memoryId)).toBe(true);
    });

    it('should log PURGED event on successful purge', async () => {
      const memoryId = 'mem-123';
      const userId = 'user-456';

      await deletionManager.initiateDeletion(memoryId, userId, 'user_request');
      await deletionManager.executePurge(memoryId, userId, 'user_request');

      const logs = await deletionManager['getAuditLogs'](memoryId);
      const purgedLog = logs.find((l) => l.eventType === 'PURGED');

      expect(purgedLog).toBeDefined();
      expect(purgedLog!.userId).toBe(userId);
    });

    it('should schedule backup deletion after successful purge', async () => {
      const memoryId = 'mem-123';
      const userId = 'user-456';

      await deletionManager.initiateDeletion(memoryId, userId, 'user_request');
      await deletionManager.executePurge(memoryId, userId, 'user_request');

      const backupEntry = await deletionManager['getBackupDeletionEntry'](memoryId);

      expect(backupEntry).toBeDefined();
      expect(backupEntry!.memoryId).toBe(memoryId);
      expect(backupEntry!.processed).toBe(false);
    });

    it('should retry on failure with exponential backoff', async () => {
      const memoryId = 'mem-123';
      const userId = 'user-456';

      await deletionManager.initiateDeletion(memoryId, userId, 'user_request');

      // 最初の2回は失敗させ、3回目は成功させる
      let callCount = 0;
      vi.spyOn(neo4jAdapter, 'hardDelete').mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Temporary failure');
        }
      });

      const result = await deletionManager.executePurge(memoryId, userId, 'user_request');

      expect(result.success).toBe(true);
      expect(callCount).toBe(3);
    });

    it('should record failure after max retry attempts', async () => {
      const memoryId = 'mem-123';
      const userId = 'user-456';

      await deletionManager.initiateDeletion(memoryId, userId, 'user_request');

      // 常に失敗させる
      vi.spyOn(neo4jAdapter, 'hardDelete').mockRejectedValue(new Error('Permanent failure'));

      const result = await deletionManager.executePurge(memoryId, userId, 'user_request');

      expect(result.success).toBe(false);

      const failures = await deletionManager.getDeletionFailures(memoryId);
      expect(failures.length).toBeGreaterThan(0);
      expect(failures[0].retryCount).toBe(3);
    });

    it('should preserve deletion reason in PURGED event', async () => {
      const memoryId = 'mem-123';
      const userId = 'user-456';

      await deletionManager.initiateDeletion(memoryId, userId, 'gdpr_right_to_erasure');
      await deletionManager.executePurge(memoryId, userId, 'gdpr_right_to_erasure');

      const logs = await deletionManager['getAuditLogs'](memoryId);
      const purgedLog = logs.find((l) => l.eventType === 'PURGED');

      expect(purgedLog).toBeDefined();
      expect(purgedLog!.reason).toBe('gdpr_right_to_erasure');
    });

    it('should preserve deletion reason in failure records', async () => {
      const memoryId = 'mem-123';
      const userId = 'user-456';

      await deletionManager.initiateDeletion(memoryId, userId, 'data_retention_policy');

      // 常に失敗させる
      vi.spyOn(neo4jAdapter, 'hardDelete').mockRejectedValue(new Error('Permanent failure'));

      await deletionManager.executePurge(memoryId, userId, 'data_retention_policy');

      const failures = await deletionManager.getDeletionFailures(memoryId);
      expect(failures.length).toBeGreaterThan(0);
      expect(failures[0].reason).toBe('data_retention_policy');
    });
  });

  describe('verifyDeletion', () => {
    it('should generate valid deletion receipt with all storage locations', async () => {
      const memoryId = 'mem-123';
      const userId = 'user-456';

      // 完全な削除フローを実行
      await deletionManager.initiateDeletion(memoryId, userId, 'gdpr_right_to_erasure');
      await deletionManager.executePurge(memoryId, userId, 'gdpr_right_to_erasure');

      const receipt = await deletionManager.verifyDeletion(memoryId, userId);

      expect(receipt.memoryId).toBe(memoryId);
      expect(receipt.storageLocations.postgresql).toBe('DELETED');
      expect(receipt.storageLocations.neo4j).toBe('DELETED');
      expect(receipt.storageLocations.redis).toBe('NOT_FOUND');
      expect(receipt.storageLocations.backups).toBe('SCHEDULED_FOR_DELETION');
      expect(receipt.complianceStatement).toContain('GDPR Article 17');
      expect(receipt.digitalSignature).toBeDefined();
    });

    it('should verify checksum deletion', async () => {
      const memoryId = 'mem-123';
      const userId = 'user-456';

      postgresAdapter.setChecksum(memoryId, 'checksum-123');

      await deletionManager.initiateDeletion(memoryId, userId, 'user_request');
      await deletionManager.executePurge(memoryId, userId, 'user_request');

      const receipt = await deletionManager.verifyDeletion(memoryId, userId);

      // チェックサムがnullになっていることを確認（完全削除の証明）
      expect(receipt.checksumVerified).toBe(true);
    });

    it('should log VERIFIED event', async () => {
      const memoryId = 'mem-123';
      const userId = 'user-456';

      await deletionManager.initiateDeletion(memoryId, userId, 'user_request');
      await deletionManager.executePurge(memoryId, userId, 'user_request');
      await deletionManager.verifyDeletion(memoryId, userId);

      const logs = await deletionManager['getAuditLogs'](memoryId);
      const verifiedLog = logs.find((l) => l.eventType === 'VERIFIED');

      expect(verifiedLog).toBeDefined();
    });

    it('should preserve deletion reason in VERIFIED event', async () => {
      const memoryId = 'mem-123';
      const userId = 'user-456';

      await deletionManager.initiateDeletion(memoryId, userId, 'security_incident');
      await deletionManager.executePurge(memoryId, userId, 'security_incident');
      await deletionManager.verifyDeletion(memoryId, userId);

      const logs = await deletionManager['getAuditLogs'](memoryId);
      const verifiedLog = logs.find((l) => l.eventType === 'VERIFIED');

      expect(verifiedLog).toBeDefined();
      expect(verifiedLog!.reason).toBe('security_incident');
    });

    it('should use fallback reason when original is missing', async () => {
      const memoryId = 'mem-missing';
      const userId = 'user-456';

      // 検証のみ実行（REQUESTED ログなし）
      await deletionManager.verifyDeletion(memoryId, userId);

      const logs = await deletionManager['getAuditLogs'](memoryId);
      const verifiedLog = logs.find((l) => l.eventType === 'VERIFIED');

      expect(verifiedLog).toBeDefined();
      expect(verifiedLog!.reason).toBe('user_request'); // フォールバック値
    });

    it('should show PENDING status if purge not completed', async () => {
      const memoryId = 'mem-123';
      const userId = 'user-456';

      // ソフト削除のみ実行（物理削除は実行しない）
      await deletionManager.initiateDeletion(memoryId, userId, 'user_request');

      const receipt = await deletionManager.verifyDeletion(memoryId, userId);

      expect(receipt.storageLocations.postgresql).toBe('PENDING');
      expect(receipt.storageLocations.neo4j).toBe('PENDING');
    });
  });

  describe('exportDeletionLogs', () => {
    it('should export logs in JSON format', async () => {
      const memoryId1 = 'mem-123';
      const memoryId2 = 'mem-456';
      const userId = 'user-789';

      await deletionManager.initiateDeletion(memoryId1, userId, 'user_request');
      await deletionManager.initiateDeletion(memoryId2, userId, 'gdpr_right_to_erasure');

      const jsonLogs = await deletionManager.exportDeletionLogs({}, 'json');

      expect(jsonLogs).toBeDefined();
      const parsed = JSON.parse(jsonLogs);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
    });

    it('should export logs in CSV format', async () => {
      const memoryId = 'mem-123';
      const userId = 'user-456';

      await deletionManager.initiateDeletion(memoryId, userId, 'user_request');

      const csvLogs = await deletionManager.exportDeletionLogs({}, 'csv');

      expect(csvLogs).toBeDefined();
      expect(csvLogs).toContain('id,memoryId,eventType,userId,reason,timestamp');
      expect(csvLogs).toContain(memoryId);
    });

    it('should filter logs by memoryId', async () => {
      const memoryId1 = 'mem-123';
      const memoryId2 = 'mem-456';
      const userId = 'user-789';

      await deletionManager.initiateDeletion(memoryId1, userId, 'user_request');
      await deletionManager.initiateDeletion(memoryId2, userId, 'user_request');

      const jsonLogs = await deletionManager.exportDeletionLogs(
        { memoryId: memoryId1 },
        'json'
      );

      const parsed = JSON.parse(jsonLogs);
      expect(parsed.every((log: any) => log.memoryId === memoryId1)).toBe(true);
    });

    it('should filter logs by date range', async () => {
      const memoryId = 'mem-123';
      const userId = 'user-456';

      await deletionManager.initiateDeletion(memoryId, userId, 'user_request');

      const startDate = new Date(Date.now() - 1000);
      const endDate = new Date(Date.now() + 1000);

      const jsonLogs = await deletionManager.exportDeletionLogs(
        { startDate, endDate },
        'json'
      );

      const parsed = JSON.parse(jsonLogs);
      expect(parsed.length).toBeGreaterThan(0);
    });
  });

  describe('detectOrphanedDeletions', () => {
    it('should detect orphaned deletions older than threshold', async () => {
      const memoryId1 = 'mem-123';
      const memoryId2 = 'mem-456';
      const userId = 'user-789';

      // memoryId1: ソフト削除のみ（孤立）
      await deletionManager.initiateDeletion(memoryId1, userId, 'user_request');

      // memoryId2: 完全削除（孤立でない）
      await deletionManager.initiateDeletion(memoryId2, userId, 'user_request');
      await deletionManager.executePurge(memoryId2, userId, 'user_request');

      // タイムスタンプを古くする（テスト用ハック）
      const logs = await deletionManager['getAuditLogs'](memoryId1);
      for (const log of logs) {
        if (log.eventType === 'SOFT_DELETED') {
          log.timestamp = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2時間前
        }
      }

      const orphans = await deletionManager.detectOrphanedDeletions(1);

      expect(orphans).toContain(memoryId1);
      expect(orphans).not.toContain(memoryId2);
    });

    it('should not detect recently soft-deleted records', async () => {
      const memoryId = 'mem-123';
      const userId = 'user-456';

      await deletionManager.initiateDeletion(memoryId, userId, 'user_request');

      const orphans = await deletionManager.detectOrphanedDeletions(1);

      expect(orphans).not.toContain(memoryId);
    });
  });

  describe('getDeletionMetrics', () => {
    it('should calculate deletion metrics correctly', async () => {
      const memoryId1 = 'mem-123';
      const memoryId2 = 'mem-456';
      const userId = 'user-789';

      // 2件削除要求、1件完了
      await deletionManager.initiateDeletion(memoryId1, userId, 'user_request');
      await deletionManager.executePurge(memoryId1, userId, 'user_request');

      await deletionManager.initiateDeletion(memoryId2, userId, 'user_request');

      const metrics = await deletionManager.getDeletionMetrics();

      expect(metrics.totalDeletionsRequested).toBe(2);
      expect(metrics.totalDeletionsCompleted).toBe(1);
      expect(metrics.averageDeletionTime).toBeGreaterThanOrEqual(0);
      expect(metrics.complianceScore).toBe(50); // 1/2 = 50%
    });

    it('should identify oldest pending deletion', async () => {
      const memoryId1 = 'mem-123';
      const memoryId2 = 'mem-456';
      const userId = 'user-789';

      await deletionManager.initiateDeletion(memoryId1, userId, 'user_request');

      // 少し待つ
      await new Promise((resolve) => setTimeout(resolve, 10));

      await deletionManager.initiateDeletion(memoryId2, userId, 'user_request');

      const metrics = await deletionManager.getDeletionMetrics();

      expect(metrics.oldestPendingDeletion).toBeDefined();
      expect(metrics.oldestPendingDeletion).toBeInstanceOf(Date);
    });

    it('should return 100% compliance score when no deletions requested', async () => {
      const metrics = await deletionManager.getDeletionMetrics();

      expect(metrics.complianceScore).toBe(100);
    });
  });

  describe('getDeletionFailures', () => {
    it('should return all failures when no memoryId specified', async () => {
      const memoryId1 = 'mem-123';
      const memoryId2 = 'mem-456';
      const userId = 'user-789';

      await deletionManager.initiateDeletion(memoryId1, userId, 'user_request');

      // 失敗を発生させる
      vi.spyOn(neo4jAdapter, 'hardDelete').mockRejectedValue(new Error('Failure'));

      await deletionManager.executePurge(memoryId1, userId, 'user_request');
      await deletionManager.executePurge(memoryId2, userId, 'user_request');

      const failures = await deletionManager.getDeletionFailures();

      expect(failures.length).toBeGreaterThan(0);
    });

    it('should filter failures by memoryId', async () => {
      const memoryId1 = 'mem-123';
      const memoryId2 = 'mem-456';
      const userId = 'user-789';

      await deletionManager.initiateDeletion(memoryId1, userId, 'user_request');
      await deletionManager.initiateDeletion(memoryId2, userId, 'user_request');

      // memoryId1のみ失敗させる
      let callCount = 0;
      vi.spyOn(neo4jAdapter, 'hardDelete').mockImplementation(async (id) => {
        callCount++;
        if (id === memoryId1) {
          throw new Error('Failure for mem-123');
        }
      });

      await deletionManager.executePurge(memoryId1, userId, 'user_request');
      await deletionManager.executePurge(memoryId2, userId, 'user_request');

      const failures = await deletionManager.getDeletionFailures(memoryId1);

      expect(failures.length).toBeGreaterThan(0);
      expect(failures.every((f) => f.memoryId === memoryId1)).toBe(true);
    });
  });
});
