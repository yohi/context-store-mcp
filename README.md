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

### 開発環境

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

### 本番環境

```bash
# 1. 環境設定
cp .env.production.example .env.production
# .env.productionを編集

# 2. デプロイ
./scripts/deploy.sh
```

詳細は [QUICK_START.md](./QUICK_START.md) を参照してください。

## 📚 ドキュメント

### デプロイメント
- **[クイックスタート](./QUICK_START.md)** - 5分でデプロイ
- **[デプロイメントガイド](./DEPLOYMENT.md)** - 詳細な手順
- **[デプロイメントチェックリスト](./DEPLOYMENT_CHECKLIST.md)** - 確認項目
- **[本番環境準備ガイド](./PRODUCTION_READINESS.md)** - 本番環境の要件
- **[デプロイメント概要](./DEPLOYMENT_SUMMARY.md)** - 実装内容の概要

### 開発
- **[技術スタック](.kiro/steering/tech.md)** - 使用技術
- **[プロジェクト構造](.kiro/steering/structure.md)** - ディレクトリ構成
- **[製品概要](.kiro/steering/product.md)** - 機能と価値提案

### 仕様
- **[要件定義](.kiro/specs/context-store-mcp/requirements.md)** - システム要件
- **[設計書](.kiro/specs/context-store-mcp/design.md)** - 技術設計
- **[実装計画](.kiro/specs/context-store-mcp/tasks.md)** - タスクリスト

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
