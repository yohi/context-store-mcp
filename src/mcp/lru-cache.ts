/**
 * LRU Cache for Contexts
 * コンテキストのためのLRU（Least Recently Used）キャッシュ実装
 *
 * このキャッシュはメモリ効率的に動作し、最も使用されていないエントリーを自動的に退避させます。
 */

/**
 * キャッシュエントリー
 */
interface CacheEntry<T> {
  key: string;
  value: T;
  timestamp: number;
  accessCount: number;
}

/**
 * LRUキャッシュ設定
 */
export interface LRUCacheConfig {
  maxSize: number;
  maxAge?: number; // エントリーの最大有効期限（ミリ秒）
  onEvict?: (key: string, value: any) => void; // 退避時のコールバック
}

/**
 * LRUキャッシュクラス
 *
 * 特徴:
 * - 固定サイズのキャッシュで、容量を超えると最も使用されていないエントリーを退避
 * - アクセス時にタイムスタンプとアクセス回数を更新
 * - オプションで有効期限切れのエントリーを自動削除
 * - O(1)の読み取り・書き込み性能
 */
export class LRUCache<T = any> {
  private readonly maxSize: number;
  private readonly maxAge?: number;
  private readonly onEvict?: (key: string, value: T) => void;

  private readonly cache: Map<string, CacheEntry<T>> = new Map();
  private readonly accessOrder: string[] = []; // アクセス順序を追跡（古い順）

  /**
   * コンストラクタ
   *
   * @param config キャッシュ設定
   */
  constructor(config: LRUCacheConfig) {
    if (config.maxSize <= 0) {
      throw new Error('maxSize must be greater than 0');
    }

    this.maxSize = config.maxSize;
    this.maxAge = config.maxAge;
    this.onEvict = config.onEvict;
  }

  /**
   * キャッシュからエントリーを取得
   *
   * @param key キー
   * @returns 値（存在しない場合はundefined）
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    // 有効期限チェック
    if (this.maxAge && Date.now() - entry.timestamp > this.maxAge) {
      this.delete(key);
      return undefined;
    }

    // アクセス順序を更新
    this.updateAccessOrder(key);

    // アクセス統計を更新
    entry.accessCount++;
    entry.timestamp = Date.now();

    return entry.value;
  }

  /**
   * キャッシュにエントリーを設定
   *
   * @param key キー
   * @param value 値
   */
  set(key: string, value: T): void {
    // 既存エントリーがある場合は更新
    const existingEntry = this.cache.get(key);
    if (existingEntry) {
      existingEntry.value = value;
      existingEntry.timestamp = Date.now();
      this.updateAccessOrder(key);
      return;
    }

    // 新規エントリーを追加前に容量チェック
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    // 新規エントリーを追加
    const entry: CacheEntry<T> = {
      key,
      value,
      timestamp: Date.now(),
      accessCount: 0,
    };

    this.cache.set(key, entry);
    this.accessOrder.push(key);
  }

  /**
   * キャッシュからエントリーを削除
   *
   * @param key キー
   * @returns 削除に成功した場合true
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    // 削除前にコールバックを実行
    if (this.onEvict) {
      this.onEvict(key, entry.value);
    }

    // キャッシュとアクセス順序から削除
    this.cache.delete(key);
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }

    return true;
  }

  /**
   * キャッシュに指定されたキーが存在するかチェック
   *
   * @param key キー
   * @returns 存在する場合true
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    // 有効期限チェック
    if (this.maxAge && Date.now() - entry.timestamp > this.maxAge) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * キャッシュのサイズを取得
   *
   * @returns キャッシュ内のエントリー数
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * キャッシュをクリア
   */
  clear(): void {
    // 全エントリーに対してコールバックを実行
    if (this.onEvict) {
      for (const [key, entry] of this.cache.entries()) {
        this.onEvict(key, entry.value);
      }
    }

    this.cache.clear();
    this.accessOrder.length = 0;
  }

  /**
   * 全キーを取得
   *
   * @returns キーの配列
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * 全値を取得
   *
   * @returns 値の配列
   */
  values(): T[] {
    return Array.from(this.cache.values()).map((entry) => entry.value);
  }

  /**
   * キャッシュ統計情報を取得
   *
   * @returns 統計情報
   */
  getStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    avgAccessCount: number;
  } {
    const entries = Array.from(this.cache.values());
    const totalAccessCount = entries.reduce(
      (sum, entry) => sum + entry.accessCount,
      0
    );

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: 0, // ヒット率は別途記録が必要
      avgAccessCount:
        entries.length > 0 ? totalAccessCount / entries.length : 0,
    };
  }

  /**
   * 期限切れエントリーをすべて削除
   *
   * @returns 削除されたエントリー数
   */
  purgeExpired(): number {
    if (!this.maxAge) {
      return 0;
    }

    const now = Date.now();
    let purgedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.maxAge) {
        this.delete(key);
        purgedCount++;
      }
    }

    return purgedCount;
  }

  /**
   * LRUアルゴリズムで最も使用されていないエントリーを退避
   */
  private evictLRU(): void {
    if (this.accessOrder.length === 0) {
      return;
    }

    // 最も古いエントリー（アクセス順序の先頭）を削除
    const lruKey = this.accessOrder[0];
    this.delete(lruKey);
  }

  /**
   * アクセス順序を更新
   *
   * @param key キー
   */
  private updateAccessOrder(key: string): void {
    // 現在の位置を削除
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }

    // 最後尾に追加（最近アクセスされたエントリー）
    this.accessOrder.push(key);
  }
}
