#!/bin/bash

# ============================================
# Context Store MCP - 本番サーバー起動スクリプト
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

echo -e "${BLUE}Context Store MCP - 本番サーバーを起動しています...${NC}"

# 環境変数ファイルの確認
if [ ! -f ".env.production.local" ]; then
    echo -e "${RED}エラー: .env.production.local が見つかりません${NC}"
    echo "先に ./scripts/setup-production.sh を実行してください"
    exit 1
fi

# 環境変数の読み込み
set -a
source .env.production.local
set +a

echo -e "${BLUE}[1/3] Dockerサービスを起動しています...${NC}"

# サービスの起動
docker-compose -f docker-compose.prod.yml up -d

echo -e "${GREEN}✓ Dockerサービスを起動しました${NC}"

echo -e "${BLUE}[2/3] サービスの起動を待機しています...${NC}"

# ヘルスチェック待機
TIMEOUT=60
ELAPSED=0

while [ $ELAPSED -lt $TIMEOUT ]; do
    HEALTHY_COUNT=$(docker-compose -f docker-compose.prod.yml ps | grep -c "Up (healthy)" || true)
    TOTAL_COUNT=$(docker-compose -f docker-compose.prod.yml ps | grep -c "Up" || true)
    
    if [ "$HEALTHY_COUNT" -ge 3 ]; then
        echo -e "${GREEN}✓ 全サービスが正常に起動しました${NC}"
        break
    fi
    
    sleep 2
    ELAPSED=$((ELAPSED + 2))
    echo -n "."
done
echo ""

if [ $ELAPSED -ge $TIMEOUT ]; then
    echo -e "${YELLOW}警告: 一部のサービスの起動に時間がかかっています${NC}"
    echo "ログを確認してください: docker-compose -f docker-compose.prod.yml logs"
fi

echo -e "${BLUE}[3/3] サービスの状態を確認しています...${NC}"

# サービスの状態表示
docker-compose -f docker-compose.prod.yml ps

echo ""
echo -e "${GREEN}✓ Context Store MCP サーバーが起動しました！${NC}"
echo ""
echo -e "${BLUE}次のステップ:${NC}"
echo "- ヘルスチェック: npm run health-check"
echo "- ログ確認: docker-compose -f docker-compose.prod.yml logs -f"
echo "- 停止: ./scripts/stop-production.sh"
echo ""
