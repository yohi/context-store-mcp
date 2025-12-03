/**
 * エラーハンドラー
 * Liteモードにおけるエラー分類と優雅な劣化を実装
 */

// Error handler for Lite mode graceful degradation

/**
 * エラーコンテキスト
 */
export interface ErrorContext {
  operation: string;
  component: string;
  metadata?: Record<string, unknown>;
}

/**
 * エラーレスポンス
 */
export interface ErrorResponse {
  success: boolean;
  degraded?: boolean;
  error?: string;
  retryable?: boolean;
}

/**
 * エラーカテゴリ
 */
export enum ErrorCategory {
  FATAL = 'fatal',
  RECOVERABLE = 'recoverable',
  RETRYABLE = 'retryable',
  UNKNOWN = 'unknown',
}

/**
 * 劣化状態
 */
export interface DegradationState {
  graphStoreDisabled: boolean;
  redisCacheDisabled: boolean;
  vectorEmbeddingDisabled: boolean;
}

/**
 * Neo4j接続エラー
 */
export class Neo4jConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Neo4jConnectionError';
  }
}

/**
 * Redis接続エラー
 */
export class RedisConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedisConnectionError';
  }
}

/**
 * 埋め込みサービスエラー
 */
export class EmbeddingServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingServiceError';
  }
}

/**
 * エラーハンドラークラス
 * エラーの分類、優雅な劣化、再試行ロジックを管理
 */
export class ErrorHandler {
  private degradationState: DegradationState = {
    graphStoreDisabled: false,
    redisCacheDisabled: false,
    vectorEmbeddingDisabled: false,
  };

  private logger: {
    error: (message: string, context?: Record<string, unknown>) => void;
    warn: (message: string, context?: Record<string, unknown>) => void;
    info: (message: string, context?: Record<string, unknown>) => void;
  };

  constructor(logger?: typeof console) {
    this.logger = logger || console;
  }

  /**
   * エラーを処理し、適切なレスポンスを返す
   */
  handleError(error: Error, context: ErrorContext): ErrorResponse {
    const category = this.categorizeError(error);

    switch (category) {
      case ErrorCategory.FATAL:
        return this.handleFatalError(error, context);

      case ErrorCategory.RECOVERABLE:
        return this.handleRecoverableError(error, context);

      case ErrorCategory.RETRYABLE:
        return this.handleRetryableError(error, context);

      default:
        return this.handleUnknownError(error, context);
    }
  }

  /**
   * エラーをカテゴリに分類
   */
  private categorizeError(error: Error): ErrorCategory {
    // 致命的エラー
    if (this.isFatalError(error)) {
      return ErrorCategory.FATAL;
    }

    // 回復可能エラー
    if (this.isRecoverableError(error)) {
      return ErrorCategory.RECOVERABLE;
    }

    // 再試行可能エラー
    if (this.isRetryableError(error)) {
      return ErrorCategory.RETRYABLE;
    }

    return ErrorCategory.UNKNOWN;
  }

  /**
   * 致命的エラーかどうかを判定
   */
  private isFatalError(error: Error): boolean {
    // PostgreSQL接続失敗
    if (error.message.includes('ECONNREFUSED') && error.message.includes('5432')) {
      return true;
    }

    // 必須環境変数の欠落
    if (error.message.includes('DATABASE_URL') && error.message.includes('required')) {
      return true;
    }

    // 設定ファイルの破損
    if (error.message.includes('Invalid configuration')) {
      return true;
    }

    return false;
  }

  /**
   * 回復可能エラーかどうかを判定
   */
  private isRecoverableError(error: Error): boolean {
    return (
      error instanceof Neo4jConnectionError ||
      error instanceof RedisConnectionError ||
      error instanceof EmbeddingServiceError
    );
  }

  /**
   * 再試行可能エラーかどうかを判定
   */
  private isRetryableError(error: Error): boolean {
    // ネットワークタイムアウト
    if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
      return true;
    }

    // 一時的なデータベース接続エラー
    if (error.message.includes('ECONNRESET') || error.message.includes('Connection terminated')) {
      return true;
    }

    // APIレートリミット
    if (error.message.includes('rate limit') || error.message.includes('429')) {
      return true;
    }

    return false;
  }

  /**
   * 致命的エラーを処理
   */
  private handleFatalError(error: Error, context: ErrorContext): ErrorResponse {
    this.logger.error('Fatal error, shutting down', {
      error: error.message,
      stack: error.stack,
      context,
    });

    // プロセスを終了
    process.exit(1);
  }

  /**
   * 回復可能エラーを処理
   */
  private handleRecoverableError(error: Error, context: ErrorContext): ErrorResponse {
    this.logger.warn('Recoverable error, degrading functionality', {
      error: error.message,
      context,
    });

    this.degradeGracefully(error, context);

    return {
      success: false,
      degraded: true,
      error: error.message,
    };
  }

  /**
   * 再試行可能エラーを処理
   */
  private handleRetryableError(error: Error, context: ErrorContext): ErrorResponse {
    this.logger.info('Retryable error, scheduling retry', {
      error: error.message,
      context,
    });

    return {
      success: false,
      retryable: true,
      error: error.message,
    };
  }

  /**
   * 未知のエラーを処理
   */
  private handleUnknownError(error: Error, context: ErrorContext): ErrorResponse {
    this.logger.error('Unexpected error', {
      error: error.message,
      stack: error.stack,
      context,
    });

    return {
      success: false,
      error: error.message,
    };
  }

  /**
   * 優雅な劣化を実行
   */
  private degradeGracefully(error: Error, _context: ErrorContext): void {
    if (error instanceof Neo4jConnectionError) {
      this.disableGraphStore();
    } else if (error instanceof RedisConnectionError) {
      this.switchToInMemoryCache();
    } else if (error instanceof EmbeddingServiceError) {
      this.disableVectorEmbedding();
    }
  }

  /**
   * グラフストアを無効化
   */
  private disableGraphStore(): void {
    if (!this.degradationState.graphStoreDisabled) {
      this.degradationState.graphStoreDisabled = true;
      this.logger.warn('Graph store disabled due to Neo4j connection failure', {
        feature: 'graph-relationships',
        impact: 'Graph traversal and relationship queries will be unavailable',
      });
    }
  }

  /**
   * インメモリキャッシュに切り替え
   */
  private switchToInMemoryCache(): void {
    if (!this.degradationState.redisCacheDisabled) {
      this.degradationState.redisCacheDisabled = true;
      this.logger.warn('Switched to in-memory cache due to Redis connection failure', {
        feature: 'caching',
        impact: 'Cache will not be shared across instances',
      });
    }
  }

  /**
   * ベクトル埋め込みを無効化
   */
  private disableVectorEmbedding(): void {
    if (!this.degradationState.vectorEmbeddingDisabled) {
      this.degradationState.vectorEmbeddingDisabled = true;
      this.logger.warn('Vector embedding disabled due to embedding service failure', {
        feature: 'vector-search',
        impact: 'Semantic search will be unavailable, only metadata-based search will work',
      });
    }
  }

  /**
   * 再試行をスケジュール
   */
  scheduleRetry(error: Error, _context: ErrorContext, retryCount: number = 0): ErrorResponse {
    const maxRetries = 3;
    const backoffMs = Math.pow(2, retryCount) * 1000;

    if (retryCount >= maxRetries) {
      this.logger.error('Max retries exceeded', {
        error: error.message,
        context: _context,
        retryCount,
      });

      return {
        success: false,
        error: `Max retries exceeded: ${error.message}`,
      };
    }

    this.logger.info('Scheduling retry', {
      error: error.message,
      context: _context,
      retryCount,
      backoffMs,
    });

    return {
      success: false,
      retryable: true,
      error: error.message,
    };
  }

  /**
   * 現在の劣化状態を取得
   */
  getDegradationState(): DegradationState {
    return { ...this.degradationState };
  }

  /**
   * 機能が利用可能かどうかを確認
   */
  isFeatureAvailable(feature: 'graphStore' | 'redisCache' | 'vectorEmbedding'): boolean {
    switch (feature) {
      case 'graphStore':
        return !this.degradationState.graphStoreDisabled;
      case 'redisCache':
        return !this.degradationState.redisCacheDisabled;
      case 'vectorEmbedding':
        return !this.degradationState.vectorEmbeddingDisabled;
      default:
        return true;
    }
  }
}
