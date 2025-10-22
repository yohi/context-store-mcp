/**
 * MCP Authentication Middleware
 *
 * MCP標準に準拠した認証ミドルウェア
 *
 * 要件:
 * - MCP標準認証メカニズム
 * - APIキー検証
 * - セッション管理
 * - レート制限との統合
 * - 監査ログ記録
 */

import crypto from 'crypto';
import { ApiKeyManager, ApiKey } from './api-key-manager.js';

/**
 * 認証コンテキスト
 */
export interface AuthContext {
  /** 認証済みかどうか */
  authenticated: boolean;
  /** APIキー情報 */
  apiKey?: ApiKey;
  /** ユーザーID */
  userId?: string;
  /** セッションID */
  sessionId?: string;
  /** 権限スコープ */
  scopes: string[];
  /** リクエストメタデータ */
  metadata: {
    ipAddress?: string;
    userAgent?: string;
    requestedAt: Date;
  };
}

/**
 * 認証エラータイプ
 */
export type AuthErrorType =
  | 'missing_auth'
  | 'invalid_token'
  | 'expired_token'
  | 'revoked_token'
  | 'insufficient_scope'
  | 'rate_limit_exceeded';

/**
 * 認証エラー
 */
export class AuthenticationError extends Error {
  constructor(
    public type: AuthErrorType,
    message: string
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }

  /**
   * MCP標準エラーコードを取得
   */
  getMcpErrorCode(): string {
    switch (this.type) {
      case 'missing_auth':
      case 'invalid_token':
      case 'expired_token':
      case 'revoked_token':
        return 'mcp.error.unauthorized';
      case 'insufficient_scope':
        return 'mcp.error.forbidden';
      case 'rate_limit_exceeded':
        return 'mcp.error.rate_limit';
      default:
        return 'mcp.error.internal';
    }
  }

  /**
   * HTTPステータスコードを取得
   */
  getHttpStatusCode(): number {
    switch (this.type) {
      case 'missing_auth':
      case 'invalid_token':
      case 'expired_token':
      case 'revoked_token':
        return 401; // Unauthorized
      case 'insufficient_scope':
        return 403; // Forbidden
      case 'rate_limit_exceeded':
        return 429; // Too Many Requests
      default:
        return 500; // Internal Server Error
    }
  }
}

/**
 * 認証試行の記録
 */
export interface AuthAttempt {
  ipAddress: string;
  timestamp: Date;
  success: boolean;
  reason?: AuthErrorType;
}

/**
 * レート制限の設定
 */
export interface RateLimitConfig {
  /** 期間（ミリ秒） */
  windowMs: number;
  /** 最大試行回数 */
  maxAttempts: number;
  /** ブロック期間（ミリ秒） */
  blockDurationMs: number;
}

/**
 * MCP認証ミドルウェア
 */
export class McpAuthMiddleware {
  private apiKeyManager: ApiKeyManager;
  private authAttempts: Map<string, AuthAttempt[]> = new Map();
  private blockedIps: Map<string, Date> = new Map();
  private rateLimitConfig: RateLimitConfig;

  constructor(
    apiKeyManager: ApiKeyManager,
    rateLimitConfig: RateLimitConfig = {
      windowMs: 5 * 60 * 1000, // 5分
      maxAttempts: 10,
      blockDurationMs: 15 * 60 * 1000, // 15分
    }
  ) {
    this.apiKeyManager = apiKeyManager;
    this.rateLimitConfig = rateLimitConfig;
  }

  /**
   * 暗号学的に安全なセッションIDを生成
   *
   * crypto.randomUUID() を使用してUUIDv4を生成し、
   * "session_" プレフィックスを付加します。
   *
   * @returns 暗号学的に安全なセッションID (例: "session_a3bb189e-8bf9-4f11-a4f1-3a3e8b8e4e5c")
   */
  private generateSecureSessionId(): string {
    // Node.js v14.17.0+ および v15.6.0+ で crypto.randomUUID() が利用可能
    if (typeof crypto.randomUUID === 'function') {
      return `session_${crypto.randomUUID()}`;
    }

    // フォールバック: crypto.randomBytes を使用してUUIDv4を生成
    const bytes = crypto.randomBytes(16);

    // UUIDv4 形式に変換
    // version (4) と variant (RFC4122) ビットを設定
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant RFC4122

    // UUID文字列に変換
    const uuid = [
      bytes.subarray(0, 4).toString('hex'),
      bytes.subarray(4, 6).toString('hex'),
      bytes.subarray(6, 8).toString('hex'),
      bytes.subarray(8, 10).toString('hex'),
      bytes.subarray(10, 16).toString('hex'),
    ].join('-');

    return `session_${uuid}`;
  }

  /**
   * 認証ヘッダーからAPIキーを抽出
   *
   * サポートされる形式:
   * - Authorization: Bearer <api_key>
   * - X-API-Key: <api_key>
   */
  private extractApiKey(headers: Record<string, string | string[] | undefined>): string | null {
    // Authorization ヘッダー
    const authHeader = headers['authorization'] || headers['Authorization'];
    if (typeof authHeader === 'string') {
      const match = authHeader.match(/^Bearer\s+(\S+)$/i);
      if (match) {
        return match[1];
      }
    }

    // X-API-Key ヘッダー
    const apiKeyHeader = headers['x-api-key'] || headers['X-API-Key'];
    if (typeof apiKeyHeader === 'string') {
      return apiKeyHeader;
    }

    return null;
  }

  /**
   * レート制限をチェック
   */
  private checkRateLimit(ipAddress: string): void {
    const now = new Date();

    // IPブロックのチェック
    const blockedUntil = this.blockedIps.get(ipAddress);
    if (blockedUntil && blockedUntil > now) {
      const remainingMs = blockedUntil.getTime() - now.getTime();
      throw new AuthenticationError(
        'rate_limit_exceeded',
        `Too many failed authentication attempts. IP blocked for ${Math.ceil(remainingMs / 1000)} seconds.`
      );
    }

    // ブロック期間が過ぎていればクリア
    if (blockedUntil) {
      this.blockedIps.delete(ipAddress);
      this.authAttempts.delete(ipAddress);
    }

    // 失敗試行回数のチェック
    const attempts = this.authAttempts.get(ipAddress) || [];
    const windowStart = new Date(now.getTime() - this.rateLimitConfig.windowMs);

    // ウィンドウ内の失敗試行を集計
    const recentFailures = attempts.filter((attempt) => attempt.timestamp >= windowStart && !attempt.success);

    if (recentFailures.length >= this.rateLimitConfig.maxAttempts) {
      // IPをブロック
      const blockUntil = new Date(now.getTime() + this.rateLimitConfig.blockDurationMs);
      this.blockedIps.set(ipAddress, blockUntil);

      throw new AuthenticationError(
        'rate_limit_exceeded',
        `Too many failed authentication attempts. IP blocked for ${this.rateLimitConfig.blockDurationMs / 1000} seconds.`
      );
    }
  }

  /**
   * 認証試行を記録
   */
  private recordAuthAttempt(ipAddress: string, success: boolean, reason?: AuthErrorType): void {
    const attempts = this.authAttempts.get(ipAddress) || [];
    attempts.push({
      ipAddress,
      timestamp: new Date(),
      success,
      reason,
    });

    // 古い記録を削除（メモリ節約）
    const cutoff = new Date(Date.now() - this.rateLimitConfig.windowMs * 2);
    const filtered = attempts.filter((attempt) => attempt.timestamp >= cutoff);

    this.authAttempts.set(ipAddress, filtered);
  }

  /**
   * リクエストを認証
   *
   * @param headers HTTPヘッダー
   * @param ipAddress クライアントIPアドレス
   * @param userAgent User-Agentヘッダー
   * @returns 認証コンテキスト
   */
  async authenticate(
    headers: Record<string, string | string[] | undefined>,
    ipAddress: string,
    userAgent?: string
  ): Promise<AuthContext> {
    const requestedAt = new Date();

    try {
      // レート制限チェック
      this.checkRateLimit(ipAddress);

      // APIキーの抽出
      const apiKeyString = this.extractApiKey(headers);
      if (!apiKeyString) {
        this.recordAuthAttempt(ipAddress, false, 'missing_auth');
        throw new AuthenticationError('missing_auth', 'Missing authentication credentials');
      }

      // APIキーの検証
      const validationResult = await this.apiKeyManager.validateApiKey(apiKeyString);

      if (!validationResult.valid) {
        let errorType: AuthErrorType;
        switch (validationResult.reason) {
          case 'expired':
            errorType = 'expired_token';
            break;
          case 'revoked':
            errorType = 'revoked_token';
            break;
          default:
            errorType = 'invalid_token';
        }

        // 内部ログに詳細な理由を記録（クライアントには漏洩させない）
        console.warn(
          `Authentication failed for IP ${ipAddress}: ` +
            `type=${errorType}, reason=${validationResult.reason}, ` +
            `timestamp=${new Date().toISOString()}`
        );

        this.recordAuthAttempt(ipAddress, false, errorType);
        // 汎用的なエラーメッセージのみをクライアントに返す（情報漏洩防止）
        throw new AuthenticationError(errorType, 'Invalid API key');
      }

      const apiKey = validationResult.key!;

      // 認証成功を記録
      this.recordAuthAttempt(ipAddress, true);

      // 暗号学的に安全なセッションIDを生成
      const sessionId = this.generateSecureSessionId();

      // 認証コンテキストを構築
      return {
        authenticated: true,
        apiKey,
        userId: apiKey.metadata?.userId as string | undefined,
        sessionId,
        scopes: apiKey.scopes,
        metadata: {
          ipAddress,
          userAgent,
          requestedAt,
        },
      };
    } catch (error) {
      // 認証失敗のコンテキストを返す
      if (error instanceof AuthenticationError) {
        throw error;
      }

      // 予期しないエラー
      this.recordAuthAttempt(ipAddress, false, 'invalid_token');
      throw new AuthenticationError('invalid_token', 'Authentication failed');
    }
  }

  /**
   * 権限スコープをチェック
   *
   * @param authContext 認証コンテキスト
   * @param requiredScopes 必要なスコープ
   */
  checkScopes(authContext: AuthContext, requiredScopes: string[]): void {
    if (!authContext.authenticated) {
      throw new AuthenticationError('missing_auth', 'Not authenticated');
    }

    for (const requiredScope of requiredScopes) {
      if (!authContext.scopes.includes(requiredScope)) {
        throw new AuthenticationError('insufficient_scope', `Missing required scope: ${requiredScope}`);
      }
    }
  }

  /**
   * 監査ログエントリを生成
   *
   * 予約フィールド（timestamp, event_type, user_id等）の上書きを防ぐため、
   * 追加の詳細情報は専用の `details` キーにネストします。
   */
  createAuditLog(
    authContext: AuthContext,
    eventType: string,
    success: boolean,
    details?: Record<string, unknown>
  ): Record<string, unknown> {
    return {
      // 予約フィールド（上書き不可）
      timestamp: new Date().toISOString(),
      event_type: eventType,
      success,
      user_id: authContext.userId,
      session_id: authContext.sessionId,
      ip_address: authContext.metadata.ipAddress,
      user_agent: authContext.metadata.userAgent,
      api_key_id: authContext.apiKey?.id,
      scopes: authContext.scopes,
      // カスタム詳細情報を専用キーにネスト
      details: details || {},
    };
  }

  /**
   * テスト用：全データをクリア
   */
  clearAll(): void {
    this.authAttempts.clear();
    this.blockedIps.clear();
  }

  /**
   * 統計情報を取得
   */
  getStatistics(): {
    blockedIps: number;
    totalAttempts: number;
    failedAttempts: number;
  } {
    let totalAttempts = 0;
    let failedAttempts = 0;

    for (const attempts of this.authAttempts.values()) {
      totalAttempts += attempts.length;
      failedAttempts += attempts.filter((a) => !a.success).length;
    }

    return {
      blockedIps: this.blockedIps.size,
      totalAttempts,
      failedAttempts,
    };
  }
}
