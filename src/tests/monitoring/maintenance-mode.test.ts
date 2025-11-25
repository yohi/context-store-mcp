/**
 * Maintenance Mode Manager Tests
 * メンテナンスモードマネージャーのテスト
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MaintenanceModeManager,
  MaintenanceStatus,
  initializeMaintenanceMode,
  getMaintenanceManager,
} from '../../monitoring/maintenance-mode';

describe('MaintenanceModeManager', () => {
  let manager: MaintenanceModeManager;

  beforeEach(() => {
    manager = new MaintenanceModeManager();
  });

  afterEach(() => {
    manager.cleanup();
  });

  describe('基本的な有効化/無効化', () => {
    it('初期状態は無効', () => {
      expect(manager.isActive()).toBe(false);
      expect(manager.getInfo().status).toBe(MaintenanceStatus.INACTIVE);
    });

    it('メンテナンスモードを有効化できる', () => {
      manager.enable();
      expect(manager.isActive()).toBe(true);
      expect(manager.getInfo().status).toBe(MaintenanceStatus.ACTIVE);
    });

    it('メンテナンスモードを無効化できる', () => {
      manager.enable();
      manager.disable();
      expect(manager.isActive()).toBe(false);
      expect(manager.getInfo().status).toBe(MaintenanceStatus.INACTIVE);
    });

    it('カスタムメッセージで有効化できる', () => {
      const message = 'Custom maintenance message';
      manager.enable({ message });
      expect(manager.getInfo().message).toBe(message);
    });
  });

  describe('メンテナンス情報', () => {
    it('理由を含むメンテナンス情報を設定できる', () => {
      const reason = 'Database upgrade';
      manager.enable({ reason });
      expect(manager.getInfo().reason).toBe(reason);
    });

    it('影響を受けるサービスを指定できる', () => {
      const affectedServices = ['memory-service', 'query-service'];
      manager.enable({ affectedServices });
      expect(manager.getInfo().affectedServices).toEqual(affectedServices);
    });

    it('連絡先情報を含めることができる', () => {
      const contactInfo = 'support@example.com';
      manager.enable({ contactInfo });
      expect(manager.getInfo().contactInfo).toBe(contactInfo);
    });

    it('開始時刻が記録される', () => {
      const before = new Date();
      manager.enable();
      const after = new Date();

      const info = manager.getInfo();
      expect(info.startTime).toBeDefined();
      expect(info.startTime!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(info.startTime!.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('スケジュール機能', () => {
    it('メンテナンスをスケジュールできる', () => {
      const startTime = new Date(Date.now() + 1000);
      const endTime = new Date(Date.now() + 2000);

      manager.schedule({ startTime, endTime });
      expect(manager.isScheduled()).toBe(true);
      expect(manager.getInfo().status).toBe(MaintenanceStatus.SCHEDULED);
    });

    it('スケジュールされたメンテナンスをキャンセルできる', () => {
      const startTime = new Date(Date.now() + 1000);
      const endTime = new Date(Date.now() + 2000);

      manager.schedule({ startTime, endTime });
      manager.cancelScheduled();

      expect(manager.isScheduled()).toBe(false);
      expect(manager.getInfo().status).toBe(MaintenanceStatus.INACTIVE);
    });

    it('過去の開始時刻でスケジュールすると即座に有効化される', () => {
      const startTime = new Date(Date.now() - 1000);
      const endTime = new Date(Date.now() + 1000);

      manager.schedule({ startTime, endTime });
      expect(manager.isActive()).toBe(true);
    });

    it('終了時刻が指定されている場合、自動的に無効化される', async () => {
      const endTime = new Date(Date.now() + 100);
      manager.enable({ endTime });

      expect(manager.isActive()).toBe(true);

      // 終了時刻まで待機
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(manager.isActive()).toBe(false);
    });
  });

  describe('操作許可チェック', () => {
    it('非アクティブ時はすべての操作が許可される', () => {
      expect(manager.isOperationAllowed('read')).toBe(true);
      expect(manager.isOperationAllowed('write')).toBe(true);
      expect(manager.isOperationAllowed('health')).toBe(true);
    });

    it('アクティブ時は書き込み操作が拒否される', () => {
      manager.enable();
      expect(manager.isOperationAllowed('write')).toBe(false);
    });

    it('アクティブ時でもヘルスチェックは許可される（デフォルト）', () => {
      manager.enable();
      expect(manager.isOperationAllowed('health')).toBe(true);
    });

    it('設定により読み取り操作を許可できる', () => {
      manager.updateConfig({ allowReadOperations: true });
      manager.enable();
      expect(manager.isOperationAllowed('read')).toBe(true);
    });

    it('設定によりヘルスチェックを拒否できる', () => {
      manager.updateConfig({ allowHealthChecks: false });
      manager.enable();
      expect(manager.isOperationAllowed('health')).toBe(false);
    });
  });

  describe('設定管理', () => {
    it('設定を更新できる', () => {
      manager.updateConfig({
        allowHealthChecks: false,
        allowReadOperations: true,
        customMessage: 'Custom message',
      });

      const config = manager.getConfig();
      expect(config.allowHealthChecks).toBe(false);
      expect(config.allowReadOperations).toBe(true);
      expect(config.customMessage).toBe('Custom message');
    });

    it('設定を取得できる', () => {
      const config = manager.getConfig();
      expect(config).toBeDefined();
      expect(config.allowHealthChecks).toBeDefined();
    });
  });

  describe('エラー生成', () => {
    it('メンテナンスモードエラーを生成できる', () => {
      manager.enable({ message: 'System under maintenance' });
      const error = manager.createMaintenanceError();

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('MaintenanceModeError');
      expect(error.message).toBe('System under maintenance');
      expect((error as any).maintenanceInfo).toBeDefined();
    });
  });

  describe('グローバルマネージャー', () => {
    it('グローバルマネージャーを初期化できる', () => {
      const manager = initializeMaintenanceMode({
        allowHealthChecks: true,
      });

      expect(manager).toBeInstanceOf(MaintenanceModeManager);
    });

    it('グローバルマネージャーを取得できる', () => {
      initializeMaintenanceMode();
      const manager = getMaintenanceManager();
      expect(manager).toBeInstanceOf(MaintenanceModeManager);
    });

    it('初期化前でもグローバルマネージャーを取得できる', () => {
      const manager = getMaintenanceManager();
      expect(manager).toBeInstanceOf(MaintenanceModeManager);
    });
  });

  describe('クリーンアップ', () => {
    it('クリーンアップでタイマーをクリアできる', () => {
      const startTime = new Date(Date.now() + 1000);
      const endTime = new Date(Date.now() + 2000);

      manager.schedule({ startTime, endTime });
      manager.cleanup();

      // タイマーがクリアされたことを確認（エラーが発生しない）
      expect(() => manager.cleanup()).not.toThrow();
    });
  });
});
