/**
 * Rate Limiter Tests
 *
 * getResetTime修正の検証テスト
 * - 期限切れタイムスタンプのクリーンアップ
 * - 正確なリセット時刻の計算
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RateLimiter } from '../../mcp/rate-limiter.js';

describe('RateLimiter - getResetTime修正の検証', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    // デフォルト設定: 60秒で10リクエストまで
    rateLimiter = new RateLimiter({
      maxRequests: 10,
      windowMs: 60000, // 60秒
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getResetTime - リセット時刻の計算', () => {
    it('新規クライアントの場合、現在時刻+ウィンドウ期間を返す', () => {
      const clientId = 'new-client';
      const now = Date.now();

      vi.spyOn(Date, 'now').mockReturnValue(now);

      const resetTime = rateLimiter.getResetTime(clientId);
      expect(resetTime).toBe(now + 60000);
    });

    it('リクエスト履歴がある場合、最も古いタイムスタンプ+ウィンドウ期間を返す', async () => {
      const clientId = 'test-client';
      const now = Date.now();

      vi.spyOn(Date, 'now').mockReturnValue(now);

      // 最初のリクエスト
      await rateLimiter.checkLimit(clientId);

      // 5秒後にもう1回
      vi.spyOn(Date, 'now').mockReturnValue(now + 5000);
      await rateLimiter.checkLimit(clientId);

      // リセット時刻は最初のリクエスト時刻+60秒
      const resetTime = rateLimiter.getResetTime(clientId);
      expect(resetTime).toBe(now + 60000);
    });

    it('期限切れのタイムスタンプがクリーンアップされた後の正確なresetTimeを返す', async () => {
      const clientId = 'test-client';
      const now = Date.now();

      vi.spyOn(Date, 'now').mockReturnValue(now);

      // 最初のリクエスト
      await rateLimiter.checkLimit(clientId);

      // 30秒後に2回目のリクエスト
      vi.spyOn(Date, 'now').mockReturnValue(now + 30000);
      await rateLimiter.checkLimit(clientId);

      // 70秒後（最初のリクエストから70秒経過、ウィンドウ外に）
      vi.spyOn(Date, 'now').mockReturnValue(now + 70000);

      // getResetTimeを呼ぶと、期限切れのタイムスタンプがクリーンアップされる
      const resetTime = rateLimiter.getResetTime(clientId);

      // 最初のタイムスタンプ(now)は削除され、2回目のタイムスタンプ(now+30000)が基準になる
      expect(resetTime).toBe(now + 30000 + 60000); // now + 90000
    });

    it('すべてのタイムスタンプが期限切れの場合、現在時刻+ウィンドウ期間を返す', async () => {
      const clientId = 'test-client';
      const now = Date.now();

      vi.spyOn(Date, 'now').mockReturnValue(now);

      // リクエストを記録
      await rateLimiter.checkLimit(clientId);

      // 70秒後（ウィンドウ期間外）
      vi.spyOn(Date, 'now').mockReturnValue(now + 70000);

      // すべてのタイムスタンプが削除され、新規扱いになる
      const resetTime = rateLimiter.getResetTime(clientId);
      expect(resetTime).toBe(now + 70000 + 60000);
    });

    it('複数のリクエストがあり、一部が期限切れの場合、正しくクリーンアップされる', async () => {
      const clientId = 'test-client';
      const now = Date.now();

      vi.spyOn(Date, 'now').mockReturnValue(now);

      // 時刻 now: 3回リクエスト
      for (let i = 0; i < 3; i++) {
        await rateLimiter.checkLimit(clientId);
      }

      // 時刻 now + 40秒: さらに2回リクエスト
      vi.spyOn(Date, 'now').mockReturnValue(now + 40000);
      for (let i = 0; i < 2; i++) {
        await rateLimiter.checkLimit(clientId);
      }

      // 時刻 now + 70秒: 最初の3回は期限切れ（60秒経過）
      vi.spyOn(Date, 'now').mockReturnValue(now + 70000);

      // resetTimeは残っている最も古いタイムスタンプ(now + 40000) + 60000
      const resetTime = rateLimiter.getResetTime(clientId);
      expect(resetTime).toBe(now + 40000 + 60000); // now + 100000
    });
  });

  describe('getRemaining - 残りリクエスト数', () => {
    it('新規クライアントは最大リクエスト数が残っている', () => {
      const clientId = 'new-client';
      const remaining = rateLimiter.getRemaining(clientId);
      expect(remaining).toBe(10);
    });

    it('リクエスト後は残り数が減少する', async () => {
      const clientId = 'test-client';

      await rateLimiter.checkLimit(clientId);
      expect(rateLimiter.getRemaining(clientId)).toBe(9);

      await rateLimiter.checkLimit(clientId);
      expect(rateLimiter.getRemaining(clientId)).toBe(8);
    });

    it('期限切れのタイムスタンプをクリーンアップして正確な残り数を返す', async () => {
      const clientId = 'test-client';
      const now = Date.now();

      vi.spyOn(Date, 'now').mockReturnValue(now);

      // 5回リクエスト
      for (let i = 0; i < 5; i++) {
        await rateLimiter.checkLimit(clientId);
      }

      expect(rateLimiter.getRemaining(clientId)).toBe(5);

      // 70秒後（すべてウィンドウ外に）
      vi.spyOn(Date, 'now').mockReturnValue(now + 70000);

      // 期限切れがクリーンアップされ、最大数に戻る
      expect(rateLimiter.getRemaining(clientId)).toBe(10);
    });
  });

  describe('基本的な動作確認', () => {
    it('制限内のリクエストは許可される', async () => {
      const clientId = 'test-client';

      for (let i = 0; i < 10; i++) {
        const allowed = await rateLimiter.checkLimit(clientId);
        expect(allowed).toBe(true);
      }
    });

    it('制限を超えるリクエストは拒否される', async () => {
      const clientId = 'test-client';

      // 10回リクエスト
      for (let i = 0; i < 10; i++) {
        await rateLimiter.checkLimit(clientId);
      }

      // 11回目は拒否される
      const allowed = await rateLimiter.checkLimit(clientId);
      expect(allowed).toBe(false);
    });

    it('reset でクライアントの制限がリセットされる', async () => {
      const clientId = 'test-client';

      // 10回リクエスト（制限に達する）
      for (let i = 0; i < 10; i++) {
        await rateLimiter.checkLimit(clientId);
      }

      expect(await rateLimiter.checkLimit(clientId)).toBe(false);

      // リセット
      rateLimiter.reset(clientId);

      // 再び許可される
      const allowed = await rateLimiter.checkLimit(clientId);
      expect(allowed).toBe(true);
      expect(rateLimiter.getRemaining(clientId)).toBe(9);
    });
  });
});
