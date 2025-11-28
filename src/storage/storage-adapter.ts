/**
 * StorageAdapter インターフェース
 * ストレージ実装（PostgreSQL, Neo4jなど）の契約を定義する
 */

import type { Memory, MemoryId, SearchParams } from '../memory/types.js';

/**
 * 共通ストレージアダプターインターフェース
 */
export interface StorageAdapter {
  /** 新しい記憶を保存する */
  storeMemory(memory: Memory): Promise<MemoryId>;

  /** IDで記憶を取得する */
  getMemory(id: MemoryId): Promise<Memory | null>;

  /** 既存の記憶を更新する */
  updateMemory(id: MemoryId, updates: Partial<Memory>): Promise<boolean>;

  /** 記憶を削除する */
  deleteMemory(id: MemoryId): Promise<boolean>;

  /** パラメータに基づいて記憶を検索する */
  searchMemories(params: SearchParams): Promise<Memory[]>;

  /** すべての記憶IDを取得する（整合性調整用） */
  getAllMemoryIds(): Promise<MemoryId[]>;
}
