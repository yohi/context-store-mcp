#!/bin/bash

# ============================================
# Context Store MCP - バックアップスクリプト
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

# バックアップディレクトリ
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_ROOT/backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="$BACKUP_DIR/$TIMESTAMP"

echo -e "${BLUE}Context Store MCP - バックアップを作成しています...${NC}"
echo "バックアップ先: $BACKUP_PATH"
echo ""

# バックアップディレクトリの作成
mkdir -p "$BACKUP_PATH"

# 環境変数の読み込み
if [ -f ".env.production.local" ]; then
    set -a
    source .env.production.local
    set +a
fi

# サービスが起動しているか確認
if ! docker-compose -f docker-compose.prod.yml ps -q 2>/dev/null | grep -q .; then
    echo -e "${YELLOW}警告: サービスが起動していません${NC}"
    echo "バックアップを続行しますか? (y/N): "
    read -r REPLY
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "バックアップをキャンセルしました"
        exit 0
    fi
fi

echo -e "${BLUE}[1/4] PostgreSQLのバックアップ...${NC}"

# PostgreSQL バックアップ
if docker ps | grep -q "context-store-postgres-prod"; then
    docker exec context-store-postgres-prod pg_dump \
        -U "${POSTGRES_USER:-context_store_user}" \
        -d "${POSTGRES_DB:-context_store}" \
        > "$BACKUP_PATH/postgres.sql"
    echo -e "${GREEN}✓ PostgreSQLのバックアップが完了しました${NC}"
else
    echo -e "${YELLOW}⚠ PostgreSQLコンテナが見つかりません${NC}"
fi

echo -e "${BLUE}[2/4] Neo4jのバックアップ...${NC}"

# Neo4j バックアップ
if docker ps | grep -q "context-store-neo4j-prod"; then
    # Neo4jデータディレクトリをtarで圧縮
    docker exec context-store-neo4j-prod tar czf /tmp/neo4j_backup.tar.gz /data
    docker cp context-store-neo4j-prod:/tmp/neo4j_backup.tar.gz "$BACKUP_PATH/neo4j.tar.gz"
    docker exec context-store-neo4j-prod rm /tmp/neo4j_backup.tar.gz
    echo -e "${GREEN}✓ Neo4jのバックアップが完了しました${NC}"
else
    echo -e "${YELLOW}⚠ Neo4jコンテナが見つかりません${NC}"
fi

echo -e "${BLUE}[3/4] Redisのバックアップ...${NC}"

# Redis バックアップ
if docker ps | grep -q "context-store-redis-prod"; then
    # Redisに保存を強制（REDISCLI_AUTH 経由でパスワードを渡す）
    docker exec -e "REDISCLI_AUTH=${REDIS_PASSWORD:-changeme}" context-store-redis-prod redis-cli SAVE 2>/dev/null || true
    docker cp context-store-redis-prod:/data/dump.rdb "$BACKUP_PATH/redis.rdb"
    echo -e "${GREEN}✓ Redisのバックアップが完了しました${NC}"
else
    echo -e "${YELLOW}⚠ Redisコンテナが見つかりません${NC}"
fi

echo -e "${BLUE}[4/4] メタデータの保存...${NC}"

# メタデータファイルの作成
cat > "$BACKUP_PATH/metadata.txt" << EOF
Backup Information
==================
Date: $(date)
Timestamp: $TIMESTAMP
Version: $(git describe --tags --always 2>/dev/null || echo "unknown")
Commit: $(git rev-parse HEAD 2>/dev/null || echo "unknown")

Database Versions:
- PostgreSQL: $(docker exec context-store-postgres-prod psql -V 2>/dev/null || echo "unknown")
- Neo4j: $(docker exec context-store-neo4j-prod neo4j --version 2>/dev/null || echo "unknown")
- Redis: $(docker exec context-store-redis-prod redis-server --version 2>/dev/null || echo "unknown")

Backup Contents:
$(ls -lh "$BACKUP_PATH")
EOF

echo -e "${GREEN}✓ メタデータを保存しました${NC}"

# バックアップサイズの計算
BACKUP_SIZE=$(du -sh "$BACKUP_PATH" | cut -f1)

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   バックアップが完了しました！                            ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}バックアップ情報:${NC}"
echo "  場所: $BACKUP_PATH"
echo "  サイズ: $BACKUP_SIZE"
echo "  タイムスタンプ: $TIMESTAMP"
echo ""
echo -e "${BLUE}バックアップ内容:${NC}"
ls -lh "$BACKUP_PATH"
echo ""
echo -e "${BLUE}復元方法:${NC}"
echo "  ./scripts/restore-production.sh $BACKUP_PATH"
echo ""

# 古いバックアップの削除（オプション）
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-30}
echo -e "${YELLOW}古いバックアップのクリーンアップ（${RETENTION_DAYS}日以上前）...${NC}"
find "$BACKUP_DIR" -maxdepth 1 -type d -mtime +$RETENTION_DAYS -exec rm -rf {} \; 2>/dev/null || true
echo -e "${GREEN}✓ クリーンアップが完了しました${NC}"
echo ""
