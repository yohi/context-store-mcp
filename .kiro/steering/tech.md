# Technology Stack

## 概要

本プロジェクトは、AIエージェント向け長期記憶システム「Context Store MCP」を構築するために、堅牢かつスケーラブルな技術スタックを採用しています。主にTypeScriptとNode.jsを基盤とし、ハイブリッドストレージアーキテクチャとしてPostgreSQL（pgvector拡張含む）とNeo4jグラフデータベースを組み合わせています。

## アーキテクチャ

Context Store MCPは、AIエージェントからのリクエストを受け付けるMCPサーバー層、記憶の管理と分類を行うメモリ管理層、複雑な検索クエリを処理するクエリ処理層、そして永続化を担うストレージアダプター層から構成される多層アーキテクチャを採用しています。

MCPサーバーはAIエージェントからの統一インターフェースとして機能し、メモリ管理層が記憶の保存、更新、削除、分類をオーケストレーションします。クエリ処理層は、ベクトル検索とグラフトラバーサルを組み合わせたハイブリッド検索を提供し、Redisによるキャッシングで高速な応答を実現します。ストレージ層では、非構造化データとベクトル埋め込みをPostgreSQL+pgvectorで、エンティティ間の関係性をNeo4jで管理します。

### 動作モード

システムは2つの動作モードをサポートします：

- **Lite Mode**: PostgreSQLのみを使用する軽量モード。個人用PCでの実行に最適化されており、Neo4jとRedisは不要です。
- **Full Mode**: PostgreSQL、Neo4j、Redisを使用する完全機能モード。本番環境向けの高性能なハイブリッドストレージアーキテクチャです。

## 技術スタック

### 言語・ランタイム
*   **TypeScript 5.7.x**: 型安全性を確保し、大規模開発におけるコード品質と保守性を向上させます。
*   **Node.js 20.x LTS**: 高いI/O性能と豊富なエコシステムを活用し、非同期処理を効率的に実行します。

### MCPフレームワーク
*   **@modelcontextprotocol/sdk v1.0.6**: MCP標準プロトコルに準拠したAIエージェントとの通信インターフェースを提供します。

### データベース
*   **PostgreSQL 16 with pgvector 0.2.x**:
    *   **用途**: 記憶コンテンツ、メタデータ、ベクトル埋め込みの保存。
    *   **特徴**: ACID特性、リレーショナルデータとベクトルデータの統合管理、1536次元ベクトルを効率的に格納・検索。
    *   **必須**: すべての動作モードで必要。
*   **Neo4j 5.x Community Edition** (Full Modeのみ):
    *   **用途**: 記憶タイプ間の関連性、エピソード記憶のシーケンス、複雑な関係性データの管理。
    *   **特徴**: Cypherクエリ言語による直感的かつ強力なグラフトラバーサル、複雑な関係性の効率的な表現。
    *   **オプション**: Lite Modeでは不要。
*   **Redis 4.7.x** (Full Modeのみ):
    *   **用途**: クエリ結果のキャッシュ、レートリミッター、サーキットブレーカーの状態管理。
    *   **特徴**: インメモリデータストアによる高速なデータアクセス。
    *   **オプション**: Lite Modeでは不要。

### 埋め込みプロバイダー
システムは3つの埋め込み生成方法をサポートします：

*   **OpenAI Embeddings API** (デフォルト): `text-embedding-3-small`モデルを使用して、記憶コンテンツのベクトル埋め込みを生成します。
*   **ローカルCLI**: `gemini-cli embed`、`claude-code embed`等のローカルCLIツールを使用して埋め込みを生成します。
*   **カスタムAPI**: ユーザー定義のAPIエンドポイントを使用して埋め込みを生成します。

### 開発・品質ツール
*   **Vitest 2.1.8**: 高速なユニットテスト、統合テスト、カバレッジ測定フレームワーク。
*   **ESLint 9.39.x**: コード品質とスタイルの一貫性を維持するための静的コード解析。
*   **Prettier 3.4.x**: コードフォーマッター。
*   **TypeScript Compiler (tsc)**: 型チェックとJavaScriptへのトランスパイル。
*   **tsx 4.19.2**: TypeScriptファイルの直接実行。
*   **Winston 3.18.x**: 構造化ロギングライブラリ。

## 開発環境

*   **コンテナ化**: `docker-compose.yml` を使用し、PostgreSQL、Neo4j、Redisのサービスを含む一貫した開発環境を提供します。
*   **スクリプト**: `package.json` に定義された`npm`スクリプト (`build`, `test`, `lint`, `format`, `start`, `dev`) を使用します。

## コアコマンド

*   `npm install`: 依存関係のインストール。
*   `npm run build`: TypeScriptコードをJavaScriptにコンパイル。
*   `npm run test`: すべてのテストを実行。
*   `npm run lint`: コードのリンティングを実行。
*   `npm run format`: コードのフォーマットを実行。
*   `npm run start`: コンパイル済みアプリケーションを実行。
*   `npm run dev`: 開発モードでアプリケーションを実行（`tsx watch`）。
*   `docker compose up -d`: データベースなどのサービスをバックグラウンドで起動。

## 環境変数

主要な環境変数は `.env.example` に定義されており、本番環境では適切な値で設定する必要があります。

*   `NODE_ENV`: `development`, `production`, `test`
*   `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
*   `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`, `NEO4J_DATABASE`
*   `REDIS_URL`
*   `OPENAI_API_KEY`
*   `SIGNATURE_SECRET`: 削除証明書のデジタル署名に使用（本番環境必須）

## ポート設定

*   **MCP Server**: デフォルトで `3000` 番ポート（設定可能）
*   **PostgreSQL**: `5432` 番ポート
*   **Neo4j**: `7687` 番ポート (Bolt), `7474` 番ポート (HTTP)
*   **Redis**: `6379` 番ポート
