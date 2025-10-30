/**
 * Circuit Breaker Pattern
 *
 * タスク9.2: フェイルオーバーとエラーリカバリー
 * - サーキットブレーカーによる障害の伝播防止
 * - 状態遷移: CLOSED → OPEN → HALF_OPEN → CLOSED
 * - 連続5回失敗でOPEN、30秒後にHALF_OPEN、2回成功でCLOSED
 *
 * Requirements: 5.3 (ハイブリッドストレージのフェイルオーバーとエラーリカバリー)
 * Design Reference: design.md - サーキットブレーカーパターン
 */

/**
 * Circuit Breaker State
 */
export enum CircuitState {
  /** 正常動作、リクエスト通過 */
  CLOSED = 'CLOSED',
  /** 遮断状態、即座にエラー返却 */
  OPEN = 'OPEN',
  /** 回復テスト、限定的にリクエスト通過 */
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Circuit Breaker Configuration
 */
export interface CircuitBreakerConfig {
  /** Failure count threshold to open circuit (default: 5) */
  failureThreshold?: number;
  /** Success count threshold to close circuit from HALF_OPEN (default: 2) */
  successThreshold?: number;
  /** Timeout in milliseconds before transitioning from OPEN to HALF_OPEN (default: 30000ms = 30s) */
  timeout?: number;
  /** Window size for failure rate calculation (default: 10) */
  windowSize?: number;
  /** Failure rate threshold (0.0-1.0) to open circuit (default: 0.5 = 50%) */
  failureRateThreshold?: number;
}

/**
 * Circuit Breaker Error
 */
export class CircuitBreakerOpenError extends Error {
  constructor() {
    super('Circuit breaker is OPEN');
    this.name = 'CircuitBreakerOpenError';
  }
}

/**
 * Circuit Breaker
 *
 * 連続的な障害発生時にシステムを保護し、復旧を支援する。
 *
 * 状態遷移:
 * - Closed → Open: 直近10リクエスト中、5件以上失敗 AND 失敗率 > 50%
 * - Open → Half-Open: 30秒経過後、次のリクエストで自動的に遷移
 * - Half-Open → Closed: 連続2回成功
 * - Half-Open → Open: 1回でも失敗
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private recentResults: boolean[] = []; // true=success, false=failure
  private readonly config: Required<CircuitBreakerConfig>;

  constructor(config: CircuitBreakerConfig = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      successThreshold: config.successThreshold ?? 2,
      timeout: config.timeout ?? 30000,
      windowSize: config.windowSize ?? 10,
      failureRateThreshold: config.failureRateThreshold ?? 0.5,
    };
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // OPEN状態の場合、timeoutが経過していればHALF_OPENに遷移
    if (this.state === CircuitState.OPEN) {
      if (this.shouldTransitionToHalfOpen()) {
        this.transitionToHalfOpen();
      } else {
        throw new CircuitBreakerOpenError();
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    // OPEN状態でtimeoutが経過していればHALF_OPENに自動遷移
    if (this.state === CircuitState.OPEN && this.shouldTransitionToHalfOpen()) {
      this.transitionToHalfOpen();
    }
    return this.state;
  }

  /**
   * Reset circuit breaker to CLOSED state
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.recentResults = [];
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.recentResults.push(true);
    if (this.recentResults.length > this.config.windowSize) {
      this.recentResults.shift();
    }

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.transitionToClosed();
      }
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(): void {
    this.recentResults.push(false);
    if (this.recentResults.length > this.config.windowSize) {
      this.recentResults.shift();
    }

    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      // HALF_OPEN状態で1回でも失敗したらOPENに戻る
      this.transitionToOpen();
    } else if (this.state === CircuitState.CLOSED) {
      // CLOSED状態で閾値を超えたらOPENに遷移
      if (this.shouldOpen()) {
        this.transitionToOpen();
      }
    }
  }

  /**
   * Check if circuit should open
   */
  private shouldOpen(): boolean {
    // 最低でもwindowSize分のリクエストが必要
    if (this.recentResults.length < this.config.windowSize) {
      return false;
    }

    const failures = this.recentResults.filter((r) => !r).length;
    const failureRate = failures / this.recentResults.length;

    return failures >= this.config.failureThreshold && failureRate > this.config.failureRateThreshold;
  }

  /**
   * Check if circuit should transition from OPEN to HALF_OPEN
   */
  private shouldTransitionToHalfOpen(): boolean {
    if (!this.lastFailureTime) {
      return false;
    }
    return Date.now() - this.lastFailureTime >= this.config.timeout;
  }

  /**
   * Transition to OPEN state
   */
  private transitionToOpen(): void {
    this.state = CircuitState.OPEN;
    this.lastFailureTime = Date.now();
  }

  /**
   * Transition to HALF_OPEN state
   */
  private transitionToHalfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.successCount = 0;
  }

  /**
   * Transition to CLOSED state
   */
  private transitionToClosed(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.recentResults = [];
  }
}
