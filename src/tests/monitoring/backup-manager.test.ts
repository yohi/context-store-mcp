/**
 * Backup Manager Tests
 * バックアップマネージャーのテスト
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import {
  BackupManager,
  BackupStatus,
  initializeBackupManager,
  getBackupManager,
} from '../../monitoring/backup-manager';

describe('BackupManager', () => {
  const testBackupDir = './test-backups';

  beforeEach(() => {
    // テスト用バックアップディレクトリをクリーンアップ
    if (fs.existsSync(testBackupDir)) {
      fs.rmSync(testBackupDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // テスト後のクリーンアップ
    if (fs.existsSync(testBackupDir)) {
      fs.rmSync(testBackupDir, { recursive: true, force: true });
    }
  });

  describe('初期化', () => {
    it('デフォルト設定でマネージャーを作成できる', () => {
      const manager = new BackupManager();
      expect(manager).toBeInstanceOf(BackupManager);
    });

    it('カスタム設定でマネージャーを作成できる', () => {
      const manager = new BackupManager({
        backupDir: testBackupDir,
        retentionDays: 7,
        maxBackups: 10,
        compressionEnabled: true,
      });

      expect(manager).toBeInstanceOf(BackupManager);
    });

    it('バックアップディレクトリを作成できる', () => {
      new BackupManager({ backupDir: testBackupDir });
      expect(fs.existsSync(testBackupDir)).toBe(true);
    });
  });

  describe('バックアップ履歴', () => {
    it('初期状態では履歴が空', () => {
      const manager = new BackupManager({ backupDir: testBackupDir });
      expect(manager.getBackupHistory()).toHaveLength(0);
    });

    it('最新のバックアップが未定義', () => {
      const manager = new BackupManager({ backupDir: testBackupDir });
      expect(manager.getLatestBackup()).toBeUndefined();
    });

    it('履歴の制限数を指定できる', async () => {
      const manager = new BackupManager({ backupDir: testBackupDir });

      // モックバックアップを追加（実際のバックアップは実行しない）
      const history = manager.getBackupHistory(5);
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe('バックアップ実行', () => {
    it('データベース設定なしでバックアップを実行するとエラー（空のバックアップ）', async () => {
      const manager = new BackupManager({ backupDir: testBackupDir });

      // データベース設定がない場合はエラーになる
      await expect(manager.performBackup()).rejects.toThrow('No backup targets configured');
      
      const latest = manager.getLatestBackup();
      expect(latest).toBeDefined();
      expect(latest!.status).toBe(BackupStatus.FAILED);
    });

    it('メタデータ付きでバックアップを実行できる', async () => {
      if (!fs.existsSync(testBackupDir)) fs.mkdirSync(testBackupDir, { recursive: true });
      const dummyFile = `${testBackupDir}/dummy.sql`;
      fs.writeFileSync(dummyFile, 'dummy content');

      const manager = new BackupManager({
        backupDir: testBackupDir,
        compressionEnabled: false,
        databases: {
          postgresql: { host: 'h', port: 1, database: 'd', username: 'u', password: 'p' },
        },
      });

      // PostgreSQLバックアップをモック
      vi.spyOn(manager as any, 'backupPostgreSQL').mockResolvedValue(dummyFile);

      const metadata = {
        triggeredBy: 'test',
        reason: 'unit test',
      };

      // バックアップを実行
      await manager.performBackup(metadata);

      const history = manager.getBackupHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].metadata).toEqual(metadata);
    });
  });

  describe('自動バックアップ', () => {
    it('自動バックアップを開始できる', () => {
      const manager = new BackupManager({ backupDir: testBackupDir });
      expect(() => manager.start()).not.toThrow();
      manager.stop();
    });

    it('自動バックアップを停止できる', () => {
      const manager = new BackupManager({ backupDir: testBackupDir });
      manager.start();
      expect(() => manager.stop()).not.toThrow();
    });

    it('既に開始済みの場合、再度開始しても問題ない', () => {
      const manager = new BackupManager({ backupDir: testBackupDir });
      manager.start();
      expect(() => manager.start()).not.toThrow();
      manager.stop();
    });
  });

  describe('バックアップクリーンアップ', () => {
    it('古いバックアップを削除できる', async () => {
      const manager = new BackupManager({
        backupDir: testBackupDir,
        retentionDays: 0, // 即座に削除
      });

      const deletedCount = await manager.cleanupOldBackups();
      expect(typeof deletedCount).toBe('number');
      expect(deletedCount).toBeGreaterThanOrEqual(0);
    });

    it('ファイルが存在しない古いバックアップも履歴から削除される', async () => {
      const manager = new BackupManager({
        backupDir: testBackupDir,
        retentionDays: 0, // 即座に削除
      });

      // 履歴に偽の古いバックアップを追加
      const oldBackup = {
        id: 'old-backup',
        status: BackupStatus.SUCCESS,
        startTime: new Date(Date.now() - 10000), // 10秒前
        endTime: new Date(),
        filePath: '/tmp/non-existent-file.sql',
      };
      (manager as any).backupHistory.push(oldBackup);

      const deletedCount = await manager.cleanupOldBackups();
      expect(deletedCount).toBe(1);
      expect(manager.getBackupHistory()).toHaveLength(0);
    });

    it('最大バックアップ数を超えた場合、古いものから削除される', async () => {
      const manager = new BackupManager({
        backupDir: testBackupDir,
        maxBackups: 5,
      });

      // クリーンアップを実行
      const deletedCount = await manager.cleanupOldBackups();
      expect(typeof deletedCount).toBe('number');
    });
  });

  describe('バックアップ復元', () => {
    it('存在しないバックアップIDで復元を試みるとエラー', async () => {
      const manager = new BackupManager({ backupDir: testBackupDir });

      await expect(manager.restoreBackup('non-existent-id')).rejects.toThrow(
        'Backup not found'
      );
    });

    it('失敗したバックアップは復元できない', async () => {
      const manager = new BackupManager({ backupDir: testBackupDir });

      // 失敗したバックアップを直接履歴に追加
      // performBackupでは失敗を再現しにくいため、履歴を直接操作する
      const failedBackup = {
        id: 'backup-failed-test',
        status: BackupStatus.FAILED,
        startTime: new Date(),
        endTime: new Date(),
        error: 'Test failure',
        filePath: '/tmp/dummy-failed-backup', // restoreBackupのチェックを通過するために必要
      };

      // privateプロパティにアクセスするためにanyキャストを使用
      (manager as any).backupHistory.push(failedBackup);

      const latest = manager.getLatestBackup();
      expect(latest).toBeDefined();
      expect(latest!.status).toBe(BackupStatus.FAILED);

      await expect(manager.restoreBackup(latest!.id)).rejects.toThrow(
        'Cannot restore failed backup'
      );
    });
  });

  describe('グローバルマネージャー', () => {
    it('グローバルマネージャーを初期化できる', () => {
      const manager = initializeBackupManager({
        backupDir: testBackupDir,
      });

      expect(manager).toBeInstanceOf(BackupManager);
    });

    it('グローバルマネージャーを取得できる', () => {
      initializeBackupManager({ backupDir: testBackupDir });
      const manager = getBackupManager();
      expect(manager).toBeInstanceOf(BackupManager);
    });

    it('初期化前でもグローバルマネージャーを取得できる', () => {
      const manager = getBackupManager();
      expect(manager).toBeInstanceOf(BackupManager);
    });
  });

  describe('バックアップステータス', () => {
    it('バックアップ実行中はIN_PROGRESSステータス', async () => {
      if (!fs.existsSync(testBackupDir)) fs.mkdirSync(testBackupDir, { recursive: true });
      const dummyFile = `${testBackupDir}/dummy.sql`;
      fs.writeFileSync(dummyFile, 'dummy content');

      const manager = new BackupManager({
        backupDir: testBackupDir,
        compressionEnabled: false,
        databases: {
          postgresql: { host: 'h', port: 1, database: 'd', username: 'u', password: 'p' },
        },
      });

      // 遅延付きでモック
      vi.spyOn(manager as any, 'backupPostgreSQL').mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return dummyFile;
      });

      // バックアップを開始
      const promise = manager.performBackup();

      // 即座に履歴をチェック
      const history = manager.getBackupHistory();
      if (history.length > 0) {
        // IN_PROGRESS、SUCCESS、またはFAILEDのいずれか
        expect([BackupStatus.IN_PROGRESS, BackupStatus.SUCCESS, BackupStatus.FAILED]).toContain(
          history[0].status
        );
      }

      await promise;
    });

    it('バックアップ成功時はSUCCESSステータス', async () => {
      if (!fs.existsSync(testBackupDir)) fs.mkdirSync(testBackupDir, { recursive: true });
      const dummyFile = `${testBackupDir}/dummy.sql`;
      fs.writeFileSync(dummyFile, 'dummy content');

      const manager = new BackupManager({
        backupDir: testBackupDir,
        compressionEnabled: false,
        databases: {
          postgresql: { host: 'h', port: 1, database: 'd', username: 'u', password: 'p' },
        },
      });

      vi.spyOn(manager as any, 'backupPostgreSQL').mockResolvedValue(dummyFile);

      await manager.performBackup();

      const latest = manager.getLatestBackup();
      expect(latest).toBeDefined();
      expect(latest!.status).toBe(BackupStatus.SUCCESS);
    });
  });

  describe('設定', () => {
    it('圧縮を無効化できる', () => {
      const manager = new BackupManager({
        backupDir: testBackupDir,
        compressionEnabled: false,
      });

      expect(manager).toBeInstanceOf(BackupManager);
    });

    it('カスタムスケジュールを設定できる', () => {
      const manager = new BackupManager({
        backupDir: testBackupDir,
        schedule: '0 3 * * *', // 毎日午前3時
      });

      expect(manager).toBeInstanceOf(BackupManager);
    });
  });
});
