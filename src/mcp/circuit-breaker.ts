/**
 * Circuit Breaker Pattern
 * サーキットブレーカーパターン
 *
 * 連続的な障害からシステムを保護し、復旧を支援します。
 * 3つの状態（CLOSED, OPEN, HALF_OPEN）を管理します。
 *
 * @see design.md - サーキットブレーカーパターン
 */

import { ServiceUnavailableError } from './errors';

/**
 * サーキットブレーカーの状態
 */
export enum CircuitState {
  /**
   * CLOSED: 正常動作、リクエスト通過
   */
  CLOSED = 'CLOSED',

  /**
   * OPEN: 遮断状態、即座にエラー返却
   */
  OPEN = 'OPEN',

  /**
   * HALF_OPEN: 回復テスト、限定的にリクエスト通過
   */
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * サーキットブレーカー設定
 */
export interface CircuitBreakerConfig {
  /**
   * 失敗カウント閾値
   * この回数連続で失敗するとOPEN状態に遷移
   * @default 5
   */
  failureThreshold: number;

  /**
   * 成功カウント閾値
   * HALF_OPEN状態でこの回数成功するとCLOSED状態に復帰
   * @default 2
   */
  successThreshold: number;

  /**
   * タイムアウト期間（ミリ秒）
   * OPEN状態からHALF_OPEN状態への遷移待機時間
   * @default 30000 (30秒)
   */
  timeout: number;

  /**
   * 監視するリクエスト数（ウィンドウサイズ）
   * @default 10
   */
  windowSize: number;

  /**
   * 失敗率閾値（0.0 - 1.0）
   * この失敗率を超えるとOPEN状態に遷移
   * @default 0.5 (50%)
   */
  failureRateThreshold: number;
}

interface RequestRecord {
  timestamp: number;
  success: boolean;
}

export class CircuitBreaker {
  private readonly config: Readonly<CircuitBreakerConfig>;
  private state: CircuitState = CircuitState.CLOSED;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private lastFailureTime: number | null = null;
  private requestHistory: RequestRecord[] = [];
  private openStateTimer: NodeJS.Timeout | null = null;
  private halfOpenProbeInFlight = false;

  constructor(config: CircuitBreakerConfig) {
    this.validateConfig(config);
    // Clone and freeze to prevent external mutation
    this.config = Object.freeze({ ...config });
  }

  /**
   * Validate circuit breaker configuration
   * @private
   */
  private validateConfig(config: CircuitBreakerConfig): void {
    // Required fields check
    if (config.failureThreshold === undefined || config.failureThreshold === null) {
      throw new Error('failureThreshold is required');
    }
    if (config.successThreshold === undefined || config.successThreshold === null) {
      throw new Error('successThreshold is required');
    }
    if (config.timeout === undefined || config.timeout === null) {
      throw new Error('timeout is required');
    }
    if (config.windowSize === undefined || config.windowSize === null) {
      throw new Error('windowSize is required');
    }
    if (config.failureRateThreshold === undefined || config.failureRateThreshold === null) {
      throw new Error('failureRateThreshold is required');
    }

    // Type validation
    if (typeof config.failureThreshold !== 'number') {
      throw new TypeError('failureThreshold must be a number');
    }
    if (typeof config.successThreshold !== 'number') {
      throw new TypeError('successThreshold must be a number');
    }
    if (typeof config.timeout !== 'number') {
      throw new TypeError('timeout must be a number');
    }
    if (typeof config.windowSize !== 'number') {
      throw new TypeError('windowSize must be a number');
    }
    if (typeof config.failureRateThreshold !== 'number') {
      throw new TypeError('failureRateThreshold must be a number');
    }

    // Range validation - no negative values
    if (config.failureThreshold < 0) {
      throw new RangeError('failureThreshold must be non-negative');
    }
    if (config.successThreshold < 0) {
      throw new RangeError('successThreshold must be non-negative');
    }
    if (config.timeout <= 0) {
      throw new RangeError('timeout must be positive');
    }
    if (config.windowSize <= 0) {
      throw new RangeError('windowSize must be positive');
    }

    // Percentage range validation (0.0 - 1.0)
    if (config.failureRateThreshold < 0 || config.failureRateThreshold > 1) {
      throw new RangeError('failureRateThreshold must be between 0.0 and 1.0');
    }

    // Logical validation
    if (!Number.isFinite(config.failureThreshold)) {
      throw new RangeError('failureThreshold must be a finite number');
    }
    if (!Number.isFinite(config.successThreshold)) {
      throw new RangeError('successThreshold must be a finite number');
    }
    if (!Number.isFinite(config.timeout)) {
      throw new RangeError('timeout must be a finite number');
    }
    if (!Number.isFinite(config.windowSize)) {
      throw new RangeError('windowSize must be a finite number');
    }
    if (!Number.isFinite(config.failureRateThreshold)) {
      throw new RangeError('failureRateThreshold must be a finite number');
    }

    // Ensure positive thresholds make sense
    if (config.failureThreshold === 0 && config.failureRateThreshold === 0) {
      throw new Error('At least one threshold (failureThreshold or failureRateThreshold) must be positive');
    }
  }

  /**
   * オペレーションをサーキットブレーカー保護付きで実行
   *
   * @param operation 実行する非同期オペレーション
   * @returns オペレーションの結果
   * @throws ServiceUnavailableError サーキットがOPEN状態の場合
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // 状態チェックと遷移
    this.checkAndTransitionState();

    // OPEN状態では即座に拒否
    if (this.state === CircuitState.OPEN) {
      throw new ServiceUnavailableError('Circuit breaker is OPEN', {
        state: this.state,
        consecutiveFailures: this.consecutiveFailures,
        lastFailureTime: this.lastFailureTime,
        nextAttemptTime: this.getNextAttemptTime(),
      });
    }

    // HALF_OPEN中はプローブを1本に制限（トラフィックスパイク防止）
    let usedHalfOpenProbe = false;
    if (this.state === CircuitState.HALF_OPEN) {
      if (this.halfOpenProbeInFlight) {
        throw new ServiceUnavailableError(
          'Circuit breaker is HALF_OPEN (probe in flight)',
          {
            state: this.state,
            consecutiveFailures: this.consecutiveFailures,
            lastFailureTime: this.lastFailureTime,
            nextAttemptTime: this.getNextAttemptTime(),
          }
        );
      }
      this.halfOpenProbeInFlight = true;
      usedHalfOpenProbe = true;
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    } finally {
      if (usedHalfOpenProbe) {
        this.halfOpenProbeInFlight = false;
      }
    }
  }

  /**
   * 現在の状態を取得
   */
  getState(): CircuitState {
    this.checkAndTransitionState();
    return this.state;
  }

  /**
   * 次の試行可能時刻を取得
   */
  getNextAttemptTime(): number | null {
    if (this.state !== CircuitState.OPEN || !this.lastFailureTime) {
      return null;
    }
    return this.lastFailureTime + this.config.timeout;
  }

  /**
   * サーキットブレーカーをリセット
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = null;
    this.requestHistory = [];
    this.clearOpenStateTimer();
    this.halfOpenProbeInFlight = false;
  }

  /**
   * 成功を記録
   */
  private recordSuccess(): void {
    const now = Date.now();
    this.requestHistory.push({ timestamp: now, success: true });
    this.trimRequestHistory();

    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;

    // HALF_OPEN状態で連続成功閾値に達したらCLOSEDに復帰
    if (
      this.state === CircuitState.HALF_OPEN &&
      this.consecutiveSuccesses >= this.config.successThreshold
    ) {
      this.transitionTo(CircuitState.CLOSED);
      this.consecutiveSuccesses = 0;
    }
  }

  /**
   * 失敗を記録
   */
  private recordFailure(): void {
    const now = Date.now();
    this.requestHistory.push({ timestamp: now, success: false });
    this.trimRequestHistory();

    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = now;

    // HALF_OPEN状態で失敗したら即座にOPENに戻る
    if (this.state === CircuitState.HALF_OPEN) {
      this.transitionTo(CircuitState.OPEN);
      return;
    }

    // CLOSED状態で失敗閾値または失敗率閾値を超えたらOPENに遷移
    if (this.state === CircuitState.CLOSED) {
      const shouldOpen =
        this.consecutiveFailures >= this.config.failureThreshold ||
        this.calculateFailureRate() > this.config.failureRateThreshold;

      if (shouldOpen) {
        this.transitionTo(CircuitState.OPEN);
      }
    }
  }

  /**
   * 状態をチェックして必要に応じて遷移
   */
  private checkAndTransitionState(): void {
    if (
      this.state === CircuitState.OPEN &&
      this.lastFailureTime !== null &&
      Date.now() - this.lastFailureTime >= this.config.timeout
    ) {
      this.transitionTo(CircuitState.HALF_OPEN);
    }
  }

  /**
   * 状態遷移
   */
  private transitionTo(newState: CircuitState): void {
    this.state = newState;

    // OPEN状態に遷移した場合、タイマーをセット
    if (newState === CircuitState.OPEN) {
      this.clearOpenStateTimer();
      this.openStateTimer = setTimeout(() => {
        if (this.state === CircuitState.OPEN) {
          this.transitionTo(CircuitState.HALF_OPEN);
        }
      }, this.config.timeout);
    }

    // CLOSED状態に復帰した場合、カウンターをリセット
    if (newState === CircuitState.CLOSED) {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses = 0;
      this.clearOpenStateTimer();
      this.halfOpenProbeInFlight = false;
    }

    // HALF_OPEN状態に遷移した場合、タイマーをクリアして最初のプローブを許可
    if (newState === CircuitState.HALF_OPEN) {
      this.clearOpenStateTimer();
      this.halfOpenProbeInFlight = false; // 最初のプローブを許可
    }
  }

  /**
   * リクエスト履歴をトリム（古いレコードを削除）
   */
  private trimRequestHistory(): void {
    if (this.requestHistory.length > this.config.windowSize) {
      this.requestHistory = this.requestHistory.slice(
        -this.config.windowSize
      );
    }
  }

  /**
   * 失敗率を計算
   */
  private calculateFailureRate(): number {
    if (this.requestHistory.length === 0) {
      return 0;
    }

    const failures = this.requestHistory.filter((r) => !r.success).length;
    return failures / this.requestHistory.length;
  }

  /**
   * OPEN状態タイマーをクリア
   */
  private clearOpenStateTimer(): void {
    if (this.openStateTimer) {
      clearTimeout(this.openStateTimer);
      this.openStateTimer = null;
    }
  }

  /**
   * デストラクタ - タイマーをクリーンアップ
   */
  destroy(): void {
    this.clearOpenStateTimer();
  }
}
