/**
 * Structured Logger
 * 構造化ログシステム
 *
 * Winston を使用した構造化ログの実装
 * Requirements: 8.4
 */

import * as winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';

/**
 * ログレベル
 */
export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  HTTP = 'http',
  VERBOSE = 'verbose',
  DEBUG = 'debug',
  SILLY = 'silly',
}

/**
 * ログメタデータ
 */
export interface LogMetadata {
  [key: string]: unknown;
  userId?: string;
  sessionId?: string;
  requestId?: string;
  operationName?: string;
  duration?: number;
  error?: Error | ErrorInfo;
}

/**
 * エラー情報
 */
export interface ErrorInfo {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  cause?: unknown;
}

/**
 * ログエントリ
 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  metadata?: LogMetadata;
}

/**
 * 構造化ロガー設定
 */
export interface StructuredLoggerConfig {
  level?: LogLevel;
  logDir?: string;
  maxFiles?: number;
  maxSize?: string;
  enableConsole?: boolean;
  enableFile?: boolean;
  prettyPrint?: boolean;
}

/**
 * 構造化ロガークラス
 */
export class StructuredLogger {
  private static readonly DEFAULT_LOG_DIR = './logs';
  private static readonly DEFAULT_MAX_FILES = 14; // 14日分
  private static readonly DEFAULT_MAX_SIZE = '20m'; // 20MB

  private readonly logger: winston.Logger;
  private readonly config: Required<StructuredLoggerConfig>;

  constructor(config?: StructuredLoggerConfig) {
    this.config = {
      level: config?.level ?? LogLevel.INFO,
      logDir: config?.logDir ?? StructuredLogger.DEFAULT_LOG_DIR,
      maxFiles: config?.maxFiles ?? StructuredLogger.DEFAULT_MAX_FILES,
      maxSize: config?.maxSize ?? StructuredLogger.DEFAULT_MAX_SIZE,
      enableConsole: config?.enableConsole ?? true,
      enableFile: config?.enableFile ?? true,
      prettyPrint: config?.prettyPrint ?? process.env['NODE_ENV'] !== 'production',
    };

    // ログディレクトリを作成
    if (this.config.enableFile && !fs.existsSync(this.config.logDir)) {
      fs.mkdirSync(this.config.logDir, { recursive: true });
    }

    // Winstonロガーを作成
    this.logger = winston.createLogger({
      level: this.config.level,
      format: this.createFormat(),
      transports: this.createTransports(),
      exitOnError: false,
    });
  }

  /**
   * エラーログを記録
   */
  error(message: string, metadata?: LogMetadata): void {
    this.log(LogLevel.ERROR, message, metadata);
  }

  /**
   * 警告ログを記録
   */
  warn(message: string, metadata?: LogMetadata): void {
    this.log(LogLevel.WARN, message, metadata);
  }

  /**
   * 情報ログを記録
   */
  info(message: string, metadata?: LogMetadata): void {
    this.log(LogLevel.INFO, message, metadata);
  }

  /**
   * HTTPログを記録
   */
  http(message: string, metadata?: LogMetadata): void {
    this.log(LogLevel.HTTP, message, metadata);
  }

  /**
   * デバッグログを記録
   */
  debug(message: string, metadata?: LogMetadata): void {
    this.log(LogLevel.DEBUG, message, metadata);
  }

  /**
   * エラーをログに記録（スタックトレース付き）
   */
  logError(error: Error, context?: string, metadata?: LogMetadata): void {
    const errorInfo: ErrorInfo = {
      name: error.name,
      message: error.message,
      ...(error.stack && { stack: error.stack }),
      ...(((error as any).code !== undefined) && { code: (error as any).code }),
      ...(((error as any).cause !== undefined) && { cause: (error as any).cause }),
    };

    this.error(context ?? error.message, {
      ...metadata,
      error: errorInfo,
    });
  }

  /**
   * 操作のログを記録（開始と終了）
   */
  logOperation(
    operationName: string,
    fn: () => Promise<void> | void,
    metadata?: LogMetadata
  ): Promise<void> {
    const startTime = Date.now();
    const requestId = metadata?.requestId ?? this.generateRequestId();

    this.info(`Operation started: ${operationName}`, {
      ...metadata,
      operationName,
      requestId,
    });

    const logCompletion = (success: boolean, error?: Error) => {
      const duration = Date.now() - startTime;
      const level = success ? LogLevel.INFO : LogLevel.ERROR;
      const message = success
        ? `Operation completed: ${operationName}`
        : `Operation failed: ${operationName}`;

      const logMetadata: LogMetadata = {
        ...metadata,
        operationName,
        requestId,
        duration,
        success,
      };
      
      if (error) {
        logMetadata.error = this.serializeError(error);
      }
      
      this.log(level, message, logMetadata);
    };

    try {
      const result = fn();
      if (result instanceof Promise) {
        return result
          .then(() => {
            logCompletion(true);
          })
          .catch((error) => {
            logCompletion(false, error);
            throw error;
          });
      } else {
        logCompletion(true);
        return Promise.resolve();
      }
    } catch (error) {
      logCompletion(false, error as Error);
      return Promise.reject(error);
    }
  }

  /**
   * ログレベルを変更
   */
  setLevel(level: LogLevel): void {
    this.logger.level = level;
  }

  /**
   * ログを記録
   */
  private log(level: LogLevel, message: string, metadata?: LogMetadata): void {
    this.logger.log(level, message, metadata);
  }

  /**
   * フォーマットを作成
   */
  private createFormat(): winston.Logform.Format {
    const formats: winston.Logform.Format[] = [
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.errors({ stack: true }),
    ];

    if (this.config.prettyPrint) {
      formats.push(
        winston.format.colorize(),
        winston.format.printf(this.prettyPrintFormat)
      );
    } else {
      formats.push(winston.format.json());
    }

    return winston.format.combine(...formats);
  }

  /**
   * トランスポートを作成
   */
  private createTransports(): winston.transport[] {
    const transports: winston.transport[] = [];

    // コンソール出力
    if (this.config.enableConsole) {
      transports.push(
        new winston.transports.Console({
          format: this.config.prettyPrint
            ? winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(this.prettyPrintFormat)
              )
            : winston.format.json(),
        })
      );
    }

    // ファイル出力
    if (this.config.enableFile) {
      // エラーログファイル
      transports.push(
        new winston.transports.File({
          filename: path.join(this.config.logDir, 'error.log'),
          level: 'error',
          maxsize: this.parseSize(this.config.maxSize),
          maxFiles: this.config.maxFiles,
          format: winston.format.json(),
        })
      );

      // 統合ログファイル
      transports.push(
        new winston.transports.File({
          filename: path.join(this.config.logDir, 'combined.log'),
          maxsize: this.parseSize(this.config.maxSize),
          maxFiles: this.config.maxFiles,
          format: winston.format.json(),
        })
      );
    }

    return transports;
  }

  /**
   * プリティプリントフォーマット
   */
  private prettyPrintFormat(info: winston.Logform.TransformableInfo): string {
    const { timestamp, level, message, ...metadata } = info;
    let log = `${timestamp} [${level}]: ${message}`;

    if (Object.keys(metadata).length > 0) {
      log += `\n${JSON.stringify(metadata, null, 2)}`;
    }

    return log;
  }

  /**
   * サイズ文字列をバイト数に変換
   */
  private parseSize(size: string): number {
    const units: Record<string, number> = {
      b: 1,
      k: 1024,
      m: 1024 * 1024,
      g: 1024 * 1024 * 1024,
    };

    const match = size.toLowerCase().match(/^(\d+)([bkmg])?$/);
    if (!match || !match[1]) {
      return 20 * 1024 * 1024; // デフォルト 20MB
    }

    const value = parseInt(match[1], 10);
    const unit = match[2] ?? 'b';
    const multiplier = units[unit];
    
    if (multiplier === undefined) {
      return 20 * 1024 * 1024; // デフォルト 20MB
    }
    
    return value * multiplier;
  }

  /**
   * エラーをシリアライズ
   */
  private serializeError(error: Error): ErrorInfo {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack && { stack: error.stack }),
      ...(((error as any).code !== undefined) && { code: (error as any).code }),
      ...(((error as any).cause !== undefined) && { cause: (error as any).cause }),
    };
  }

  /**
   * リクエストIDを生成
   */
  private generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

/**
 * グローバルロガーインスタンス
 */
let globalLogger: StructuredLogger | undefined;

/**
 * グローバルロガーを初期化
 */
export function initializeLogger(config?: StructuredLoggerConfig): StructuredLogger {
  globalLogger = new StructuredLogger(config);
  return globalLogger;
}

/**
 * グローバルロガーを取得
 */
export function getLogger(): StructuredLogger {
  if (!globalLogger) {
    globalLogger = new StructuredLogger();
  }
  return globalLogger;
}
