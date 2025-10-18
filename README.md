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

## ライセンス

MIT
