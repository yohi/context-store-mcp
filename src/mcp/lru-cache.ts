/**
 * LRU Cache for Contexts
 * コンテキストのためのLRU（Least Recently Used）キャッシュ実装
 *
 * このキャッシュはメモリ効率的に動作し、最も使用されていないエントリーを自動的に退避させます。
 */

/**
 * 双方向連結リストのノード
 */
interface ListNode<T> {
  key: string;
  value: T;
  timestamp: number;
  accessCount: number;
  prev: ListNode<T> | null;
  next: ListNode<T> | null;
}

/**
 * LRUキャッシュ設定
 */
export interface LRUCacheConfig<T = any> {
  maxSize: number;
  maxAge?: number; // エントリーの最大有効期限（ミリ秒）
  onEvict?: (key: string, value: T) => void; // 退避時のコールバック
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

  private readonly cache: Map<string, ListNode<T>> = new Map();
  private head: ListNode<T> | null = null; // 最も最近使用されたノード
  private tail: ListNode<T> | null = null; // 最も使用されていないノード

  /**
   * コンストラクタ
   *
   * @param config キャッシュ設定
   */
  constructor(config: LRUCacheConfig<T>) {
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
    const node = this.cache.get(key);

    if (!node) {
      return undefined;
    }

    // 有効期限チェック
    if (this.maxAge && Date.now() - node.timestamp > this.maxAge) {
      this.delete(key);
      return undefined;
    }

    // ノードを先頭に移動（最近使用されたことを示す）- O(1)
    this.moveToHead(node);

    // アクセス統計を更新
    node.accessCount++;
    node.timestamp = Date.now();

    return node.value;
  }

  /**
   * キャッシュにエントリーを設定
   *
   * @param key キー
   * @param value 値
   */
  set(key: string, value: T): void {
    // 既存ノードがある場合は更新
    const existingNode = this.cache.get(key);
    if (existingNode) {
      existingNode.value = value;
      existingNode.timestamp = Date.now();
      this.moveToHead(existingNode); // O(1)
      return;
    }

    // 新規ノードを追加前に容量チェック
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    // 新規ノードを作成して追加
    const newNode: ListNode<T> = {
      key,
      value,
      timestamp: Date.now(),
      accessCount: 0,
      prev: null,
      next: null,
    };

    this.cache.set(key, newNode);
    this.addToHead(newNode); // O(1)
  }

  /**
   * キャッシュからエントリーを削除
   *
   * @param key キー
   * @returns 削除に成功した場合true
   */
  delete(key: string): boolean {
    const node = this.cache.get(key);
    if (!node) {
      return false;
    }

    // 削除前にコールバックを実行
    if (this.onEvict) {
      this.onEvict(key, node.value);
    }

    // リストからノードを削除 - O(1)
    this.removeNode(node);

    // キャッシュから削除
    this.cache.delete(key);

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
    // 全ノードに対してコールバックを実行
    if (this.onEvict) {
      for (const [key, node] of this.cache.entries()) {
        this.onEvict(key, node.value);
      }
    }

    this.cache.clear();
    this.head = null;
    this.tail = null;
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
    return Array.from(this.cache.values()).map((node) => node.value);
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
    const nodes = Array.from(this.cache.values());
    const totalAccessCount = nodes.reduce(
      (sum, node) => sum + node.accessCount,
      0
    );

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: 0, // ヒット率は別途記録が必要
      avgAccessCount: nodes.length > 0 ? totalAccessCount / nodes.length : 0,
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
    const keysToDelete: string[] = [];

    // 削除対象のキーを収集
    for (const [key, node] of this.cache.entries()) {
      if (now - node.timestamp > this.maxAge) {
        keysToDelete.push(key);
      }
    }

    // イテレーション完了後に削除を実行
    for (const key of keysToDelete) {
      this.delete(key);
      purgedCount++;
    }

    return purgedCount;
  }

  /**
   * LRUアルゴリズムで最も使用されていないエントリーを退避 - O(1)
   */
  private evictLRU(): void {
    if (!this.tail) {
      return;
    }

    // 最も使用されていないノード（tail）を削除
    const lruKey = this.tail.key;
    this.delete(lruKey);
  }

  /**
   * ノードをリストから削除（O(1)）
   *
   * @param node 削除するノード
   */
  private removeNode(node: ListNode<T>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.tail = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.head = node.prev;
    }

    node.prev = null;
    node.next = null;
  }

  /**
   * ノードをリストの先頭に追加（O(1)）
   *
   * @param node 追加するノード
   */
  private addToHead(node: ListNode<T>): void {
    node.prev = this.head;
    node.next = null;

    if (this.head) {
      this.head.next = node;
    }
    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  /**
   * ノードを先頭に移動（O(1)）
   *
   * @param node 移動するノード
   */
  private moveToHead(node: ListNode<T>): void {
    this.removeNode(node);
    this.addToHead(node);
  }
}
