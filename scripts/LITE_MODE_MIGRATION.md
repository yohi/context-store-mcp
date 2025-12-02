# Liteモード スキーママイグレーションガイド

このドキュメントでは、既存のContext Store MCPデータベースにLiteモード用のスキーマ拡張を適用する方法を説明します。

## 概要

Liteモードでは、以下のスキーマ拡張が必要です：

1. **lite_mode_metadata カラム**: `memories`テーブルにJSONBカラムを追加し、グラフストアの代わりに関係性データを保存
2. **Liteモード用インデックス**: ソース、プロジェクト、タグによる高速フィルタリング用のインデックス
3. **collector_state テーブル**: コレクターの状態管理用の新しいテーブル

## 新規インストール

新規インストールの場合、Docker Composeを使用すると自動的にスキーマが適用されます：

```bash
docker compose up -d
```

初期化スクリプト `docker/init-scripts/postgres/07-lite-mode-schema.sql` が自動的に実行されます。

## 既存データベースのマイグレーション

既存のデータベースに対してマイグレーションを実行する方法は以下の通りです。

### 方法1: psqlコマンドを使用

```bash
psql -U postgres -d context_store -f scripts/migrate-lite-mode-schema.sql
```

### 方法2: Docker環境の場合

```bash
docker exec -i context-store-postgres psql -U postgres -d context_store < scripts/migrate-lite-mode-schema.sql
```

### 方法3: pgAdminやその他のGUIツールを使用

1. `scripts/migrate-lite-mode-schema.sql` ファイルを開く
2. SQLクエリエディタにコピー＆ペースト
3. 実行

## マイグレーション内容の確認

マイグレーション後、以下のコマンドで変更を確認できます：

### lite_mode_metadataカラムの確認

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'memories' AND column_name = 'lite_mode_metadata';
```

### インデックスの確認

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'memories' AND indexname LIKE 'idx_memories_lite%';
```

### collector_stateテーブルの確認

```sql
\d collector_state
```

または

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'collector_state'
ORDER BY ordinal_position;
```

## ロールバック

マイグレーションをロールバックする必要がある場合：

```sql
BEGIN;

-- インデックスを削除
DROP INDEX IF EXISTS idx_memories_lite_metadata;
DROP INDEX IF EXISTS idx_memories_lite_source;
DROP INDEX IF EXISTS idx_memories_lite_project;
DROP INDEX IF EXISTS idx_memories_lite_tags;
DROP INDEX IF EXISTS idx_memories_lite_source_type;
DROP INDEX IF EXISTS idx_collector_state_updated;

-- collector_stateテーブルを削除
DROP TABLE IF EXISTS collector_state;

-- lite_mode_metadataカラムを削除（注意: データが失われます）
ALTER TABLE memories DROP COLUMN IF EXISTS lite_mode_metadata;

COMMIT;
```

**警告**: ロールバックを実行すると、`lite_mode_metadata`カラムに保存されたすべてのデータが失われます。

## トラブルシューティング

### エラー: "permission denied"

データベースユーザーに十分な権限がない場合、スーパーユーザー（通常は`postgres`）で実行してください：

```bash
psql -U postgres -d context_store -f scripts/migrate-lite-mode-schema.sql
```

### エラー: "relation already exists"

マイグレーションスクリプトは冪等性を持っているため、複数回実行しても安全です。既存のオブジェクトはスキップされます。

### エラー: "database does not exist"

データベース名を確認してください。デフォルトは`context_store`ですが、環境によって異なる場合があります：

```bash
# データベース一覧を確認
psql -U postgres -l

# 正しいデータベース名で実行
psql -U postgres -d <your_database_name> -f scripts/migrate-lite-mode-schema.sql
```

## 参考情報

- [Liteモード設計書](.kiro/specs/lite-mode/design.md)
- [Liteモード要件定義](.kiro/specs/lite-mode/requirements.md)
- [PostgreSQLスキーマ](docker/init-scripts/postgres/02-create-schema.sql)
