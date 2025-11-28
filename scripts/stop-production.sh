#!/bin/bash

# ============================================
# Context Store MCP - 本番サーバー停止スクリプト
# ============================================

set -e

# 色定義
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# プロジェクトルート
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo -e "${BLUE}Context Store MCP - 本番サーバーを停止しています...${NC}"

# サービスが起動しているか確認
if ! docker-compose -f docker-compose.prod.yml ps -q 2>/dev/null | grep -q .; then
    echo -e "${YELLOW}サービスは既に停止しています${NC}"
    exit 0
fi

echo -e "${BLUE}[1/2] グレースフルシャットダウンを実行しています...${NC}"

# サービスの停止
docker-compose -f docker-compose.prod.yml down

echo -e "${GREEN}✓ サービスを停止しました${NC}"

echo -e "${BLUE}[2/2] データの永続化を確認しています...${NC}"

# ボリュームが保持されているか確認
VOLUMES=$(docker volume ls | grep -c "context-store" || true)
if [ "$VOLUMES" -gt 0 ]; then
    echo -e "${GREEN}✓ データボリュームは保持されています（${VOLUMES}個）${NC}"
else
    echo -e "${YELLOW}警告: データボリュームが見つかりません${NC}"
fi

echo ""
echo -e "${GREEN}✓ Context Store MCP サーバーを停止しました${NC}"
echo ""
echo -e "${BLUE}次のステップ:${NC}"
echo "- 再起動: ./scripts/start-production.sh"
echo "- バックアップ: ./scripts/backup-production.sh"
echo ""
echo -e "${YELLOW}注意: データは保持されています。完全に削除する場合は:${NC}"
echo "  docker-compose -f docker-compose.prod.yml down -v"
echo ""
