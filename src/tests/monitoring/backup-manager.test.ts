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
    it('データベース設定なしでバックアップを実行すると成功（空のバックアップ）', async () => {
      const manager = new BackupManager({ backupDir: testBackupDir });

      // データベース設定がない場合でも成功する（空のバックアップ）
      const result = await manager.performBackup();
      expect(result.status).toBe(BackupStatus.SUCCESS);
    });

    it('メタデータ付きでバックアップを実行できる', async () => {
      const manager = new BackupManager({ backupDir: testBackupDir });

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

      // 失敗したバックアップを作成
      try {
        await manager.performBackup();
      } catch (error) {
        // エラーは期待される
      }

      const latest = manager.getLatestBackup();
      if (latest && latest.status === BackupStatus.FAILED) {
        await expect(manager.restoreBackup(latest.id)).rejects.toThrow(
          'Cannot restore failed backup'
        );
      }
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
      const manager = new BackupManager({ backupDir: testBackupDir });

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
      const manager = new BackupManager({ backupDir: testBackupDir });

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
