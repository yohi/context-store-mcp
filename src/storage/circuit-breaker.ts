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
 * サーキットブレーカーの状態
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
 * サーキットブレーカーの設定
 */
export interface CircuitBreakerConfig {
  /** サーキットを開くための失敗回数の閾値 (デフォルト: 5) */
  failureThreshold?: number;
  /** HALF_OPENからサーキットを閉じるための成功回数の閾値 (デフォルト: 2) */
  successThreshold?: number;
  /** OPENからHALF_OPENに遷移するまでのタイムアウト（ミリ秒） (デフォルト: 30000ms = 30秒) */
  timeout?: number;
  /** 失敗率計算のためのウィンドウサイズ (デフォルト: 10) */
  windowSize?: number;
  /** サーキットを開くための失敗率の閾値 (0.0-1.0) (デフォルト: 0.5 = 50%) */
  failureRateThreshold?: number;
}

/**
 * サーキットブレーカーエラー
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
   * サーキットブレーカー保護付きで操作を実行する
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
   * 現在のサーキット状態を取得する
   */
  getState(): CircuitState {
    // OPEN状態でtimeoutが経過していればHALF_OPENに自動遷移
    if (this.state === CircuitState.OPEN && this.shouldTransitionToHalfOpen()) {
      this.transitionToHalfOpen();
    }
    return this.state;
  }

  /**
   * サーキットブレーカーをCLOSED状態にリセットする
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.recentResults = [];
  }

  /**
   * 成功した操作を処理する
   */
  private onSuccess(): void {
    this.recentResults.push(true);
    if (this.recentResults.length > this.config.windowSize) {
      this.recentResults.shift();
    }

    // 成功時は連続失敗カウントをリセット
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.transitionToClosed();
      }
    }
  }

  /**
   * 失敗した操作を処理する
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
   * サーキットを開くべきか確認する
   */
  private shouldOpen(): boolean {
    // 即座の連続障害検出: failureThreshold以上の連続失敗でサーキットを開く
    if (this.failureCount >= this.config.failureThreshold) {
      return true;
    }

    // ウィンドウベースの障害率検出: ウィンドウが満たされた場合のみ
    if (this.recentResults.length < this.config.windowSize) {
      return false;
    }

    // window が埋まっている場合は失敗率もチェック
    const failures = this.recentResults.filter((r) => !r).length;
    const failureRate = failures / this.recentResults.length;
    return failures >= this.config.failureThreshold && failureRate > this.config.failureRateThreshold;
  }

  /**
   * OPENからHALF_OPENに遷移すべきか確認する
   */
  private shouldTransitionToHalfOpen(): boolean {
    if (!this.lastFailureTime) {
      return false;
    }
    return Date.now() - this.lastFailureTime >= this.config.timeout;
  }

  /**
   * OPEN状態に遷移する
   */
  private transitionToOpen(): void {
    this.state = CircuitState.OPEN;
    this.lastFailureTime = Date.now();
  }

  /**
   * HALF_OPEN状態に遷移する
   */
  private transitionToHalfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.successCount = 0;
  }

  /**
   * CLOSED状態に遷移する
   */
  private transitionToClosed(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.recentResults = [];
  }
}
