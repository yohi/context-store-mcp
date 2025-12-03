# Context Store MCP

AIエージェント向けMCPベース長期記憶システム

[![CI/CD](https://github.com/your-org/context-store-mcp/workflows/CI/CD%20Pipeline/badge.svg)](https://github.com/your-org/context-store-mcp/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 概要

Context Store MCPは、AIエージェントに永続的な記憶能力を付与するModel Context Protocol (MCP)サーバーです。セッションを越えて情報を保持し、文脈に応じた知的な検索を実現します。

## 特徴

- **永続的記憶**: セッション間での情報の保存と取得
- **多層的記憶タイプ**: エピソード記憶、意味記憶、手続き記憶の自動分類
- **ハイブリッド検索**: ベクトル類似性検索とグラフトラバーサルの統合
- **MCP標準準拠**: 様々なAIエージェントから統一的に利用可能
- **高パフォーマンス**: PostgreSQL + pgvector、Neo4j、Redisによる最適化
- **セキュリティ**: RBAC、暗号化、GDPR準拠の削除機能
- **本番対応**: Docker化、CI/CD、監視、バックアップ

## 🚀 クイックスタート

### Lite Mode（軽量モード）🌟

個人用PCで最小限のリソースで実行したい場合は、Lite Modeをお勧めします。PostgreSQLのみで動作し、Neo4jとRedisは不要です。

```bash
# 1. 依存パッケージのインストール
npm install

# 2. Lite Mode用の環境変数を設定
cp .env.lite.example .env
# .envファイルを編集（PostgreSQLの設定のみ必要）

# 3. PostgreSQLのみを起動
docker-compose --profile lite up -d

# 4. ビルド
npm run build

# 5. MCP設定ファイルを生成
npm run generate-config -- --lite-mode --client claude-desktop

# 6. 開発モード
npm run dev
```

詳細は [Lite Mode セクション](#lite-mode) を参照してください。

### 開発環境（フルモード）

```bash
# 依存パッケージのインストール
npm install

# 環境変数の設定
cp .env.example .env
# .envファイルを編集して必要な情報を設定

# Dockerサービスの起動
docker-compose up -d

# ビルド
npm run build

# 開発モード
npm run dev
```

### ローカル本番環境

ローカルマシンで本番サーバーを運用する場合：

```bash
# 1. 自動セットアップ
./scripts/setup-production.sh

# 2. サーバー起動
./scripts/start-production.sh

# 3. MCPクライアント（Claude Desktop等）を設定
# docs/deployment/local-production.md を参照
```

詳細は [docs/deployment/local-production.md](./docs/deployment/local-production.md) を参照してください。

### リモート本番環境

リモートサーバーにデプロイする場合：

```bash
# 1. 環境設定
cp .env.production.example .env.production
# .env.productionを編集

# 2. デプロイ
./scripts/deploy.sh
```

詳細は [QUICK_START.md](./QUICK_START.md) を参照してください。

## 💡 Lite Mode

Lite Modeは、個人用PCで効率的に実行できる軽量動作モードです。PostgreSQLのみを使用し、Neo4jとRedisへの依存を排除します。

### 特徴

- **最小限のリソース**: アイドル時のメモリ使用量 < 500MB
- **簡単なセットアップ**: PostgreSQLのみで動作
- **自動データ収集**: AI Desktop App、AI IDE、CLIエージェントからの会話を自動収集
- **柔軟な埋め込み生成**: OpenAI API、ローカルCLI、カスタムAPIをサポート
- **優雅な劣化**: オプション依存関係が欠落していても動作継続

### セットアップ

#### 1. 環境変数の設定

```bash
cp .env.lite.example .env
```

`.env`ファイルを編集して、PostgreSQLの接続情報を設定します：

```bash
# Lite Mode設定
LITE_MODE=true
ENABLE_GRAPH_STORE=false
ENABLE_REDIS_CACHE=false

# PostgreSQL設定（必須）
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=context_store
POSTGRES_PASSWORD=your_password_here
POSTGRES_DB=context_store

# 埋め込みプロバイダー（オプション）
EMBEDDING_PROVIDER=openai  # または local-cli, custom-api
# EMBEDDING_CLI_COMMAND=gemini-cli embed  # local-cliの場合
# EMBEDDING_API_ENDPOINT=http://localhost:8080/embed  # custom-apiの場合
```

#### 2. PostgreSQLの起動

```bash
# Lite Modeプロファイルでサービスを起動
docker-compose --profile lite up -d

# または、既存のPostgreSQLを使用する場合はスキップ
```

#### 3. MCP設定ファイルの生成

```bash
# Claude Desktop用の設定を生成
npm run generate-config -- --lite-mode --client claude-desktop

# Cursor用の設定を生成
npm run generate-config -- --lite-mode --client cursor

# カスタムパスに出力
npm run generate-config -- --lite-mode --output ./my-config.json
```

生成された設定ファイルを編集して、データベース認証情報を設定してください。

#### 4. サーバーの起動

```bash
npm run build
npm start
```

### 埋め込みプロバイダーの選択

Lite Modeでは、複数の埋め込み生成方法をサポートしています：

#### OpenAI API（デフォルト）

```bash
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=your_api_key_here
```

#### ローカルCLI

```bash
EMBEDDING_PROVIDER=local-cli
EMBEDDING_CLI_COMMAND="gemini-cli embed"
# または
EMBEDDING_CLI_COMMAND="claude-code embed"
```

#### カスタムAPI

```bash
EMBEDDING_PROVIDER=custom-api
EMBEDDING_API_ENDPOINT=http://localhost:8080/embed
```

### 自動データ収集（コレクター）

Lite Modeでは、各種AIツールから会話データを自動収集できます：

- **AI Desktop App**: Claude Desktop、ChatGPT Desktop
- **AI IDE**: Cursor、Windsurf、Copilot、Cline
- **CLIエージェント**: ClaudeCode、GeminiCLI、CodexCLI、CursorCLI

コレクターの設定と起動方法については、`scripts/LITE_MODE_MIGRATION.md`を参照してください。

### トラブルシューティング

一般的な問題と解決策については、[Lite Modeトラブルシューティングガイド](docs/lite-mode-troubleshooting.md)を参照してください。

#### クイックチェック

```bash
# PostgreSQL接続を確認
psql -h localhost -U context_store -d context_store

# Dockerコンテナのログを確認
docker-compose logs postgres

# MCP設定ファイルを検証
cat ~/Library/Application\ Support/Claude/claude_desktop_config.json | jq .

# 環境変数を確認
env | grep -E '(LITE_MODE|POSTGRES|EMBEDDING)'
```

詳細なトラブルシューティング手順は[こちら](docs/lite-mode-troubleshooting.md)。

### フルモードへの移行

Lite Modeからフルモードへの移行は簡単です：

```bash
# 1. 環境変数を更新
LITE_MODE=false
ENABLE_GRAPH_STORE=true
ENABLE_REDIS_CACHE=true

# 2. Neo4jとRedisを起動
docker-compose --profile full up -d

# 3. サーバーを再起動
npm run start
```

既存のPostgreSQLデータはそのまま使用できます。

## 📚 ドキュメント

### デプロイメント
- **[ローカル本番環境](./docs/deployment/local-production.md)** - ローカルマシンで本番サーバーを運用
- **[MCPクライアント統合](./docs/integration/mcp-clients.md)** - Claude Desktop等との統合方法
- **[クイックスタート](./QUICK_START.md)** - 5分でデプロイ
- **[デプロイメントガイド](./docs/deployment/guide.md)** - 詳細な手順
- **[デプロイメントチェックリスト](./docs/deployment/checklist.md)** - 確認項目
- **[本番環境準備ガイド](./docs/deployment/production-readiness.md)** - 本番環境の要件

### 開発
- **[技術スタック](.kiro/steering/tech.md)** - 使用技術
- **[プロジェクト構造](.kiro/steering/structure.md)** - ディレクトリ構成
- **[製品概要](.kiro/steering/product.md)** - 機能と価値提案

### 仕様
- **[要件定義](.kiro/specs/context-store-mcp/requirements.md)** - システム要件
- **[設計書](.kiro/specs/context-store-mcp/design.md)** - 技術設計
- **[実装計画](.kiro/specs/context-store-mcp/tasks.md)** - タスクリスト

### Lite Mode
- **[Lite Mode要件](.kiro/specs/lite-mode/requirements.md)** - Lite Mode要件定義
- **[Lite Mode設計](.kiro/specs/lite-mode/design.md)** - Lite Mode技術設計
- **[マイグレーションガイド](scripts/LITE_MODE_MIGRATION.md)** - Lite Modeへの移行手順
- **[トラブルシューティング](docs/lite-mode-troubleshooting.md)** - 問題解決ガイド

## 必要な環境

### 開発環境
- Node.js 20.x以上
- Docker & Docker Compose
- Git

### 本番環境
- Docker 24.0+
- Docker Compose 2.20+
- Linux (Ubuntu 20.04+ or RHEL 8+)
- 4+ CPU cores (8+ recommended)
- 8 GB RAM (16 GB recommended)
- 100 GB SSD (500 GB recommended)

## 開発

### コマンド

```bash
# 開発
npm run dev              # 開発サーバー起動
npm run build            # ビルド
npm start                # 本番モード起動

# コード品質
npm run typecheck        # 型チェック
npm run lint             # Lint
npm run lint:fix         # Lint自動修正
npm run format           # フォーマット
npm run format:check     # フォーマットチェック

# テスト
npm test                 # テスト実行
npm run test:coverage    # カバレッジ付きテスト

# デプロイメント
npm run docker:build     # Dockerイメージビルド
npm run docker:run       # 本番サービス起動
npm run docker:stop      # 本番サービス停止
npm run docker:logs      # ログ表示
npm run deploy           # 自動デプロイ
npm run benchmark        # パフォーマンステスト
npm run health-check     # ヘルスチェック
npm run validate-config  # 設定検証
npm run security-audit   # セキュリティ監査
```

### テスト用データベース設定

テストは本番データベースへの誤った接続を防ぐため、デフォルトで `context_store_test` データベースを使用します。

環境変数 `POSTGRES_DB` を設定することで、テスト用データベース名をオーバーライドできます:

```bash
# テスト用に専用のデータベースを使用する場合
POSTGRES_DB=context_store_test npm test
```

**重要**: 本番環境のデータベース名(`context_store`)をテスト環境で使用しないでください。

#### 安全性チェック

テストには以下の安全性チェックが組み込まれています:

1. **本番データベース名の拒否**: `context_store` への接続は明示的にブロックされます（大文字小文字を区別しない）
2. **テスト用データベース名の検証**: データベース名に "test" が含まれるか、"_test" で終わる必要があります（大文字小文字を区別しない）
3. **CI環境での明示的な設定要求**: CI環境では `POSTGRES_DB` の明示的な設定が必須です

これらのチェックにより、破壊的なSQL操作(DROP SCHEMA CASCADE等)が本番データベースに対して実行されることを防ぎます。

**注意**: 全ての検証は大文字小文字を区別せず行われるため、`CONTEXT_STORE`、`Context_Store` などの変形も適切に検出されます。

## リソース管理

### MemoryManagerのクリーンアップ

`MemoryManager`は、内部でPostgreSQLの接続プールを管理する場合があります。アプリケーションのシャットダウン時には、必ず`dispose()`メソッドを呼び出してリソースを適切に解放してください。

```typescript
import { MemoryManager } from './memory/memory-manager.js';

// MemoryManagerの作成
const memoryManager = new MemoryManager();

// ... 使用 ...

// シャットダウン時のクリーンアップ
process.on('SIGTERM', async () => {
  await memoryManager.dispose();
  process.exit(0);
});
```

#### 重要な注意事項

- **自動作成されたプール**: `MemoryManager`がストレージアダプターを自動作成した場合（コンストラクタで`storage`オプションを指定しない場合）、`dispose()`は内部の接続プールを自動的にクローズします。

- **外部提供のストレージ**: `MemoryManager`のコンストラクタで`storage`オプションを指定した場合、`dispose()`は接続プールをクローズしません。この場合、呼び出し側が接続プールのライフサイクルを管理する責任があります。

- **冪等性**: `dispose()`メソッドは冪等であり、複数回呼び出しても安全です。

```typescript
// 外部ストレージを使用する場合の例
import { Pool } from 'pg';
import { PostgresStorageAdapter } from './storage/postgres-store-adapter.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const storage = new PostgresStorageAdapter(pool);
const memoryManager = new MemoryManager({ storage });

// ... 使用 ...

// シャットダウン時
await memoryManager.dispose(); // 何もしない（外部管理のため）
await pool.end(); // 呼び出し側が明示的にクローズ
```

## パフォーマンス目標

- **レイテンシ**: P95 < 2000ms ✓
- **スループット**: 100+ req/sec
- **可用性**: 99.9% uptime

## セキュリティ

- **暗号化**: AES-256-GCM (at rest), TLS 1.3 (in transit)
- **認証**: API keys, RBAC
- **監査**: 365日保持、改ざん防止
- **GDPR**: 完全削除ワークフロー

## サポート

- **Issues**: [GitHub Issues](https://github.com/your-org/context-store-mcp/issues)
- **Documentation**: [docs/](./docs/)
- **Email**: support@example.com

## ライセンス

MIT
