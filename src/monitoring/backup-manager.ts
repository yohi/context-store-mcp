/**
 * Backup Manager
 * 自動バックアップ管理
 *
 * データベースの自動バックアップ機能を提供します。
 * Requirements: 8.6
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * バックアップステータス
 */
export enum BackupStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
  IN_PROGRESS = 'in_progress',
}

/**
 * バックアップ結果
 */
export interface BackupResult {
  id: string;
  status: BackupStatus;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  filePath?: string;
  fileSize?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * バックアップ設定
 */
export interface BackupConfig {
  backupDir?: string;
  schedule?: string; // cron形式
  retentionDays?: number;
  maxBackups?: number;
  compressionEnabled?: boolean;
  databases?: {
    postgresql?: {
      host: string;
      port: number;
      database: string;
      username: string;
      password: string;
    };
    neo4j?: {
      host: string;
      port: number;
      database: string;
      username: string;
      password: string;
    };
  };
}

/**
 * バックアップマネージャークラス
 */
export class BackupManager {
  private static readonly DEFAULT_BACKUP_DIR = './backups';
  private static readonly DEFAULT_RETENTION_DAYS = 30;
  private static readonly DEFAULT_MAX_BACKUPS = 100;

  private readonly config: Required<Omit<BackupConfig, 'databases'>> & Pick<BackupConfig, 'databases'>;
  private readonly backupHistory: BackupResult[] = [];
  private scheduleTimer?: NodeJS.Timeout;
  private backupIdCounter = 0;

  constructor(config?: BackupConfig) {
    this.config = {
      backupDir: config?.backupDir ?? BackupManager.DEFAULT_BACKUP_DIR,
      schedule: config?.schedule ?? '0 2 * * *', // デフォルト: 毎日午前2時
      retentionDays: config?.retentionDays ?? BackupManager.DEFAULT_RETENTION_DAYS,
      maxBackups: config?.maxBackups ?? BackupManager.DEFAULT_MAX_BACKUPS,
      compressionEnabled: config?.compressionEnabled ?? true,
      databases: config?.databases,
    };

    // バックアップディレクトリを作成
    if (!fs.existsSync(this.config.backupDir)) {
      fs.mkdirSync(this.config.backupDir, { recursive: true });
    }
  }

  /**
   * 自動バックアップを開始
   */
  start(): void {
    if (this.scheduleTimer) {
      return; // 既に開始済み
    }

    // スケジュールに基づいてバックアップを実行
    // 注: 本番環境では node-cron などのライブラリを使用
    const interval = this.parseCronToInterval(this.config.schedule);
    this.scheduleTimer = setInterval(async () => {
      try {
        await this.performBackup();
        await this.cleanupOldBackups();
      } catch (error) {
        console.error('Scheduled backup failed:', error);
      }
    }, interval);

    // 初回バックアップを即座に実行（オプション）
    // this.performBackup().catch(console.error);
  }

  /**
   * 自動バックアップを停止
   */
  stop(): void {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = undefined;
    }
  }

  /**
   * バックアップを実行
   */
  async performBackup(metadata?: Record<string, unknown>): Promise<BackupResult> {
    const backupId = `backup-${Date.now()}-${++this.backupIdCounter}`;
    const startTime = new Date();

    const result: BackupResult = {
      id: backupId,
      status: BackupStatus.IN_PROGRESS,
      startTime,
      metadata,
    };

    this.backupHistory.push(result);

    try {
      const backupFiles: string[] = [];

      // PostgreSQLバックアップ
      if (this.config.databases?.postgresql) {
        const pgFile = await this.backupPostgreSQL(backupId);
        backupFiles.push(pgFile);
      }

      // Neo4jバックアップ
      if (this.config.databases?.neo4j) {
        const neoFile = await this.backupNeo4j(backupId);
        backupFiles.push(neoFile);
      }

      // バックアップファイルを圧縮（オプション）
      let finalPath: string;
      if (this.config.compressionEnabled && backupFiles.length > 0) {
        finalPath = await this.compressBackups(backupId, backupFiles);
        // 元のファイルを削除
        for (const file of backupFiles) {
          fs.unlinkSync(file);
        }
      } else {
        finalPath = backupFiles[0] ?? '';
      }

      const endTime = new Date();
      const fileSize = finalPath ? fs.statSync(finalPath).size : 0;

      result.status = BackupStatus.SUCCESS;
      result.endTime = endTime;
      result.duration = endTime.getTime() - startTime.getTime();
      result.filePath = finalPath;
      result.fileSize = fileSize;

      return result;
    } catch (error) {
      const endTime = new Date();
      result.status = BackupStatus.FAILED;
      result.endTime = endTime;
      result.duration = endTime.getTime() - startTime.getTime();
      result.error = error instanceof Error ? error.message : String(error);

      throw error;
    }
  }

  /**
   * バックアップ履歴を取得
   */
  getBackupHistory(limit?: number): BackupResult[] {
    const history = [...this.backupHistory].reverse(); // 新しい順
    return limit ? history.slice(0, limit) : history;
  }

  /**
   * 最新のバックアップを取得
   */
  getLatestBackup(): BackupResult | undefined {
    return this.backupHistory[this.backupHistory.length - 1];
  }

  /**
   * バックアップを復元
   */
  async restoreBackup(backupId: string): Promise<void> {
    const backup = this.backupHistory.find((b) => b.id === backupId);
    if (!backup || !backup.filePath) {
      throw new Error(`Backup not found: ${backupId}`);
    }

    if (backup.status !== BackupStatus.SUCCESS) {
      throw new Error(`Cannot restore failed backup: ${backupId}`);
    }

    // 復元処理（実装は環境に依存）
    // 注: 本番環境では pg_restore, neo4j-admin restore などを使用
    throw new Error('Restore functionality not implemented');
  }

  /**
   * 古いバックアップを削除
   */
  async cleanupOldBackups(): Promise<number> {
    const now = Date.now();
    const cutoffTime = now - this.config.retentionDays * 24 * 60 * 60 * 1000;

    let deletedCount = 0;

    // 保持期間を超えたバックアップを削除
    for (const backup of this.backupHistory) {
      if (
        backup.startTime.getTime() < cutoffTime &&
        backup.filePath &&
        fs.existsSync(backup.filePath)
      ) {
        try {
          fs.unlinkSync(backup.filePath);
          deletedCount++;
        } catch (error) {
          console.error(`Failed to delete backup file: ${backup.filePath}`, error);
        }
      }
    }

    // 最大バックアップ数を超えた場合、古いものから削除
    if (this.backupHistory.length > this.config.maxBackups) {
      const excessCount = this.backupHistory.length - this.config.maxBackups;
      const toDelete = this.backupHistory.slice(0, excessCount);

      for (const backup of toDelete) {
        if (backup.filePath && fs.existsSync(backup.filePath)) {
          try {
            fs.unlinkSync(backup.filePath);
            deletedCount++;
          } catch (error) {
            console.error(`Failed to delete backup file: ${backup.filePath}`, error);
          }
        }
      }

      this.backupHistory.splice(0, excessCount);
    }

    return deletedCount;
  }

  /**
   * PostgreSQLバックアップ
   */
  private async backupPostgreSQL(backupId: string): Promise<string> {
    const config = this.config.databases?.postgresql;
    if (!config) {
      throw new Error('PostgreSQL configuration not provided');
    }

    const fileName = `${backupId}-postgresql.sql`;
    const filePath = path.join(this.config.backupDir, fileName);

    // pg_dump コマンドを実行
    const command = `PGPASSWORD="${config.password}" pg_dump -h ${config.host} -p ${config.port} -U ${config.username} -d ${config.database} -F p -f "${filePath}"`;

    try {
      await execAsync(command);
      return filePath;
    } catch (error) {
      throw new Error(`PostgreSQL backup failed: ${error}`);
    }
  }

  /**
   * Neo4jバックアップ
   */
  private async backupNeo4j(backupId: string): Promise<string> {
    const config = this.config.databases?.neo4j;
    if (!config) {
      throw new Error('Neo4j configuration not provided');
    }

    const fileName = `${backupId}-neo4j.dump`;
    const filePath = path.join(this.config.backupDir, fileName);

    // neo4j-admin dump コマンドを実行
    // 注: Neo4jのバックアップは通常、Neo4jサーバー上で実行する必要があります
    const command = `neo4j-admin dump --database=${config.database} --to="${filePath}"`;

    try {
      await execAsync(command);
      return filePath;
    } catch (error) {
      throw new Error(`Neo4j backup failed: ${error}`);
    }
  }

  /**
   * バックアップファイルを圧縮
   */
  private async compressBackups(backupId: string, files: string[]): Promise<string> {
    const archiveName = `${backupId}.tar.gz`;
    const archivePath = path.join(this.config.backupDir, archiveName);

    const fileList = files.map((f) => path.basename(f)).join(' ');
    const command = `tar -czf "${archivePath}" -C "${this.config.backupDir}" ${fileList}`;

    try {
      await execAsync(command);
      return archivePath;
    } catch (error) {
      throw new Error(`Compression failed: ${error}`);
    }
  }

  /**
   * Cron形式をインターバル（ミリ秒）に変換
   * 注: 簡易実装。本番環境では node-cron などを使用
   */
  private parseCronToInterval(cron: string): number {
    // デフォルト: 24時間（毎日）
    return 24 * 60 * 60 * 1000;
  }
}

/**
 * グローバルバックアップマネージャーインスタンス
 */
let globalBackupManager: BackupManager | undefined;

/**
 * グローバルバックアップマネージャーを初期化
 */
export function initializeBackupManager(config?: BackupConfig): BackupManager {
  globalBackupManager = new BackupManager(config);
  return globalBackupManager;
}

/**
 * グローバルバックアップマネージャーを取得
 */
export function getBackupManager(): BackupManager {
  if (!globalBackupManager) {
    globalBackupManager = new BackupManager();
  }
  return globalBackupManager;
}
