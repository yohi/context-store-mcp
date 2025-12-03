/**
 * Web Viewer Types
 * 
 * Liteモード用のWeb Viewerの型定義
 */

/**
 * Viewer設定
 */
export interface ViewerConfig {
  /** ポート番号 */
  port: number;
  /** 認証を有効にするか */
  authEnabled: boolean;
  /** 認証トークン */
  authToken?: string | undefined;
  /** PostgreSQL接続プール */
  pool: any; // Pool型は実装時にimport
}

/**
 * 記憶表示用の型
 */
export interface MemoryDisplay {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  similarity?: number;
}

/**
 * 検索リクエスト
 */
export interface SearchRequest {
  query: string;
  searchType: 'text' | 'vector';
  limit?: number;
  offset?: number;
}

/**
 * 検索結果
 */
export interface SearchResponse {
  results: MemoryDisplay[];
  total: number;
  query: string;
  searchType: string;
}

/**
 * 記憶一覧リクエスト
 */
export interface MemoriesRequest {
  limit?: number;
  offset?: number;
}

/**
 * 記憶一覧レスポンス
 */
export interface MemoriesResponse {
  memories: MemoryDisplay[];
  total: number;
  limit: number;
  offset: number;
}
