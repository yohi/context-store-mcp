# MCPクライアント統合ガイド

このドキュメントでは、Context Store MCPサーバーを様々なMCPクライアントと統合する方法を説明します。

## 📋 目次

- [MCPプロトコル概要](#mcpプロトコル概要)
- [Claude Desktopとの統合](#claude-desktopとの統合)
- [Clineとの統合](#clineとの統合)
- [カスタムクライアントの作成](#カスタムクライアントの作成)
- [トラブルシューティング](#トラブルシューティング)

## MCPプロトコル概要

Context Store MCPサーバーは、[Model Context Protocol (MCP)](https://modelcontextprotocol.io/)標準に準拠したサーバーです。

### 提供機能

このサーバーは以下のMCP機能を提供します：

#### ツール (Tools)

| ツール名 | 説明 | 主要パラメータ |
|---------|------|--------------|
| `store_memory` | 新しい記憶を保存 | `content`, `metadata`, `memoryType` |
| `retrieve_memories` | 記憶を検索・取得 | `query`, `limit`, `filters` |
| `update_memory` | 既存の記憶を更新 | `id`, `content`, `metadata` |
| `delete_memory` | 記憶を削除（ソフト削除） | `id` |
| `get_memory_history` | 記憶のバージョン履歴を取得 | `id` |
| `revert_memory` | 記憶を過去のバージョンに戻す | `id`, `version` |
| `suggest_merges` | 類似記憶のマージ候補を提案 | `threshold` |
| `merge_memories` | 複数の記憶をマージ | `sourceIds`, `targetId` |

#### リソース (Resources)

| リソース名 | 説明 |
|-----------|------|
| `memory://{id}` | 特定の記憶にアクセス |
| `memories://search?query={query}` | 記憶を検索 |

### 記憶タイプ

サーバーは3種類の記憶タイプを自動分類します：

- **エピソード記憶** (`episodic`): 特定の出来事や経験
- **意味記憶** (`semantic`): 一般的な知識や概念
- **手続き記憶** (`procedural`): 手順やプロセス

## Claude Desktopとの統合

### 前提条件

- Claude Desktop アプリがインストールされていること
- Context Store MCPサーバーがローカルで実行されていること

### 設定手順

#### 1. サーバーの起動

```bash
cd /path/to/context-store-mcp
npm run dev
```

#### 2. Claude Desktop設定ファイルの編集

Claude Desktopの設定ファイルを開きます：

**macOS**:
```bash
code ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

**Windows**:
```bash
code %APPDATA%\Claude\claude_desktop_config.json
```

**Linux**:
```bash
code ~/.config/Claude/claude_desktop_config.json
```

#### 3. MCP サーバーの登録

設定ファイルに以下を追加します：

```json
{
  "mcpServers": {
    "context-store": {
      "command": "docker",
      "args": [
        "exec",
        "-i",
        "context-store-app-prod",
        "node",
        "/app/dist/index.js"
      ]
    }
  }
}
```

> [!IMPORTANT]
> この設定は、本番環境のDockerコンテナ（`context-store-app-prod`）に接続します。サーバーが起動していることを確認してください：
> ```bash
> docker-compose -f docker-compose.prod.yml ps
> ```

#### 4. Claude Desktopの再起動

設定を反映するため、Claude Desktopを完全に終了して再起動します。

#### 5. 動作確認

Claude Desktopで以下のように試してみます：

```
記憶を保存してください：「今日は素晴らしい天気だった」
```

Claude が Context Store MCP サーバーの `store_memory` ツールを使用して記憶を保存します。

その後、以下で確認：

```
「天気」に関する記憶を検索してください
```

### 使用例

#### 記憶の保存

```
以下の情報を記憶してください：
- プロジェクト名: Context Store MCP
- 開始日: 2024年1月15日
- 主要技術: TypeScript, PostgreSQL, Neo4j, Redis
```

#### 記憶の検索

```
PostgreSQLに関する記憶を検索してください
```

#### 記憶の更新

```
プロジェクトの開始日を2024年1月10日に更新してください
```

## Clineとの統合

[Cline](https://github.com/cline/cline)は、VS Code拡張機能として動作するAIアシスタントで、MCPサーバーと統合できます。

### 前提条件

- VS Code がインストールされていること
- Cline 拡張機能がインストールされていること

### 設定手順

#### 1. Cline拡張機能のインストール

VS Codeで：
1. 拡張機能パネルを開く（`Ctrl+Shift+X` / `Cmd+Shift+X`）
2. "Cline"を検索
3. インストール

#### 2. MCP サーバーの設定

VS Codeの設定（`settings.json`）に以下を追加：

```json
{
  "cline.mcpServers": {
    "context-store": {
      "command": "node",
      "args": [
        "/path/to/context-store-mcp/dist/index.js"
      ],
      "env": {
        "POSTGRES_HOST": "localhost",
        "POSTGRES_PORT": "5432",
        "POSTGRES_DB": "context_store_dev",
        "POSTGRES_USER": "context_store_user",
        "POSTGRES_PASSWORD": "dev_password_123",
        "NEO4J_URI": "bolt://localhost:7687",
        "NEO4J_USER": "neo4j",
        "NEO4J_PASSWORD": "dev_password_123",
        "REDIS_HOST": "localhost",
        "REDIS_PORT": "6379",
        "REDIS_PASSWORD": "dev_password_123",
        "OPENAI_API_KEY": "your-api-key-here",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

#### 3. VS Codeの再読み込み

`Ctrl+Shift+P` / `Cmd+Shift+P` → "Developer: Reload Window"

#### 4. 動作確認

Clineパネルを開き、Context Store MCPサーバーのツールが利用可能になっていることを確認します。

## カスタムクライアントの作成

独自のMCPクライアントを作成して、Context Store MCPサーバーと統合できます。

### MCP SDKのインストール

```bash
npm install @modelcontextprotocol/sdk
```

### 基本的な接続例

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function main() {
  // サーバープロセスの起動
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/path/to/context-store-mcp/dist/index.js'],
    env: {
      POSTGRES_HOST: 'localhost',
      POSTGRES_PORT: '5432',
      POSTGRES_DB: 'context_store_dev',
      POSTGRES_USER: 'context_store_user',
      POSTGRES_PASSWORD: 'dev_password_123',
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USER: 'neo4j',
      NEO4J_PASSWORD: 'dev_password_123',
      REDIS_HOST: 'localhost',
      REDIS_PORT: '6379',
      REDIS_PASSWORD: 'dev_password_123',
      OPENAI_API_KEY: 'your-api-key-here',
      LOG_LEVEL: 'info',
    },
  });

  // クライアントの作成
  const client = new Client(
    {
      name: 'my-mcp-client',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  );

  // 接続
  await client.connect(transport);

  console.log('Connected to Context Store MCP Server');

  // 利用可能なツールの取得
  const tools = await client.listTools();
  console.log('Available tools:', tools);

  // 記憶の保存
  const storeResult = await client.callTool({
    name: 'store_memory',
    arguments: {
      content: 'これはテスト記憶です',
      metadata: {
        source: 'custom-client',
        tags: ['test'],
      },
    },
  });
  console.log('Store result:', storeResult);

  // 記憶の検索
  const searchResult = await client.callTool({
    name: 'retrieve_memories',
    arguments: {
      query: 'テスト',
      limit: 10,
    },
  });
  console.log('Search result:', searchResult);

  // 切断
  await client.close();
}

main().catch(console.error);
```

### 記憶の保存例

```typescript
async function storeMemory(client: Client, content: string, metadata?: any) {
  const result = await client.callTool({
    name: 'store_memory',
    arguments: {
      content,
      metadata: metadata || {},
      memoryType: 'auto', // 自動分類
    },
  });
  return result;
}

// 使用例
await storeMemory(client, 'TypeScriptは型安全なJavaScriptのスーパーセットです', {
  category: 'programming',
  tags: ['typescript', 'javascript'],
});
```

### 記憶の検索例

```typescript
async function searchMemories(
  client: Client,
  query: string,
  options?: {
    limit?: number;
    filters?: any;
  }
) {
  const result = await client.callTool({
    name: 'retrieve_memories',
    arguments: {
      query,
      limit: options?.limit || 10,
      filters: options?.filters || {},
    },
  });
  return result;
}

// 使用例
const memories = await searchMemories(client, 'TypeScript', {
  limit: 5,
  filters: {
    tags: ['programming'],
  },
});
```

### エラーハンドリング

```typescript
try {
  const result = await client.callTool({
    name: 'store_memory',
    arguments: {
      content: 'テスト記憶',
    },
  });
  console.log('Success:', result);
} catch (error) {
  if (error instanceof Error) {
    console.error('Error:', error.message);
  }
}
```

## トラブルシューティング

### サーバーに接続できない

**症状**: クライアントがサーバーに接続できない

**解決方法**:

1. サーバーが起動しているか確認：
   ```bash
   ps aux | grep "context-store-mcp"
   ```

2. データベースサービスが起動しているか確認：
   ```bash
   docker-compose ps
   ```

3. 環境変数が正しく設定されているか確認

4. ログを確認：
   ```bash
   tail -f logs/context-store-mcp.log
   ```

### ツールが見つからない

**症状**: `Tool not found`エラー

**解決方法**:

1. 利用可能なツール一覧を確認：
   ```typescript
   const tools = await client.listTools();
   console.log(tools);
   ```

2. ツール名のスペルを確認（`store_memory`、`retrieve_memories`等）

3. サーバーのバージョンを確認（古いバージョンでは一部ツールが利用できない可能性）

### 認証エラー

**症状**: データベース接続時の認証エラー

**解決方法**:

1. 環境変数の認証情報を確認
2. `.env.local`の内容と一致しているか確認
3. データベースのパスワードをリセット：
   ```bash
   docker-compose down -v
   docker-compose up -d
   ```

### パフォーマンスの問題

**症状**: 検索が遅い

**解決方法**:

1. 検索結果の制限を設定：
   ```typescript
   await client.callTool({
     name: 'retrieve_memories',
     arguments: {
       query: 'search term',
       limit: 10, // 結果数を制限
     },
   });
   ```

2. フィルターを使用して検索範囲を絞る

3. データベースのインデックスを確認

## 追加リソース

- **[MCP公式ドキュメント](https://modelcontextprotocol.io/)**: MCPプロトコルの詳細
- **[MCP SDK](https://github.com/modelcontextprotocol/sdk)**: SDK のドキュメントとサンプル
- **[LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md)**: ローカル開発ガイド
- **[設計書](.kiro/specs/context-store-mcp/design.md)**: システム設計の詳細

## サポート

問題が解決しない場合：

1. [GitHub Issues](https://github.com/your-org/context-store-mcp/issues)で検索
2. 新しいIssueを作成（エラーログとクライアント情報を含める）

---

**Happy Integrating! 🔌**
