/**
 * Timeout Controller
 * タイムアウト制御機能
 *
 * オペレーションのタイムアウトを管理し、指定時間内に完了しない場合はエラーをスローします。
 */

import { TimeoutError } from './errors';

export interface TimeoutControllerConfig {
  /**
   * デフォルトタイムアウト（ミリ秒）
   * @default 120000 (2分)
   */
  defaultTimeout: number;
}

export class TimeoutController {
  private readonly config: TimeoutControllerConfig;
  private activeTimeouts: Set<NodeJS.Timeout> = new Set();

  constructor(config: TimeoutControllerConfig) {
    this.config = config;
  }

  /**
   * オペレーションをタイムアウト制御付きで実行
   *
   * @param operation 実行する非同期オペレーション
   * @param timeout カスタムタイムアウト（指定しない場合はデフォルト値）
   * @returns オペレーションの結果
   * @throws TimeoutError タイムアウト時
   */
  async execute<T>(
    operation: () => Promise<T>,
    timeout?: number
  ): Promise<T> {
    const timeoutMs = timeout ?? this.config.defaultTimeout;

    return new Promise<T>((resolve, reject) => {
      let timeoutHandle: NodeJS.Timeout | null = null;
      let isCompleted = false;

      // タイムアウトハンドラー
      timeoutHandle = setTimeout(() => {
        if (!isCompleted) {
          isCompleted = true;
          this.activeTimeouts.delete(timeoutHandle!);
          reject(
            new TimeoutError(`Operation timeout after ${timeoutMs}ms`, {
              timeout: timeoutMs,
            })
          );
        }
      }, timeoutMs);

      this.activeTimeouts.add(timeoutHandle);

      // オペレーション実行
      operation()
        .then((result) => {
          if (!isCompleted) {
            isCompleted = true;
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
              this.activeTimeouts.delete(timeoutHandle);
            }
            resolve(result);
          }
        })
        .catch((error) => {
          if (!isCompleted) {
            isCompleted = true;
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
              this.activeTimeouts.delete(timeoutHandle);
            }
            reject(error);
          }
        });
    });
  }

  /**
   * すべてのアクティブなタイムアウトをクリア
   */
  clearAll(): void {
    for (const timeout of this.activeTimeouts) {
      clearTimeout(timeout);
    }
    this.activeTimeouts.clear();
  }

  /**
   * アクティブなタイムアウトの数を取得
   */
  getActiveTimeouts(): number {
    return this.activeTimeouts.size;
  }

  /**
   * デストラクタ - すべてのタイムアウトをクリア
   */
  destroy(): void {
    this.clearAll();
  }
}
