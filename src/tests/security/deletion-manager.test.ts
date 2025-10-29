import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DeletionManager,
  type StorageAdapter,
  type KeyManagementService,
  type JobQueue,
  type DeletionPhase,
  type TimeProvider,
  DeletionFailureMode,
} from '../../security/deletion-manager';

// モック時刻プロバイダー（テスト用）
class MockTimeProvider implements TimeProvider {
  private currentTime: Date;

  constructor(initialTime: Date = new Date()) {
    this.currentTime = initialTime;
  }

  now(): Date {
    return this.currentTime;
  }

  setTime(time: Date): void {
    this.currentTime = time;
  }

  advance(ms: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + ms);
  }
}

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
  private jobs = new Map<string, { memoryId: string; delay: number | undefined }>();
  private jobCounter = 0;

  async schedulePurge(memoryId: string, delay?: number): Promise<string> {
    const jobId = `job_${++this.jobCounter}`;
    this.jobs.set(jobId, { memoryId, delay });
    return jobId;
  }

  hasJob(jobId: string): boolean {
    return this.jobs.has(jobId);
  }

  getMemoryId(jobId: string): string | undefined {
    return this.jobs.get(jobId)?.memoryId;
  }

  getDelay(jobId: string): number | undefined {
    return this.jobs.get(jobId)?.delay;
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

  describe('constructor', () => {
    it('should accept explicit signatureSecret via config', () => {
      const manager = new DeletionManager(
        postgresAdapter,
        neo4jAdapter,
        keyManagement,
        jobQueue,
        {
          signatureSecret: 'explicit-secret',
        }
      );
      expect(manager).toBeDefined();
    });

    it('should accept signatureSecret from environment variable', () => {
      const originalEnv = process.env.SIGNATURE_SECRET;
      process.env.SIGNATURE_SECRET = 'env-secret';

      try {
        const manager = new DeletionManager(
          postgresAdapter,
          neo4jAdapter,
          keyManagement,
          jobQueue
        );
        expect(manager).toBeDefined();
      } finally {
        if (originalEnv !== undefined) {
          process.env.SIGNATURE_SECRET = originalEnv;
        } else {
          delete process.env.SIGNATURE_SECRET;
        }
      }
    });

    it('should use fallback secret in non-production environments', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      try {
        const manager = new DeletionManager(
          postgresAdapter,
          neo4jAdapter,
          keyManagement,
          jobQueue
        );
        expect(manager).toBeDefined();
      } finally {
        if (originalEnv !== undefined) {
          process.env.NODE_ENV = originalEnv;
        } else {
          delete process.env.NODE_ENV;
        }
      }
    });

    it('should throw error when signatureSecret is missing in production', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalSignatureSecret = process.env.SIGNATURE_SECRET;

      process.env.NODE_ENV = 'production';
      delete process.env.SIGNATURE_SECRET;

      try {
        expect(() => {
          new DeletionManager(postgresAdapter, neo4jAdapter, keyManagement, jobQueue);
        }).toThrow('SIGNATURE_SECRET is required in production environment');
      } finally {
        if (originalNodeEnv !== undefined) {
          process.env.NODE_ENV = originalNodeEnv;
        } else {
          delete process.env.NODE_ENV;
        }
        if (originalSignatureSecret !== undefined) {
          process.env.SIGNATURE_SECRET = originalSignatureSecret;
        }
      }
    });

    it('should accept secret in production when provided via config', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        const manager = new DeletionManager(
          postgresAdapter,
          neo4jAdapter,
          keyManagement,
          jobQueue,
          {
            signatureSecret: 'production-secret',
          }
        );
        expect(manager).toBeDefined();
      } finally {
        if (originalEnv !== undefined) {
          process.env.NODE_ENV = originalEnv;
        } else {
          delete process.env.NODE_ENV;
        }
      }
    });

    it('should accept secret in production when provided via environment variable', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalSignatureSecret = process.env.SIGNATURE_SECRET;

      process.env.NODE_ENV = 'production';
      process.env.SIGNATURE_SECRET = 'production-env-secret';

      try {
        const manager = new DeletionManager(
          postgresAdapter,
          neo4jAdapter,
          keyManagement,
          jobQueue
        );
        expect(manager).toBeDefined();
      } finally {
        if (originalNodeEnv !== undefined) {
          process.env.NODE_ENV = originalNodeEnv;
        } else {
          delete process.env.NODE_ENV;
        }
        if (originalSignatureSecret !== undefined) {
          process.env.SIGNATURE_SECRET = originalSignatureSecret;
        } else {
          delete process.env.SIGNATURE_SECRET;
        }
      }
    });
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

      const logs = await deletionManager.getAuditLogsForTest(memoryId);
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
      // 5分後の遅延が設定されていることを確認
      expect(jobQueue.getDelay(result.purgeJobId!)).toBe(5 * 60 * 1000);
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

      const logs = await deletionManager.getAuditLogsForTest(memoryId);
      const purgedLog = logs.find((l) => l.eventType === 'PURGED');

      expect(purgedLog).toBeDefined();
      expect(purgedLog!.userId).toBe(userId);
    });

    it('should schedule backup deletion after successful purge', async () => {
      const memoryId = 'mem-123';
      const userId = 'user-456';

      await deletionManager.initiateDeletion(memoryId, userId, 'user_request');
      await deletionManager.executePurge(memoryId, userId, 'user_request');

      const backupEntry = await deletionManager.getBackupDeletionEntryForTest(memoryId);

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

      const logs = await deletionManager.getAuditLogsForTest(memoryId);
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

    it('should classify Neo4j errors correctly', async () => {
      const memoryId = 'mem-neo4j-fail';
      const userId = 'user-456';

      await deletionManager.initiateDeletion(memoryId, userId, 'user_request');

      // Neo4jエラーをシミュレート
      vi.spyOn(neo4jAdapter, 'hardDelete').mockRejectedValue(new Error('Neo4j connection timeout'));

      await deletionManager.executePurge(memoryId, userId, 'user_request');

      const failures = await deletionManager.getDeletionFailures(memoryId);
      expect(failures.length).toBeGreaterThan(0);
      expect(failures[0].failureMode).toBe(DeletionFailureMode.NEO4J_TIMEOUT);
    });

    it('should classify PostgreSQL deadlock errors correctly', async () => {
      const memoryId = 'mem-deadlock';
      const userId = 'user-456';

      await deletionManager.initiateDeletion(memoryId, userId, 'user_request');

      // PostgreSQLデッドロックエラーをシミュレート
      vi.spyOn(neo4jAdapter, 'hardDelete').mockRejectedValue(new Error('deadlock detected'));

      await deletionManager.executePurge(memoryId, userId, 'user_request');

      const failures = await deletionManager.getDeletionFailures(memoryId);
      expect(failures.length).toBeGreaterThan(0);
      expect(failures[0].failureMode).toBe(DeletionFailureMode.POSTGRESQL_DEADLOCK);
    });

    it('should classify replica sync errors correctly', async () => {
      const memoryId = 'mem-replica-fail';
      const userId = 'user-456';

      await deletionManager.initiateDeletion(memoryId, userId, 'user_request');

      // レプリカ同期エラーをシミュレート
      vi.spyOn(neo4jAdapter, 'hardDelete').mockRejectedValue(new Error('replica sync timeout'));

      await deletionManager.executePurge(memoryId, userId, 'user_request');

      const failures = await deletionManager.getDeletionFailures(memoryId);
      expect(failures.length).toBeGreaterThan(0);
      expect(failures[0].failureMode).toBe(DeletionFailureMode.REPLICA_SYNC_TIMEOUT);
    });

    it('should classify backup deletion errors correctly', async () => {
      const memoryId = 'mem-backup-fail';
      const userId = 'user-456';

      await deletionManager.initiateDeletion(memoryId, userId, 'user_request');

      // バックアップ削除エラーをシミュレート
      vi.spyOn(neo4jAdapter, 'hardDelete').mockRejectedValue(new Error('backup deletion failed'));

      await deletionManager.executePurge(memoryId, userId, 'user_request');

      const failures = await deletionManager.getDeletionFailures(memoryId);
      expect(failures.length).toBeGreaterThan(0);
      expect(failures[0].failureMode).toBe(DeletionFailureMode.BACKUP_DELETION_FAILED);
    });

    it('should classify key destruction errors correctly', async () => {
      const memoryId = 'mem-key-fail';
      const userId = 'user-456';

      await deletionManager.initiateDeletion(memoryId, userId, 'user_request');

      // キー破棄エラーをシミュレート
      vi.spyOn(neo4jAdapter, 'hardDelete').mockRejectedValue(new Error('encryption key destruction failed'));

      await deletionManager.executePurge(memoryId, userId, 'user_request');

      const failures = await deletionManager.getDeletionFailures(memoryId);
      expect(failures.length).toBeGreaterThan(0);
      expect(failures[0].failureMode).toBe(DeletionFailureMode.KEY_DESTRUCTION_FAILED);
    });

    it('should default to POSTGRESQL_DEADLOCK for unknown errors', async () => {
      const memoryId = 'mem-unknown-fail';
      const userId = 'user-456';

      await deletionManager.initiateDeletion(memoryId, userId, 'user_request');

      // 不明なエラーをシミュレート
      vi.spyOn(neo4jAdapter, 'hardDelete').mockRejectedValue(new Error('Some unknown error'));

      await deletionManager.executePurge(memoryId, userId, 'user_request');

      const failures = await deletionManager.getDeletionFailures(memoryId);
      expect(failures.length).toBeGreaterThan(0);
      expect(failures[0].failureMode).toBe(DeletionFailureMode.POSTGRESQL_DEADLOCK);
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

      const logs = await deletionManager.getAuditLogsForTest(memoryId);
      const verifiedLog = logs.find((l) => l.eventType === 'VERIFIED');

      expect(verifiedLog).toBeDefined();
    });

    it('should preserve deletion reason in VERIFIED event', async () => {
      const memoryId = 'mem-123';
      const userId = 'user-456';

      await deletionManager.initiateDeletion(memoryId, userId, 'security_incident');
      await deletionManager.executePurge(memoryId, userId, 'security_incident');
      await deletionManager.verifyDeletion(memoryId, userId);

      const logs = await deletionManager.getAuditLogsForTest(memoryId);
      const verifiedLog = logs.find((l) => l.eventType === 'VERIFIED');

      expect(verifiedLog).toBeDefined();
      expect(verifiedLog!.reason).toBe('security_incident');
    });

    it('should use fallback reason when original is missing', async () => {
      const memoryId = 'mem-missing';
      const userId = 'user-456';

      // 検証のみ実行（REQUESTED ログなし）
      await deletionManager.verifyDeletion(memoryId, userId);

      const logs = await deletionManager.getAuditLogsForTest(memoryId);
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
      // RFC 4180準拠: すべてのフィールドが引用符で囲まれる
      expect(csvLogs).toContain('"id","memoryId","eventType","userId","reason","timestamp"');
      expect(csvLogs).toContain(memoryId);
    });

    it('should prevent CSV injection attacks', async () => {
      // CSV injection payloads: = + - @ で始まる文字列
      const dangerousMemoryId = '=1+1';
      const dangerousUserId = '+cmd|"/c calc"';
      const dangerousReason = '-2+3+cmd|"/c calc"!A0';

      await deletionManager.initiateDeletion(dangerousMemoryId, dangerousUserId, dangerousReason);

      const csvLogs = await deletionManager.exportDeletionLogs({}, 'csv');

      // すべての危険な文字列がシングルクォートで無害化されていることを確認
      expect(csvLogs).toContain("'=1+1");
      expect(csvLogs).toContain("'+cmd|");
      expect(csvLogs).toContain("'-2+3+cmd");

      // ダブルクォートが正しくエスケープされていることを確認
      const csvLines = csvLogs.split('\n');
      const dataLines = csvLines.slice(1); // ヘッダー行をスキップ
      for (const line of dataLines) {
        if (line.trim() === '') continue;
        // すべてのフィールドが引用符で囲まれていることを確認
        expect(line.match(/"([^"]|"")*"/g)?.length).toBeGreaterThanOrEqual(6);
      }
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

      // モック時刻プロバイダーを使用
      const mockTimeProvider = new MockTimeProvider(new Date());
      const testDeletionManager = new DeletionManager(
        postgresAdapter,
        neo4jAdapter,
        keyManagement,
        jobQueue,
        { timeProvider: mockTimeProvider }
      );

      // memoryId1: ソフト削除のみ（孤立） - 2時間前
      await testDeletionManager.initiateDeletion(memoryId1, userId, 'user_request');

      // 時刻を2時間進める
      mockTimeProvider.advance(2 * 60 * 60 * 1000);

      // memoryId2: 完全削除（孤立でない） - 現在時刻
      await testDeletionManager.initiateDeletion(memoryId2, userId, 'user_request');
      await testDeletionManager.executePurge(memoryId2, userId, 'user_request');

      const orphans = await testDeletionManager.detectOrphanedDeletions(1);

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
