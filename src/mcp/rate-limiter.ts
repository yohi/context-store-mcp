/**
 * Rate Limiter
 * レート制限機能
 *
 * クライアントごとのリクエスト数を制限し、過負荷を防ぎます。
 * スライディングウィンドウアルゴリズムを使用。
 */

import { RateLimitError } from './errors';

export interface RateLimiterConfig {
  /**
   * ウィンドウ期間内の最大リクエスト数
   * @default 100
   */
  maxRequests: number;

  /**
   * ウィンドウ期間（ミリ秒）
   * @default 60000 (1分)
   */
  windowMs: number;
}

interface ClientRequestLog {
  timestamps: number[];
  windowStart: number;
}

export class RateLimiter {
  private readonly config: RateLimiterConfig;
  private readonly clients: Map<string, ClientRequestLog> = new Map();

  constructor(config: RateLimiterConfig) {
    this.config = config;
  }

  /**
   * クライアントIDに対してレート制限をチェック
   *
   * @param clientId クライアントの一意識別子
   * @returns true: リクエスト許可, false: リクエスト拒否
   */
  async checkLimit(clientId: string): Promise<boolean> {
    const now = Date.now();
    const clientLog = this.getOrCreateClientLog(clientId);

    // 古いタイムスタンプを削除（ウィンドウ外）
    this.cleanupOldTimestamps(clientLog, now);

    // リクエスト数をチェック
    if (clientLog.timestamps.length >= this.config.maxRequests) {
      return false;
    }

    // 新しいリクエストを記録
    clientLog.timestamps.push(now);
    return true;
  }

  /**
   * クライアントの残りリクエスト数を取得
   *
   * @param clientId クライアントの一意識別子
   * @returns 残りリクエスト数
   */
  getRemaining(clientId: string): number {
    const now = Date.now();
    const clientLog = this.clients.get(clientId);

    if (!clientLog) {
      return this.config.maxRequests;
    }

    this.cleanupOldTimestamps(clientLog, now);
    return Math.max(0, this.config.maxRequests - clientLog.timestamps.length);
  }

  /**
   * クライアントの次のリセット時刻を取得
   *
   * @param clientId クライアントの一意識別子
   * @returns リセット時刻（UNIXタイムスタンプ）
   */
  getResetTime(clientId: string): number {
    const clientLog = this.clients.get(clientId);

    if (!clientLog || clientLog.timestamps.length === 0) {
      return Date.now() + this.config.windowMs;
    }

    // 最も古いタイムスタンプ + ウィンドウ期間
    return clientLog.timestamps[0] + this.config.windowMs;
  }

  /**
   * 特定のクライアントのレート制限をリセット
   *
   * @param clientId クライアントの一意識別子
   */
  reset(clientId: string): void {
    this.clients.delete(clientId);
  }

  /**
   * すべてのクライアントのレート制限をリセット
   */
  resetAll(): void {
    this.clients.clear();
  }

  /**
   * クライアントログを取得または作成
   */
  private getOrCreateClientLog(clientId: string): ClientRequestLog {
    let clientLog = this.clients.get(clientId);

    if (!clientLog) {
      clientLog = {
        timestamps: [],
        windowStart: Date.now(),
      };
      this.clients.set(clientId, clientLog);
    }

    return clientLog;
  }

  /**
   * ウィンドウ外の古いタイムスタンプを削除
   */
  private cleanupOldTimestamps(clientLog: ClientRequestLog, now: number): void {
    const windowStart = now - this.config.windowMs;

    clientLog.timestamps = clientLog.timestamps.filter((timestamp) => timestamp > windowStart);

    // ウィンドウ開始時刻を更新
    if (clientLog.timestamps.length > 0) {
      clientLog.windowStart = clientLog.timestamps[0];
    } else {
      clientLog.windowStart = now;
    }
  }

  /**
   * レート制限エラーを生成
   *
   * @param clientId クライアントの一意識別子
   * @returns RateLimitError
   */
  createRateLimitError(clientId: string): RateLimitError {
    return new RateLimitError('Rate limit exceeded', {
      clientId,
      maxRequests: this.config.maxRequests,
      windowMs: this.config.windowMs,
      resetTime: this.getResetTime(clientId),
      remaining: this.getRemaining(clientId),
    });
  }
}
