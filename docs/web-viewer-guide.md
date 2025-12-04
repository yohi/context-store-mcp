# Web Viewer ガイド

Context Store MCPのLiteモード用Web Viewerの使用ガイドです。

## 概要

Web Viewerは、PostgreSQLに保存された記憶を閲覧・検索するためのシンプルなWebインターフェースです。Liteモードで動作し、Neo4jやRedisなしで使用できます。

## 機能

### 実装済み機能

- ✅ **記憶一覧表示**: タイムスタンプ付きで時系列順（新しい順）に記憶を表示
- ✅ **ページネーション**: 大量の記憶を効率的に閲覧
- ✅ **テキスト検索**: PostgreSQLの全文検索機能を使用
- ✅ **検索結果のハイライト**: マッチ箇所を視覚的に表示
- ✅ **関連性スコア表示**: 検索結果の関連性を数値で表示
- ✅ **トークンベース認証**: セキュアなアクセス制御
- ✅ **レスポンシブUI**: モダンでシンプルなデザイン

### 制限事項

- ベクトル検索は簡易実装（テキスト検索にフォールバック）
- 完全なベクトル検索には埋め込みサービスとの統合が必要

## クイックスタート

### 1. 環境変数の設定

`.env`ファイルに以下を追加：

```bash
# PostgreSQL設定
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=context_store

# Web Viewer設定
VIEWER_PORT=3001
VIEWER_AUTH_ENABLED=true
VIEWER_AUTH_TOKEN=your-secret-token-here
```

### 2. Web Viewerの起動

```bash
# ビルド
npm run build

# 起動
node dist/viewer/example.js
```

または、開発モードで：

```bash
npm run dev
```

### 3. ブラウザでアクセス

```text
http://localhost:3001
```

認証が有効な場合、ブラウザのコンソールで以下を実行：

```javascript
localStorage.setItem('authToken', 'your-secret-token-here');
```

その後、ページをリロードしてください。

> **注意**: 本番環境では、セキュリティ上の理由からトークンはコンソールに表示されません。環境変数 `VIEWER_AUTH_TOKEN` の値を確認してください。また、トークンをログに出力しないように注意してください。

## 使用方法

### 記憶の閲覧

1. Web Viewerにアクセスすると、最新の記憶が時系列順に表示されます
2. 「前へ」「次へ」ボタンでページを移動できます
3. 各記憶には以下の情報が表示されます：
   - ID（最初の8文字）
   - 作成日時
   - 記憶の内容
   - タグ（メタデータから）

### 検索

1. 検索ボックスにキーワードを入力
2. 検索タイプを選択：
   - **テキスト検索**: PostgreSQLの全文検索
   - **ベクトル検索**: 意味的類似性検索（簡易実装）
3. 「検索」ボタンをクリックまたはEnterキーを押す
4. 検索結果には関連性スコアが表示されます
5. マッチした箇所がハイライトされます

### すべて表示

「すべて表示」ボタンをクリックすると、検索をクリアして全記憶を表示します。

## API リファレンス

### GET /health

ヘルスチェックエンドポイント（認証不要）

```bash
curl http://localhost:3001/health
```

**レスポンス:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### GET /memories

記憶一覧を取得

```bash
curl -H "Authorization: Bearer your-token" \
  "http://localhost:3001/memories?limit=20&offset=0"
```

**パラメータ:**
- `limit`: 取得数（デフォルト: 50、最大: 100）
- `offset`: オフセット（デフォルト: 0）

**レスポンス:**
```json
{
  "memories": [
    {
      "id": "uuid",
      "content": "記憶の内容",
      "metadata": {
        "tags": ["tag1"],
        "source": "claude-desktop"
      },
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "total": 100,
  "limit": 20,
  "offset": 0
}
```

### POST /search

記憶を検索

```bash
curl -X POST \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "検索キーワード",
    "searchType": "text",
    "limit": 20,
    "offset": 0
  }' \
  http://localhost:3001/search
```

**リクエストボディ:**
```json
{
  "query": "検索キーワード",
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
  "query": "検索キーワード",
  "searchType": "text"
}
```

## プログラムからの使用

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

// グレースフルシャットダウン
process.on('SIGINT', async () => {
  await viewer.stop();
  await pool.end();
  process.exit(0);
});
```

### 既存のMCPサーバーと統合

```typescript
import { MemoryViewer } from './viewer/index.js';

// MCPサーバーの初期化後
const viewer = new MemoryViewer({
  port: 3001,
  authEnabled: true,
  authToken: process.env['VIEWER_AUTH_TOKEN'],
  pool: postgresPool, // 既存のPostgreSQLプール
});

await viewer.start();
```

## セキュリティ

### 認証の有効化

認証を有効にすることを強く推奨します：

```bash
VIEWER_AUTH_ENABLED=true
VIEWER_AUTH_TOKEN=generate-a-strong-random-token
```

トークンの生成例：

```bash
# Node.jsで生成
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# OpenSSLで生成
openssl rand -hex 32
```

### HTTPS の使用

本番環境では、リバースプロキシ（Nginx、Caddy等）を使用してHTTPSを有効にしてください。

```nginx
server {
    listen 443 ssl;
    server_name viewer.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## トラブルシューティング

### 認証エラー

**症状**: 401 Unauthorized エラー

**解決策**:
1. 環境変数`VIEWER_AUTH_TOKEN`が設定されているか確認
2. ブラウザのローカルストレージにトークンが保存されているか確認
3. トークンが一致しているか確認

### 記憶が表示されない

**症状**: 記憶一覧が空

**解決策**:
1. PostgreSQLに接続できているか確認
2. `memories`テーブルにデータが存在するか確認
3. `is_deleted = false`の記憶が存在するか確認

```sql
SELECT COUNT(*) FROM memories WHERE is_deleted = false;
```

### 検索が動作しない

**症状**: 検索結果が返らない

**解決策**:
1. PostgreSQLの全文検索インデックスが作成されているか確認
2. 検索クエリが適切か確認
3. ログでエラーメッセージを確認

## 要件との対応

このWeb Viewerは以下の要件を満たしています：

| 要件 | 説明 | 実装状況 |
|------|------|----------|
| 9.1 | PostgreSQLデータ用のWebベースビューアを提供 | ✅ 完了 |
| 9.2 | タイムスタンプ付きで時系列順に記憶を表示 | ✅ 完了 |
| 9.3 | テキストベースとベクトル類似性検索の両方をサポート | ✅ 完了 |
| 9.4 | 一致するコンテンツをハイライトし、関連性スコアを表示 | ✅ 完了 |
| 9.5 | 認証を要求してユーザーデータを保護 | ✅ 完了 |

## 今後の改善

- [ ] 完全なベクトル検索の実装（埋め込みサービスとの統合）
- [ ] フィルタリング機能（タグ、ソース、日付範囲）
- [ ] エクスポート機能（JSON、CSV）
- [ ] 記憶の編集・削除機能
- [ ] ダークモード対応
- [ ] 多言語対応

## 参考資料

- [Memory Viewer README](../src/viewer/README.md)
- [Lite Mode Design](../.kiro/specs/lite-mode/design.md)
- [Lite Mode Requirements](../.kiro/specs/lite-mode/requirements.md)
