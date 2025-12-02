/**
 * Performance Middleware
 * パフォーマンス計測用ミドルウェア
 *
 * MCPツール呼び出しのレイテンシ、成功率、エラー率を計測して
 * PerformanceMetricsに記録します。
 */

import { PerformanceMetrics } from '../mcp/performance-metrics';

/**
 * 実行コンテキスト
 * (将来的にリクエストIDやセッションIDを含めることが可能)
 */
export interface ExecutionContext {
  operationName: string;
  requestId?: string;
  sessionId?: string;
}

/**
 * パフォーマンス追跡ラッパー関数
 *
 * 指定された非同期関数をラップし、実行時間と結果（成功/失敗）を計測します。
 *
 * @param metrics PerformanceMetricsインスタンス
 * @param operationName オペレーション名（または動的に名前を決定する関数）
 * @param handler 実行する非同期関数
 * @returns ラップされた関数
 */
export function withPerformanceTracking<T, A extends any[]>(
  metrics: PerformanceMetrics,
  operationName: string | ((...args: A) => string),
  handler: (...args: A) => Promise<T>
): (...args: A) => Promise<T> {
  return async (...args: A): Promise<T> => {
    const start = Date.now();

    // オペレーション名の決定
    const name = typeof operationName === 'function'
      ? operationName(...args)
      : operationName;

    try {
      // ハンドラーの実行
      const result = await handler(...args);

      // 成功計測
      const duration = Date.now() - start;
      metrics.recordLatency(name, duration);
      metrics.recordSuccess(name);

      return result;
    } catch (error) {
      // エラー計測
      const duration = Date.now() - start;
      metrics.recordLatency(name, duration);
      metrics.recordError(name, error instanceof Error ? error : new Error(String(error)));

      throw error;
    }
  };
}

/**
 * MCPリクエストハンドラー用ミドルウェア
 * 
 * @param metrics PerformanceMetricsインスタンス
 * @param getOperationName リクエストからオペレーション名を抽出する関数
 */
export const createPerformanceMiddleware = (
  metrics: PerformanceMetrics,
  getOperationName: (request: unknown) => string
) => {
  return (next: (request: unknown) => Promise<unknown>) => {
    return async (request: unknown) => {
      const name = getOperationName(request);
      const start = Date.now();

      try {
        const result = await next(request);

        const duration = Date.now() - start;
        metrics.recordLatency(name, duration);
        metrics.recordSuccess(name);

        return result;
      } catch (error) {
        const duration = Date.now() - start;
        metrics.recordLatency(name, duration);
        metrics.recordError(name, error instanceof Error ? error : new Error(String(error)));

        throw error;
      }
    };
  };
};
