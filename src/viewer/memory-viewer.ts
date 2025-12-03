/**
 * Memory Viewer
 * 
 * Liteモード用のシンプルなWeb Viewer
 * 要件9: 個人ユーザーとして、シンプルなインターフェースを通じて保存された記憶を閲覧したい
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import type { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  ViewerConfig,
  MemoryDisplay,
  SearchRequest,
  SearchResponse,
  MemoriesRequest,
  MemoriesResponse,
} from './types.js';
import { timingSafeEqual } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Memory Viewer クラス
 * 
 * PostgreSQLデータを閲覧するためのシンプルなWebインターフェース
 */
export class MemoryViewer {
  private app: Express;
  private pool: Pool;
  private config: ViewerConfig;
  private server: any;

  constructor(config: ViewerConfig) {
    this.config = config;
    this.pool = config.pool;
    this.app = express();

    // ミドルウェアの設定
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // 認証ミドルウェアの設定
    if (config.authEnabled) {
      this.setupAuth();
    }

    // ルートの設定
    this.setupRoutes();
  }

  /**
   * 認証ミドルウェアの設定
   * 要件9.5: WHEN ビューアがアクセスされる THEN システムはユーザーデータを保護するために認証を要求しなければならない
   */
  private setupAuth(): void {
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      // ヘルスチェックエンドポイントは認証不要
      if (req.path === '/health') {
        return next();
      }

      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'Unauthorized: No authorization header' });
      }

      const token = authHeader.split(' ')[1];
      const expectedToken = this.config.authToken || '';

      if (!token ||
        token.length !== expectedToken.length ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken))) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
      }

      next();
    });
  }

  /**
   * ルートの設定
   */
  private setupRoutes(): void {
    // ヘルスチェック
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // ルートページ - シンプルなHTML UI
    this.app.get('/', (_req: Request, res: Response) => {
      const html = readFileSync(join(__dirname, 'index.html'), 'utf-8');
      res.send(html);
    });

    // JavaScriptファイル
    this.app.get('/viewer.js', (_req: Request, res: Response) => {
      const js = readFileSync(join(__dirname, 'viewer.js'), 'utf-8');
      res.type('application/javascript').send(js);
    });

    // 記憶一覧エンドポイント（タスク12.3で実装）
    this.app.get('/memories', async (req: Request, res: Response) => {
      try {
        const limit = parseInt((req.query['limit'] as string) || '50', 10);
        const offset = parseInt((req.query['offset'] as string) || '0', 10);

        if (!Number.isFinite(limit) || limit < 1) {
          res.status(400).json({ error: 'Invalid limit parameter' });
          return;
        }
        if (!Number.isFinite(offset) || offset < 0) {
          res.status(400).json({ error: 'Invalid offset parameter' });
          return;
        }

        const response = await this.fetchMemories({ limit, offset });
        res.json(response);
      } catch (error) {
        console.error('Error fetching memories:', error);
        res.status(500).json({ error: 'Failed to fetch memories' });
      }
    });

    // 検索エンドポイント（タスク12.5で実装）

    this.app.post('/search', async (req: Request, res: Response) => {
      try {
        const { query, searchType, limit: rawLimit, offset: rawOffset } = req.body;

        if (!query || typeof query !== 'string' || query.trim().length === 0) {
          res.status(400).json({ error: 'Query cannot be empty' });
          return;
        }

        let limit = 20;
        if (rawLimit !== undefined) {
          const parsedLimit = parseInt(rawLimit, 10);
          if (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
            res.status(400).json({ error: 'Invalid limit parameter' });
            return;
          }
          limit = parsedLimit;
        }

        let offset = 0;
        if (rawOffset !== undefined) {
          const parsedOffset = parseInt(rawOffset, 10);
          if (!Number.isFinite(parsedOffset) || parsedOffset < 0) {
            res.status(400).json({ error: 'Invalid offset parameter' });
            return;
          }
          offset = parsedOffset;
        }

        const response = await this.search({ query, searchType, limit, offset });
        res.json(response);
      } catch (error) {
        console.error('Error searching memories:', error);
        res.status(500).json({ error: 'Failed to search memories' });
      }
    });
  }

  /**
   * 記憶一覧を取得
   * 要件9.2: WHEN ビューアが記憶を表示する THEN システムはタイムスタンプ付きで時系列順に表示しなければならない
   */
  async fetchMemories(request: MemoriesRequest): Promise<MemoriesResponse> {
    const limit = Math.min(request.limit ?? 50, 100);
    const offset = request.offset || 0;

    // 総数を取得
    const countResult = await this.pool.query(
      'SELECT COUNT(*) FROM memories WHERE is_deleted = false'
    );
    const total = parseInt(countResult.rows[0]?.count || '0');

    // 記憶を時系列順（新しい順）で取得
    const result = await this.pool.query(
      `SELECT id, content, metadata, created_at, updated_at
       FROM memories
       WHERE is_deleted = false
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const memories: MemoryDisplay[] = result.rows.map((row) => ({
      id: row.id,
      content: row.content,
      metadata: typeof row.metadata === 'string' ? this.safeJsonParse(row.metadata) : row.metadata,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));

    return {
      memories,
      total,
      limit,
      offset,
    };
  }

  /**
   * 検索を実行
   * 要件9.3: WHEN ビューアが検索を提供する THEN システムはテキストベースとベクトル類似性検索の両方をサポートしなければならない
   * 要件9.4: WHEN 検索結果が表示される THEN システムは一致するコンテンツをハイライトし、関連性スコアを表示しなければならない
   */
  async search(request: SearchRequest): Promise<SearchResponse> {
    const { query, searchType } = request;
    const limit = Math.min(request.limit ?? 20, 100);
    const offset = request.offset || 0;

    if (!query || query.trim().length === 0) {
      throw new Error('Query cannot be empty');
    }

    let searchResult: { results: MemoryDisplay[], total: number };

    if (searchType === 'vector') {
      // ベクトル検索（簡易実装 - 実際のベクトル検索は別途実装が必要）
      searchResult = await this.vectorSearch(query, limit, offset);
    } else {
      // テキスト検索
      searchResult = await this.textSearch(query, limit, offset);
    }

    return {
      results: searchResult.results,
      total: searchResult.total,
      query,
      searchType,
    };
  }

  /**
   * テキスト検索
   */
  private async textSearch(query: string, limit: number, offset: number): Promise<{ results: MemoryDisplay[], total: number }> {
    // 総数を取得
    const countResult = await this.pool.query(
      `SELECT COUNT(*) 
       FROM memories 
       WHERE is_deleted = false 
         AND to_tsvector('english', content) @@ plainto_tsquery('english', $1)`,
      [query]
    );
    const total = parseInt(countResult.rows[0]?.count || '0', 10);

    const result = await this.pool.query(
      `SELECT id, content, metadata, created_at, updated_at,
              ts_rank(to_tsvector('english', content), plainto_tsquery('english', $1)) as rank
       FROM memories
       WHERE is_deleted = false
         AND to_tsvector('english', content) @@ plainto_tsquery('english', $1)
       ORDER BY rank DESC, created_at DESC
       LIMIT $2 OFFSET $3`,
      [query, limit, offset]
    );

    const results = result.rows.map((row) => ({
      id: row.id,
      content: row.content,
      metadata: typeof row.metadata === 'string' ? this.safeJsonParse(row.metadata) : row.metadata,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      similarity: parseFloat(row.rank),
    }));

    return { results, total };
  }

  /**
   * ベクトル検索（簡易実装）
   */
  private async vectorSearch(query: string, limit: number, offset: number): Promise<{ results: MemoryDisplay[], total: number }> {
    // 注: 実際のベクトル検索には埋め込み生成が必要
    // ここでは簡易的にテキスト検索にフォールバック
    console.warn('Vector search not fully implemented, falling back to text search');
    return this.textSearch(query, limit, offset);
  }

  /**
   * サーバーを起動
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.config.port, () => {
        console.log(`Memory Viewer started on port ${this.config.port}`);
        resolve();
      });
    });
  }

  /**
   * サーバーを停止
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err: Error | undefined) => {
          if (err) {
            reject(err);
          } else {
            console.log('Memory Viewer stopped');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * JSONを安全にパースするヘルパーメソッド
   */
  private safeJsonParse(value: string): any {
    try {
      return JSON.parse(value);
    } catch (e) {
      console.warn('Failed to parse JSON metadata:', e);
      return null;
    }
  }
}
