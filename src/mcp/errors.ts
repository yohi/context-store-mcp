/**
 * MCP Standard Error Codes and Custom Error Classes
 * MCP標準エラーコードとカスタムエラークラス
 *
 * Based on JSON-RPC 2.0 Specification and MCP extensions
 */

/**
 * MCP/JSON-RPC 2.0 Standard Error Codes
 * @see https://www.jsonrpc.org/specification#error_object
 */
export enum ErrorCode {
  // JSON-RPC 2.0 Standard Error Codes
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,

  // MCP Extended Error Codes
  TIMEOUT = -32001,
  RATE_LIMIT_EXCEEDED = -32002,
  SERVICE_UNAVAILABLE = -32003,
  AUTHENTICATION_FAILED = -32004,
  AUTHORIZATION_FAILED = -32005,
  RESOURCE_NOT_FOUND = -32006,
  CONFLICT = -32007,
  QUOTA_EXCEEDED = -32008,
}

/**
 * MCP Standard Error Class
 * MCP標準エラーを表現するクラス
 */
export class McpError extends Error {
  public readonly code: ErrorCode;
  public readonly data?: unknown;

  constructor(code: ErrorCode, message: string, data?: unknown) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.data = data;

    // スタックトレースの調整（V8エンジン用）
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, McpError);
    }
  }

  /**
   * JSON-RPC 2.0 Error Objectに変換
   */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      data: this.data,
    };
  }

  /**
   * エラーコードから人間可読なメッセージを取得
   */
  static getErrorMessage(code: ErrorCode): string {
    switch (code) {
      case ErrorCode.PARSE_ERROR:
        return 'Parse error';
      case ErrorCode.INVALID_REQUEST:
        return 'Invalid request';
      case ErrorCode.METHOD_NOT_FOUND:
        return 'Method not found';
      case ErrorCode.INVALID_PARAMS:
        return 'Invalid params';
      case ErrorCode.INTERNAL_ERROR:
        return 'Internal error';
      case ErrorCode.TIMEOUT:
        return 'Request timeout';
      case ErrorCode.RATE_LIMIT_EXCEEDED:
        return 'Rate limit exceeded';
      case ErrorCode.SERVICE_UNAVAILABLE:
        return 'Service unavailable';
      case ErrorCode.AUTHENTICATION_FAILED:
        return 'Authentication failed';
      case ErrorCode.AUTHORIZATION_FAILED:
        return 'Authorization failed';
      case ErrorCode.RESOURCE_NOT_FOUND:
        return 'Resource not found';
      case ErrorCode.CONFLICT:
        return 'Conflict';
      case ErrorCode.QUOTA_EXCEEDED:
        return 'Quota exceeded';
      default:
        return 'Unknown error';
    }
  }

  /**
   * エラーコードからHTTPステータスコードへのマッピング
   */
  static toHttpStatus(code: ErrorCode): number {
    switch (code) {
      case ErrorCode.PARSE_ERROR:
      case ErrorCode.INVALID_REQUEST:
      case ErrorCode.INVALID_PARAMS:
        return 400; // Bad Request

      case ErrorCode.AUTHENTICATION_FAILED:
        return 401; // Unauthorized

      case ErrorCode.AUTHORIZATION_FAILED:
        return 403; // Forbidden

      case ErrorCode.METHOD_NOT_FOUND:
      case ErrorCode.RESOURCE_NOT_FOUND:
        return 404; // Not Found

      case ErrorCode.CONFLICT:
        return 409; // Conflict

      case ErrorCode.RATE_LIMIT_EXCEEDED:
        return 429; // Too Many Requests

      case ErrorCode.SERVICE_UNAVAILABLE:
        return 503; // Service Unavailable

      case ErrorCode.INTERNAL_ERROR:
        return 500; // Internal Server Error

      case ErrorCode.TIMEOUT:
        return 504; // Gateway Timeout

      case ErrorCode.QUOTA_EXCEEDED:
        return 429; // Too Many Requests

      default:
        return 500; // Internal Server Error
    }
  }
}

/**
 * タイムアウトエラー
 */
export class TimeoutError extends McpError {
  constructor(message: string = 'Operation timeout', data?: unknown) {
    super(ErrorCode.TIMEOUT, message, data);
    this.name = 'TimeoutError';
  }
}

/**
 * レート制限エラー
 */
export class RateLimitError extends McpError {
  constructor(message: string = 'Rate limit exceeded', data?: unknown) {
    super(ErrorCode.RATE_LIMIT_EXCEEDED, message, data);
    this.name = 'RateLimitError';
  }
}

/**
 * サービス利用不可エラー
 *
 * NOTE: HTTPレスポンスを生成する際は、Retry-Afterヘッダーの追加を推奨
 * 例: response.setHeader('Retry-After', '60') // 60秒後にリトライ
 */
export class ServiceUnavailableError extends McpError {
  public readonly retryAfter?: number;

  constructor(message: string = 'Service unavailable', data?: unknown, retryAfter?: number) {
    super(ErrorCode.SERVICE_UNAVAILABLE, message, data);
    this.name = 'ServiceUnavailableError';
    this.retryAfter = retryAfter;
  }
}

/**
 * 認証失敗エラー
 */
export class AuthenticationError extends McpError {
  constructor(message: string = 'Authentication failed', data?: unknown) {
    super(ErrorCode.AUTHENTICATION_FAILED, message, data);
    this.name = 'AuthenticationError';
  }
}

/**
 * 認可失敗エラー
 */
export class AuthorizationError extends McpError {
  constructor(message: string = 'Authorization failed', data?: unknown) {
    super(ErrorCode.AUTHORIZATION_FAILED, message, data);
    this.name = 'AuthorizationError';
  }
}

/**
 * リソース未検出エラー
 */
export class ResourceNotFoundError extends McpError {
  constructor(message: string = 'Resource not found', data?: unknown) {
    super(ErrorCode.RESOURCE_NOT_FOUND, message, data);
    this.name = 'ResourceNotFoundError';
  }
}

/**
 * 競合エラー
 */
export class ConflictError extends McpError {
  constructor(message: string = 'Conflict', data?: unknown) {
    super(ErrorCode.CONFLICT, message, data);
    this.name = 'ConflictError';
  }
}

/**
 * クォータ超過エラー
 */
export class QuotaExceededError extends McpError {
  constructor(message: string = 'Quota exceeded', data?: unknown) {
    super(ErrorCode.QUOTA_EXCEEDED, message, data);
    this.name = 'QuotaExceededError';
  }
}
