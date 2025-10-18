# Docker開発環境

## 概要

Context Store MCPプロジェクトの開発環境は、以下のコンテナ化されたサービスで構成されています:

- **PostgreSQL 16 + pgvector**: ベクトル検索機能を備えたリレーショナルデータベース
- **Neo4j 5.x Community Edition**: グラフデータベース
- **Redis 7.x**: キャッシュシステム

## クイックスタート

### 1. 環境変数の設定

`.env.example`をコピーして`.env`ファイルを作成します:

```bash
cp .env.example .env
```

必要に応じて`.env`ファイルの値を編集してください。

### 2. コンテナの起動

```bash
make up
# または
docker-compose up -d
```

### 3. ヘルスチェックの確認

```bash
make ps
# または
docker-compose ps
```

全てのサービスが`healthy`状態になっていることを確認します。

## サービス詳細

### PostgreSQL + pgvector

- **ポート**: 5432 (デフォルト)
- **データベース**: `context_store`
- **ユーザー**: `context_store_user`
- **拡張機能**:
  - pgvector: ベクトル検索用
  - uuid-ossp: UUID生成用
  - pgcrypto: 暗号化関数用

#### 接続方法

```bash
docker exec -it context-store-postgres psql -U context_store_user -d context_store
```

### Neo4j

- **HTTPポート**: 7474 (ブラウザUI)
- **Boltポート**: 7687 (クライアント接続)
- **ユーザー**: neo4j
- **プラグイン**: APOC

#### ブラウザUIへのアクセス

http://localhost:7474 にアクセスして、Boltアドレス `bolt://localhost:7687` で接続します。

### Redis

- **ポート**: 6379 (デフォルト)
- **最大メモリ**: 256MB (デフォルト)
- **削除ポリシー**: allkeys-lru
- **永続化**: AOF (Append Only File) 有効

#### CLIアクセス

```bash
docker exec -it context-store-redis redis-cli -a changeme
# または
docker exec -it context-store-redis redis-cli
AUTH changeme
```

## Makefileコマンド

| コマンド | 説明 |
|---------|------|
| `make up` | 全コンテナを起動 |
| `make down` | 全コンテナを停止・削除 |
| `make restart` | 全コンテナを再起動 |
| `make logs` | ログをフォロー表示 |
| `make ps` | コンテナ状態を確認 |
| `make clean` | コンテナ、ボリューム、ネットワークを削除 |

## ボリューム管理

データは以下の名前付きボリュームに永続化されます:

- `postgres_data`: PostgreSQLデータ
- `neo4j_data`: Neo4jデータベース
- `neo4j_logs`: Neo4jログ
- `neo4j_import`: Neo4jインポートファイル
- `neo4j_plugins`: Neo4jプラグイン
- `redis_data`: Redis永続化データ

### ボリュームのバックアップ

```bash
# PostgreSQLのバックアップ
docker exec context-store-postgres pg_dump -U context_store_user context_store > backup.sql

# Neo4jのバックアップ
docker exec context-store-neo4j neo4j-admin dump --to=/var/lib/neo4j/backup.dump
docker cp context-store-neo4j:/var/lib/neo4j/backup.dump ./backup.dump
```

## トラブルシューティング

### コンテナが起動しない場合

1. ポートの競合を確認:
   ```bash
   lsof -i :5432
   lsof -i :7474
   lsof -i :7687
   lsof -i :6379
   ```

2. ログを確認:
   ```bash
   docker-compose logs postgres
   docker-compose logs neo4j
   docker-compose logs redis
   ```

### データをリセットしたい場合

```bash
make clean
make up
```

これにより、全てのボリュームが削除され、クリーンな状態から再起動します。

## 初期化スクリプト

PostgreSQLの初期化スクリプトは `docker/init-scripts/postgres/` ディレクトリに配置します。
スクリプトはアルファベット順に実行されるため、ファイル名の先頭に番号を付けています。

現在の初期化スクリプト:
- `01-init-extensions.sql`: pgvector等の拡張機能を有効化

## ネットワーク

全てのコンテナは `context-store-network` というブリッジネットワークで接続されています。

- サブネット: 172.28.0.0/16
- ドライバー: bridge

コンテナ間通信はサービス名で行えます:
- `postgres:5432`
- `neo4j:7687`
- `redis:6379`
