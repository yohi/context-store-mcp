# Context Store MCP

AIエージェント向けMCPベース長期記憶システム

## 概要

Context Store MCPは、AIエージェントに永続的な記憶能力を付与するModel Context Protocol (MCP)サーバーです。セッションを越えて情報を保持し、文脈に応じた知的な検索を実現します。

## 特徴

- **永続的記憶**: セッション間での情報の保存と取得
- **多層的記憶タイプ**: エピソード記憶、意味記憶、手続き記憶の自動分類
- **ハイブリッド検索**: ベクトル類似性検索とグラフトラバーサルの統合
- **MCP標準準拠**: 様々なAIエージェントから統一的に利用可能
- **高パフォーマンス**: PostgreSQL + pgvector、Neo4j、Redisによる最適化

## 必要な環境

- Node.js 20.x以上
- Docker & Docker Compose (開発環境用)
- PostgreSQL 16 + pgvector
- Neo4j 5.x
- Redis

## セットアップ

```bash
# 依存パッケージのインストール
npm install

# 環境変数の設定
cp .env.example .env
# .envファイルを編集して必要な情報を設定

# ビルド
npm run build

# 開発モード
npm run dev
```

## 開発

```bash
# 型チェック
npm run typecheck

# Lint
npm run lint
npm run lint:fix

# フォーマット
npm run format
npm run format:check

# テスト
npm test
npm run test:coverage
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

1. **本番データベース名の拒否**: `context_store` への接続は明示的にブロックされます
2. **テスト用データベース名の検証**: データベース名に "test" が含まれるか、"_test" で終わる必要があります
3. **CI環境での明示的な設定要求**: CI環境では `POSTGRES_DB` の明示的な設定が必須です

これらのチェックにより、破壊的なSQL操作(DROP SCHEMA CASCADE等)が本番データベースに対して実行されることを防ぎます。

## ライセンス

MIT
