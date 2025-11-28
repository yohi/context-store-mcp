#!/bin/bash

# ============================================
# Context Store MCP - 復元スクリプト
# ============================================

set -e

# 色定義
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# プロジェクトルート
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# 引数チェック
if [ $# -eq 0 ]; then
    echo -e "${RED}エラー: バックアップディレクトリを指定してください${NC}"
    echo "使用方法: $0 <backup-directory>"
    echo ""
    echo "利用可能なバックアップ:"
    ls -1dt backups/*/ 2>/dev/null | head -5 || echo "  バックアップが見つかりません"
    exit 1
fi

BACKUP_PATH="$1"

# バックアップディレクトリの確認
if [ ! -d "$BACKUP_PATH" ]; then
    echo -e "${RED}エラー: バックアップディレクトリが見つかりません: $BACKUP_PATH${NC}"
    exit 1
fi

echo -e "${BLUE}Context Store MCP - バックアップから復元しています...${NC}"
echo "バックアップ元: $BACKUP_PATH"
echo ""

# メタデータの表示
if [ -f "$BACKUP_PATH/metadata.txt" ]; then
    echo -e "${BLUE}バックアップ情報:${NC}"
    cat "$BACKUP_PATH/metadata.txt"
    echo ""
fi

# 確認
echo -e "${YELLOW}警告: 現在のデータは上書きされます${NC}"
echo "復元を続行しますか? (yes/no): "
read -r REPLY
if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "復元をキャンセルしました"
    exit 0
fi

# 環境変数の読み込み
if [ -f ".env.production.local" ]; then
    set -a
    source .env.production.local
    set +a
fi

echo ""
echo -e "${BLUE}[1/5] サービスを停止しています...${NC}"

# サービスの停止
if docker-compose -f docker-compose.prod.yml ps -q 2>/dev/null | grep -q .; then
    docker-compose -f docker-compose.prod.yml down
    echo -e "${GREEN}✓ サービスを停止しました${NC}"
else
    echo -e "${YELLOW}サービスは既に停止しています${NC}"
fi

echo -e "${BLUE}[2/5] データボリュームを削除しています...${NC}"

# データボリュームの削除
docker volume rm context-store-postgres-data 2>/dev/null || true
docker volume rm context-store-neo4j-data 2>/dev/null || true
docker volume rm context-store-redis-data 2>/dev/null || true

echo -e "${GREEN}✓ データボリュームを削除しました${NC}"

echo -e "${BLUE}[3/5] サービスを起動しています...${NC}"

# サービスの起動
docker-compose -f docker-compose.prod.yml up -d

# サービスの起動待機
echo "サービスが起動するまで待機しています..."
sleep 10

echo -e "${GREEN}✓ サービスを起動しました${NC}"

echo -e "${BLUE}[4/5] データを復元しています...${NC}"

# PostgreSQL 復元
if [ -f "$BACKUP_PATH/postgres.sql" ]; then
    echo "PostgreSQLを復元しています..."
    docker exec -i context-store-postgres-prod psql \
        -U "${POSTGRES_USER:-context_store_user}" \
        -d "${POSTGRES_DB:-context_store}" \
        < "$BACKUP_PATH/postgres.sql"
    echo -e "${GREEN}✓ PostgreSQLの復元が完了しました${NC}"
else
    echo -e "${YELLOW}⚠ PostgreSQLバックアップが見つかりません${NC}"
fi

# Neo4j 復元
if [ -f "$BACKUP_PATH/neo4j.tar.gz" ]; then
    echo "Neo4jを復元しています..."
    # Neo4jを停止
    docker-compose -f docker-compose.prod.yml stop neo4j
    # データを復元
    docker cp "$BACKUP_PATH/neo4j.tar.gz" context-store-neo4j-prod:/tmp/
    docker exec context-store-neo4j-prod tar xzf /tmp/neo4j_backup.tar.gz -C /
    docker exec context-store-neo4j-prod rm /tmp/neo4j_backup.tar.gz
    # Neo4jを再起動
    docker-compose -f docker-compose.prod.yml start neo4j
    sleep 5
    echo -e "${GREEN}✓ Neo4jの復元が完了しました${NC}"
else
    echo -e "${YELLOW}⚠ Neo4jバックアップが見つかりません${NC}"
fi

# Redis 復元
if [ -f "$BACKUP_PATH/redis.rdb" ]; then
    echo "Redisを復元しています..."
    # Redisを停止
    docker-compose -f docker-compose.prod.yml stop redis
    # データを復元
    docker cp "$BACKUP_PATH/redis.rdb" context-store-redis-prod:/data/dump.rdb
    # Redisを再起動
    docker-compose -f docker-compose.prod.yml start redis
    sleep 2
    echo -e "${GREEN}✓ Redisの復元が完了しました${NC}"
else
    echo -e "${YELLOW}⚠ Redisバックアップが見つかりません${NC}"
fi

echo -e "${BLUE}[5/5] 整合性を確認しています...${NC}"

# PostgreSQL接続確認
if docker exec context-store-postgres-prod psql \
    -U "${POSTGRES_USER:-context_store_user}" \
    -d "${POSTGRES_DB:-context_store}" \
    -c "SELECT COUNT(*) FROM memories;" > /dev/null 2>&1; then
    MEMORY_COUNT=$(docker exec context-store-postgres-prod psql \
        -U "${POSTGRES_USER:-context_store_user}" \
        -d "${POSTGRES_DB:-context_store}" \
        -t -c "SELECT COUNT(*) FROM memories;" | tr -d ' ')
    echo -e "${GREEN}✓ PostgreSQL: ${MEMORY_COUNT}件の記憶${NC}"
else
    echo -e "${YELLOW}⚠ PostgreSQLの確認に失敗しました${NC}"
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   復元が完了しました！                                    ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}次のステップ:${NC}"
echo "- サービスの状態確認: docker-compose -f docker-compose.prod.yml ps"
echo "- ヘルスチェック: npm run health-check"
echo "- ログ確認: docker-compose -f docker-compose.prod.yml logs -f"
echo ""
