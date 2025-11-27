/**
 * Maintenance Mode Manager
 * メンテナンスモード管理
 *
 * システムのメンテナンスモードを管理し、適切な通知を提供します。
 * Requirements: 8.5
 */

/**
 * メンテナンスモードステータス
 */
export enum MaintenanceStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SCHEDULED = 'scheduled',
}

/**
 * メンテナンス情報
 */
export interface MaintenanceInfo {
  status: MaintenanceStatus;
  message: string;
  startTime?: Date;
  endTime?: Date;
  reason?: string;
  affectedServices?: string[];
  contactInfo?: string;
}

/**
 * メンテナンスモード設定
 */
export interface MaintenanceModeConfig {
  allowHealthChecks?: boolean;
  allowReadOperations?: boolean;
  customMessage?: string;
}

/**
 * メンテナンスモードマネージャークラス
 */
export class MaintenanceModeManager {
  private maintenanceInfo: MaintenanceInfo = {
    status: MaintenanceStatus.INACTIVE,
    message: 'System is operational',
  };

  private config: Required<MaintenanceModeConfig> = {
    allowHealthChecks: true,
    allowReadOperations: false,
    customMessage: 'System is currently under maintenance. Please try again later.',
  };

  private scheduledMaintenanceTimer?: NodeJS.Timeout;

  /**
   * メンテナンスモードを有効化
   */
  enable(options?: {
    message?: string;
    reason?: string;
    endTime?: Date;
    affectedServices?: string[];
    contactInfo?: string;
  }): void {
    this.maintenanceInfo = {
      status: MaintenanceStatus.ACTIVE,
      message: options?.message ?? this.config.customMessage,
      startTime: new Date(),
      ...(options?.endTime !== undefined ? { endTime: options.endTime } : {}),
      ...(options?.reason !== undefined ? { reason: options.reason } : {}),
      ...(options?.affectedServices !== undefined ? { affectedServices: options.affectedServices } : {}),
      ...(options?.contactInfo !== undefined ? { contactInfo: options.contactInfo } : {}),
    };

    // 終了時刻が指定されている場合、自動的に無効化
    if (options?.endTime) {
      const delay = options.endTime.getTime() - Date.now();
      if (delay > 0) {
        this.scheduledMaintenanceTimer = setTimeout(() => {
          this.disable();
        }, delay);
      }
    }
  }

  /**
   * メンテナンスモードを無効化
   */
  disable(): void {
    if (this.scheduledMaintenanceTimer) {
      clearTimeout(this.scheduledMaintenanceTimer);
      delete this.scheduledMaintenanceTimer;
    }

    this.maintenanceInfo = {
      status: MaintenanceStatus.INACTIVE,
      message: 'System is operational',
    };
  }

  /**
   * メンテナンスをスケジュール
   */
  schedule(options: {
    startTime: Date;
    endTime: Date;
    message?: string;
    reason?: string;
    affectedServices?: string[];
    contactInfo?: string;
  }): void {
    const now = Date.now();
    const startDelay = options.startTime.getTime() - now;

    if (startDelay <= 0) {
      // 開始時刻が過去の場合、即座に有効化
      this.enable({
        ...(options.message !== undefined ? { message: options.message } : {}),
        ...(options.reason !== undefined ? { reason: options.reason } : {}),
        ...(options.endTime !== undefined ? { endTime: options.endTime } : {}),
        ...(options.affectedServices !== undefined ? { affectedServices: options.affectedServices } : {}),
        ...(options.contactInfo !== undefined ? { contactInfo: options.contactInfo } : {}),
      });
      return;
    }

    // スケジュール情報を設定
    this.maintenanceInfo = {
      status: MaintenanceStatus.SCHEDULED,
      message: options.message ?? `Maintenance scheduled from ${options.startTime.toISOString()} to ${options.endTime.toISOString()}`,
      startTime: options.startTime,
      endTime: options.endTime,
      ...(options?.reason !== undefined ? { reason: options.reason } : {}),
      ...(options?.affectedServices !== undefined ? { affectedServices: options.affectedServices } : {}),
      ...(options?.contactInfo !== undefined ? { contactInfo: options.contactInfo } : {}),
    };

    // 開始時刻にメンテナンスモードを有効化
    this.scheduledMaintenanceTimer = setTimeout(() => {
      this.enable({
        ...(options.message !== undefined ? { message: options.message } : {}),
        ...(options.reason !== undefined ? { reason: options.reason } : {}),
        ...(options.endTime !== undefined ? { endTime: options.endTime } : {}),
        ...(options.affectedServices !== undefined ? { affectedServices: options.affectedServices } : {}),
        ...(options.contactInfo !== undefined ? { contactInfo: options.contactInfo } : {}),
      });
    }, startDelay);
  }

  /**
   * スケジュールされたメンテナンスをキャンセル
   */
  cancelScheduled(): void {
    if (this.scheduledMaintenanceTimer) {
      clearTimeout(this.scheduledMaintenanceTimer);
      delete this.scheduledMaintenanceTimer;
    }

    if (this.maintenanceInfo.status === MaintenanceStatus.SCHEDULED) {
      this.maintenanceInfo = {
        status: MaintenanceStatus.INACTIVE,
        message: 'System is operational',
      };
    }
  }

  /**
   * メンテナンスモードが有効かチェック
   */
  isActive(): boolean {
    return this.maintenanceInfo.status === MaintenanceStatus.ACTIVE;
  }

  /**
   * メンテナンスがスケジュールされているかチェック
   */
  isScheduled(): boolean {
    return this.maintenanceInfo.status === MaintenanceStatus.SCHEDULED;
  }

  /**
   * メンテナンス情報を取得
   */
  getInfo(): MaintenanceInfo {
    return { ...this.maintenanceInfo };
  }

  /**
   * 設定を更新
   */
  updateConfig(config: Partial<MaintenanceModeConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 設定を取得
   */
  getConfig(): MaintenanceModeConfig {
    return { ...this.config };
  }

  /**
   * 操作が許可されているかチェック
   */
  isOperationAllowed(operationType: 'read' | 'write' | 'health'): boolean {
    if (!this.isActive()) {
      return true;
    }

    switch (operationType) {
      case 'health':
        return this.config.allowHealthChecks;
      case 'read':
        return this.config.allowReadOperations;
      case 'write':
        return false; // メンテナンス中は書き込み操作を常に拒否
      default:
        return false;
    }
  }

  /**
   * メンテナンスモードエラーを生成
   */
  createMaintenanceError(): Error {
    const error = new Error(this.maintenanceInfo.message);
    error.name = 'MaintenanceModeError';
    (error as any).maintenanceInfo = this.maintenanceInfo;
    return error;
  }

  /**
   * クリーンアップ
   */
  cleanup(): void {
    if (this.scheduledMaintenanceTimer) {
      clearTimeout(this.scheduledMaintenanceTimer);
      delete this.scheduledMaintenanceTimer;
    }
  }
}

/**
 * グローバルメンテナンスモードマネージャーインスタンス
 */
let globalMaintenanceManager: MaintenanceModeManager | undefined;

/**
 * グローバルメンテナンスモードマネージャーを初期化
 */
export function initializeMaintenanceMode(
  config?: MaintenanceModeConfig
): MaintenanceModeManager {
  globalMaintenanceManager = new MaintenanceModeManager();
  if (config) {
    globalMaintenanceManager.updateConfig(config);
  }
  return globalMaintenanceManager;
}

/**
 * グローバルメンテナンスモードマネージャーを取得
 */
export function getMaintenanceManager(): MaintenanceModeManager {
  if (!globalMaintenanceManager) {
    globalMaintenanceManager = new MaintenanceModeManager();
  }
  return globalMaintenanceManager;
}
