# Context Store MCP - ローカル本番環境セットアップガイド

このドキュメントは、Context Store MCPサーバーを**ローカルマシンで本番運用**するための包括的なガイドです。

> [!NOTE]
> これは開発環境ではなく、MCPクライアント（Claude Desktop等）から実際に使用する本番サーバーをローカルで運用するためのガイドです。

## 📋 目次

- [前提条件](#前提条件)
- [クイックスタート](#クイックスタート)
- [詳細セットアップ](#詳細セットアップ)
- [MCPクライアント統合](#mcpクライアント統合)
- [運用管理](#運用管理)
- [バックアップと復元](#バックアップと復元)
- [セキュリティ](#セキュリティ)
- [トラブルシューティング](#トラブルシューティング)

## 前提条件

### 必須ソフトウェア

- **Docker**: 24.0以上
  ```bash
  docker --version
  ```

- **Docker Compose**: 2.20以上
  ```bash
  docker-compose --version
  ```

### システム要件

- **OS**: Linux、macOS、またはWindows (WSL2推奨)
- **RAM**: 8GB以上（16GB推奨）
- **ディスク**: 20GB以上の空き容量（データ保存用）
- **CPU**: 4コア以上推奨

### 推奨事項

- **OpenAI API Key**: 記憶の分類とベクトル化に使用
- **定期バックアップ**: 重要なデータを保護

## クイックスタート

### 自動セットアップ（推奨）

```bash
# 1. リポジトリのクローン
git clone https://github.com/yohi/context-store-mcp.git
cd context-store-mcp

# 2. 自動セットアップスクリプトの実行
./scripts/setup-production.sh

# 3. サーバーの起動
./scripts/start-production.sh
```

これで本番サーバーが起動します！

### 動作確認

```bash
# サービスの状態確認
docker-compose -f docker-compose.prod.yml ps

# ヘルスチェック
npm run health-check
```

## 詳細セットアップ

自動セットアップがうまくいかない場合、以下の手順で手動セットアップできます。

### 1. リポジトリの準備

```bash
git clone https://github.com/yohi/context-store-mcp.git
cd context-store-mcp
```

### 2. 環境変数の設定

`.env.production.local`ファイルを作成します：

```bash
cp .env.production.example .env.production.local
```

`.env.production.local`を編集して、以下の重要な値を設定します：

```bash
# PostgreSQL Configuration
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=context_store
POSTGRES_USER=context_store_user
POSTGRES_PASSWORD=<強固なパスワード>

# Neo4j Configuration
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=<強固なパスワード>
NEO4J_HTTP_PORT=7474
NEO4J_BOLT_PORT=7687

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=<強固なパスワード>

# OpenAI API
OPENAI_API_KEY=sk-your-api-key-here

# Security
SIGNATURE_SECRET=<強固なシークレット>

# Logging
LOG_LEVEL=info
```

> [!IMPORTANT]
> **強固なパスワードの生成**:
> ```bash
> # 各サービス用に異なるパスワードを生成
> openssl rand -base64 32
> ```

### 3. Dockerサービスの起動

```bash
docker-compose -f docker-compose.prod.yml up -d
```

### 4. サービスの起動確認

全てのサービスが正常に起動したか確認します：

```bash
docker-compose -f docker-compose.prod.yml ps
```

以下のような出力が表示されるはずです：

```
NAME                              STATUS          PORTS
context-store-app-prod            Up (healthy)    0.0.0.0:3000->3000/tcp
context-store-postgres-prod       Up (healthy)    0.0.0.0:5432->5432/tcp
context-store-neo4j-prod          Up (healthy)    0.0.0.0:7474->7474/tcp, 0.0.0.0:7687->7687/tcp
context-store-redis-prod          Up (healthy)    0.0.0.0:6379->6379/tcp
```

### 5. ヘルスチェック

```bash
npm run health-check
```

全てのサービスが正常であれば、セットアップ完了です！

## MCPクライアント統合

### Claude Desktopとの統合

#### 1. Claude Desktop設定ファイルの場所

**macOS**:
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows**:
```
%APPDATA%\Claude\claude_desktop_config.json
```

**Linux**:
```
~/.config/Claude/claude_desktop_config.json
```

#### 2. 設定ファイルの編集

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

> [!TIP]
> サーバーが起動していることを確認してから、Claude Desktopを起動してください。

#### 3. Claude Desktopの再起動

設定を反映するため、Claude Desktopを完全に終了して再起動します。

#### 4. 動作確認

Claude Desktopで以下のように試してみます：

```
記憶を保存してください：「Context Store MCPは素晴らしいツールです」
```

Claude が `store_memory` ツールを使用して記憶を保存します。

その後、以下で確認：

```
「Context Store」に関する記憶を検索してください
```

### その他のMCPクライアント

詳細は[MCP_CLIENT_INTEGRATION.md](./MCP_CLIENT_INTEGRATION.md)を参照してください。

## 運用管理

### サーバーの起動

```bash
./scripts/start-production.sh
```

または手動で：

```bash
docker-compose -f docker-compose.prod.yml up -d
```

### サーバーの停止

```bash
./scripts/stop-production.sh
```

または手動で：

```bash
docker-compose -f docker-compose.prod.yml down
```

> [!WARNING]
> `docker-compose down -v` を使用すると、データベースのボリュームも削除されます。データを保持したい場合は `-v` オプションを付けないでください。

### サーバーの再起動

```bash
docker-compose -f docker-compose.prod.yml restart
```

### ログの確認

```bash
# 全サービスのログ
docker-compose -f docker-compose.prod.yml logs -f

# 特定のサービスのログ
docker-compose -f docker-compose.prod.yml logs -f app
docker-compose -f docker-compose.prod.yml logs -f postgres
docker-compose -f docker-compose.prod.yml logs -f neo4j
docker-compose -f docker-compose.prod.yml logs -f redis
```

### サービスの状態確認

```bash
# コンテナの状態
docker-compose -f docker-compose.prod.yml ps

# リソース使用状況
docker stats

# ヘルスチェック
npm run health-check
```

### アップデート

```bash
# 1. 最新コードを取得
git pull origin main

# 2. サーバーを停止
./scripts/stop-production.sh

# 3. イメージを再ビルド
docker-compose -f docker-compose.prod.yml build

# 4. サーバーを起動
./scripts/start-production.sh
```

## バックアップと復元

### 自動バックアップ

```bash
./scripts/backup-production.sh
```

バックアップは`backups/`ディレクトリに保存されます：

```
backups/
├── postgres_YYYYMMDD_HHMMSS.sql
├── neo4j_YYYYMMDD_HHMMSS.tar.gz
└── redis_YYYYMMDD_HHMMSS.rdb
```

### 定期バックアップの設定

#### Linux (cron)

```bash
# crontabを編集
crontab -e

# 毎日午前3時にバックアップ
0 3 * * * /path/to/context-store-mcp/scripts/backup-production.sh
```

#### macOS (launchd)

`~/Library/LaunchAgents/com.contextstore.backup.plist`を作成：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.contextstore.backup</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/context-store-mcp/scripts/backup-production.sh</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>3</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.contextstore.backup.plist
```

### データの復元

```bash
./scripts/restore-production.sh <backup-directory>
```

例：
```bash
./scripts/restore-production.sh backups/20240115_030000
```

### 手動バックアップ

#### PostgreSQL

```bash
docker exec context-store-postgres-prod pg_dump -U context_store_user context_store > backup.sql
```

#### Neo4j

```bash
docker exec context-store-neo4j-prod neo4j-admin dump --database=neo4j --to=/backups/neo4j.dump
```

#### Redis

```bash
docker exec context-store-redis-prod redis-cli -a <password> SAVE
docker cp context-store-redis-prod:/data/dump.rdb ./redis_backup.rdb
```

## セキュリティ

### パスワード管理

> [!CAUTION]
> `.env.production.local`には機密情報が含まれています。このファイルを共有したり、バージョン管理システムにコミットしないでください。

強固なパスワードを使用してください：

```bash
# 32文字のランダムパスワード生成
openssl rand -base64 32
```

### ファイアウォール設定

ローカルマシンでのみ使用する場合、外部からのアクセスをブロックします：

```bash
# iptables (Linux)
sudo iptables -A INPUT -p tcp --dport 5432 -s 127.0.0.1 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 5432 -j DROP
sudo iptables -A INPUT -p tcp --dport 7687 -s 127.0.0.1 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 7687 -j DROP
sudo iptables -A INPUT -p tcp --dport 6379 -s 127.0.0.1 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 6379 -j DROP
```

### データ暗号化

PostgreSQLのデータは自動的に暗号化されます（`docker-compose.prod.yml`で設定済み）。

### アクセスログ

全てのアクセスは`logs/`ディレクトリに記録されます：

```bash
tail -f logs/context-store-mcp.log
```

## 自動起動設定

### Linux (systemd)

#### 1. サービスファイルの作成

```bash
sudo cp systemd/context-store-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload
```

> [!IMPORTANT] パス要件
> - サービス定義は `WorkingDirectory` と `EnvironmentFile` を `/home/%u/program/context-store-mcp` に固定しています。
> - そのまま使う場合は **リポジトリを `~/program/context-store-mcp` に配置**するか、以下のいずれかで対応してください。
>   1. **シンボリックリンクを作成**: 例として `/srv/context-store-mcp` に設置した場合
>      ```bash
>      sudo mkdir -p /home/$USER/program
>      sudo ln -s /srv/context-store-mcp /home/$USER/program/context-store-mcp
>      ```
>   2. **サービスファイルを編集**して実際のパスに変更:
>      ```bash
>      sudo editor /etc/systemd/system/context-store-mcp.service
>      # WorkingDirectory と EnvironmentFile を /absolute/path/context-store-mcp に更新
>      sudo systemctl daemon-reload
>      ```
> - `EnvironmentFile` を別パスに置く場合も同様に書き換えてください。

#### 2. サービスの有効化

```bash
sudo systemctl enable context-store-mcp
sudo systemctl start context-store-mcp
```

#### 3. 状態確認

```bash
sudo systemctl status context-store-mcp
```

### macOS (launchd)

#### 1. plistファイルのコピー

```bash
cp launchd/com.contextstore.mcp.plist ~/Library/LaunchAgents/
```

#### 2. サービスの読み込み

```bash
launchctl load ~/Library/LaunchAgents/com.contextstore.mcp.plist
```

#### 3. 状態確認

```bash
launchctl list | grep contextstore
```

## トラブルシューティング

### サービスが起動しない

**症状**: `docker-compose up`が失敗する

**解決方法**:

1. ポート競合を確認：
   ```bash
   lsof -i :5432  # PostgreSQL
   lsof -i :7474  # Neo4j HTTP
   lsof -i :7687  # Neo4j Bolt
   lsof -i :6379  # Redis
   ```

2. ログを確認：
   ```bash
   docker-compose -f docker-compose.prod.yml logs
   ```

3. コンテナを再作成：
   ```bash
   docker-compose -f docker-compose.prod.yml down
   docker-compose -f docker-compose.prod.yml up -d
   ```

### Claude Desktopが接続できない

**症状**: Claude DesktopがMCPサーバーを認識しない

**解決方法**:

1. サーバーが起動しているか確認：
   ```bash
   docker-compose -f docker-compose.prod.yml ps
   ```

2. 設定ファイルのパスを確認

3. Claude Desktopのログを確認（通常は`~/Library/Logs/Claude/`）

4. Claude Desktopを完全に再起動

### データベース接続エラー

**症状**: `ECONNREFUSED`または接続タイムアウト

**解決方法**:

1. サービスのヘルスチェック：
   ```bash
   docker inspect context-store-postgres-prod | grep -A 10 Health
   ```

2. 環境変数を確認：
   ```bash
   docker-compose -f docker-compose.prod.yml config
   ```

3. サービスを再起動：
   ```bash
   docker-compose -f docker-compose.prod.yml restart postgres
   ```

### ディスク容量不足

**症状**: データベースの書き込みが失敗する

**解決方法**:

1. ディスク使用量を確認：
   ```bash
   df -h
   docker system df
   ```

2. 古いログを削除：
   ```bash
   docker-compose -f docker-compose.prod.yml logs --tail=0 -f > /dev/null
   ```

3. 不要なDockerリソースを削除：
   ```bash
   docker system prune -a
   ```

4. 古いバックアップを削除：
   ```bash
   find backups/ -mtime +30 -delete  # 30日以上前のバックアップを削除
   ```

### メモリ不足

**症状**: サービスが頻繁に再起動する

**解決方法**:

1. メモリ使用量を確認：
   ```bash
   docker stats
   ```

2. `docker-compose.prod.yml`のメモリ制限を調整

3. Neo4jのヒープサイズを調整（`.env.production.local`）：
   ```bash
   NEO4J_HEAP_INITIAL=256m
   NEO4J_HEAP_MAX=512m
   ```

### パフォーマンスの問題

**症状**: 検索が遅い

**解決方法**:

1. データベースのインデックスを確認：
   ```bash
   docker exec -it context-store-postgres-prod psql -U context_store_user -d context_store
   \di  # インデックス一覧
   ```

2. Redisキャッシュの状態を確認：
   ```bash
   docker exec -it context-store-redis-prod redis-cli -a <password> INFO stats
   ```

3. ベンチマークを実行：
   ```bash
   npm run benchmark
   ```

## 追加リソース

- **[MCP_CLIENT_INTEGRATION.md](./MCP_CLIENT_INTEGRATION.md)**: MCPクライアントとの統合詳細
- **[README.md](./README.md)**: プロジェクト概要
- **[DEPLOYMENT.md](./DEPLOYMENT.md)**: リモート本番環境へのデプロイ
- **[設計書](.kiro/specs/context-store-mcp/design.md)**: システム設計

## サポート

問題が解決しない場合：

1. [GitHub Issues](https://github.com/yohi/context-store-mcp/issues)で検索
2. 新しいIssueを作成（ログとシステム情報を含める）

---

**本番運用を楽しんでください！ 🚀**
