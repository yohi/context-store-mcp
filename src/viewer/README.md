# Memory Viewer

Liteモード用のシンプルなWeb Viewer。PostgreSQLに保存された記憶を閲覧・検索するためのWebインターフェースを提供します。

## 機能

- **記憶一覧表示**: タイムスタンプ付きで時系列順（新しい順）に記憶を表示
- **テキスト検索**: PostgreSQLの全文検索機能を使用したテキスト検索
- **ベクトル検索**: ベクトル類似性検索（簡易実装）
- **ハイライト**: 検索結果のマッチ箇所をハイライト表示
- **関連性スコア**: 検索結果の関連性スコアを表示
- **認証**: トークンベースの認証機能
- **ページネーション**: 大量の記憶を効率的に閲覧

## 使用方法

### 基本的な使用例

```typescript
import { Pool } from 'pg';
import { MemoryViewer } from './viewer/index.js';

// PostgreSQL接続プールの作成
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'postgres',
  database: 'context_store',
});

// Viewer設定
const config = {
  port: 3001,
  authEnabled: true,
  authToken: 'your-secret-token',
  pool,
};

// Viewerの起動
const viewer = new MemoryViewer(config);
await viewer.start();

console.log('Memory Viewer is running on http://localhost:3001');
```

### 環境変数

以下の環境変数で設定をカスタマイズできます：

```bash
# PostgreSQL接続設定
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=context_store

# Viewer設定
VIEWER_PORT=3001
VIEWER_AUTH_ENABLED=true
VIEWER_AUTH_TOKEN=your-secret-token
```

### 認証

認証が有効な場合、すべてのリクエストに`Authorization`ヘッダーが必要です：

```bash
curl -H "Authorization: Bearer your-secret-token" http://localhost:3001/memories
```

ブラウザからアクセスする場合は、ローカルストレージに認証トークンを保存します：

```javascript
localStorage.setItem('authToken', 'your-secret-token');
```

## API エンドポイント

### GET /health

ヘルスチェックエンドポイント（認証不要）

**レスポンス:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### GET /

Web UIのHTMLページを返します。

### GET /memories

記憶一覧を取得します。

**クエリパラメータ:**
- `limit`: 取得する記憶の最大数（デフォルト: 50、最大: 100）
- `offset`: オフセット（ページネーション用、デフォルト: 0）

**レスポンス:**
```json
{
  "memories": [
    {
      "id": "uuid",
      "content": "記憶の内容",
      "metadata": {
        "tags": ["tag1", "tag2"],
        "source": "claude-desktop"
      },
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "total": 100,
  "limit": 50,
  "offset": 0
}
```

### POST /search

記憶を検索します。

**リクエストボディ:**
```json
{
  "query": "検索クエリ",
  "searchType": "text",
  "limit": 20,
  "offset": 0
}
```

**レスポンス:**
```json
{
  "results": [
    {
      "id": "uuid",
      "content": "記憶の内容",
      "metadata": {},
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z",
      "similarity": 0.85
    }
  ],
  "total": 10,
  "query": "検索クエリ",
  "searchType": "text"
}
```

## 要件との対応

このWeb Viewerは以下の要件を満たしています：

- **要件9.1**: PostgreSQLデータ用のWebベースビューアを提供
- **要件9.2**: タイムスタンプ付きで時系列順に記憶を表示
- **要件9.3**: テキストベースとベクトル類似性検索の両方をサポート
- **要件9.4**: 一致するコンテンツをハイライトし、関連性スコアを表示
- **要件9.5**: 認証を要求してユーザーデータを保護

## 制限事項

- ベクトル検索は簡易実装であり、実際の埋め込み生成は行っていません
- 現在はテキスト検索にフォールバックします
- 完全なベクトル検索を実装するには、埋め込みサービスとの統合が必要です

## 開発

### テストの実行

```bash
npm test src/viewer
```

### ビルド

```bash
npm run build
```

### 開発モードで実行

```bash
npm run dev
```

## ライセンス

MIT
