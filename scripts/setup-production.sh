#!/bin/bash

# ============================================
# Context Store MCP - ローカル本番環境セットアップスクリプト
# ============================================
# このスクリプトはローカルマシンで本番サーバーを初回セットアップします

set -e  # エラーで停止

# 色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ロゴ表示
echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║   Context Store MCP - ローカル本番環境セットアップ        ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# プロジェクトルートディレクトリ
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo -e "${BLUE}[1/7] 依存関係のチェック...${NC}"

# Docker のチェック
if ! command -v docker &> /dev/null; then
    echo -e "${RED}エラー: Docker がインストールされていません${NC}"
    echo "https://docs.docker.com/get-docker/ からインストールしてください"
    exit 1
fi
echo -e "${GREEN}✓ Docker: $(docker --version)${NC}"

# Docker Compose のチェック
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}エラー: Docker Compose がインストールされていません${NC}"
    echo "https://docs.docker.com/compose/install/ からインストールしてください"
    exit 1
fi
echo -e "${GREEN}✓ Docker Compose: $(docker-compose --version)${NC}"

# Docker が起動しているかチェック
if ! docker info &> /dev/null; then
    echo -e "${RED}エラー: Docker が起動していません${NC}"
    echo "Docker を起動してから再度実行してください"
    exit 1
fi
echo -e "${GREEN}✓ Docker is running${NC}"

echo ""
echo -e "${BLUE}[2/7] 環境変数ファイルの作成...${NC}"

# .env.production.local の作成
if [ -f ".env.production.local" ]; then
    echo -e "${YELLOW}警告: .env.production.local は既に存在します${NC}"
    read -p "上書きしますか? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "既存の .env.production.local を使用します"
    else
        cp .env.production.local.example .env.production.local
        echo -e "${GREEN}✓ .env.production.local を作成しました${NC}"
    fi
else
    cp .env.production.local.example .env.production.local
    echo -e "${GREEN}✓ .env.production.local を作成しました${NC}"
fi

echo ""
echo -e "${BLUE}[3/7] 強固なパスワードの生成...${NC}"

# パスワード生成関数
generate_password() {
    openssl rand -base64 32 | tr -d "=+/" | cut -c1-32
}

# パスワード生成
POSTGRES_PASSWORD=$(generate_password)
NEO4J_PASSWORD=$(generate_password)
REDIS_PASSWORD=$(generate_password)
SIGNATURE_SECRET=$(generate_password)

echo -e "${GREEN}✓ パスワードを生成しました${NC}"

# .env.production.local にパスワードを設定
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$POSTGRES_PASSWORD/" .env.production.local
    sed -i '' "s/NEO4J_PASSWORD=.*/NEO4J_PASSWORD=$NEO4J_PASSWORD/" .env.production.local
    sed -i '' "s/REDIS_PASSWORD=.*/REDIS_PASSWORD=$REDIS_PASSWORD/" .env.production.local
    sed -i '' "s/SIGNATURE_SECRET=.*/SIGNATURE_SECRET=$SIGNATURE_SECRET/" .env.production.local
else
    # Linux
    sed -i "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$POSTGRES_PASSWORD/" .env.production.local
    sed -i "s/NEO4J_PASSWORD=.*/NEO4J_PASSWORD=$NEO4J_PASSWORD/" .env.production.local
    sed -i "s/REDIS_PASSWORD=.*/REDIS_PASSWORD=$REDIS_PASSWORD/" .env.production.local
    sed -i "s/SIGNATURE_SECRET=.*/SIGNATURE_SECRET=$SIGNATURE_SECRET/" .env.production.local
fi

echo -e "${GREEN}✓ パスワードを .env.production.local に設定しました${NC}"

echo ""
echo -e "${BLUE}[4/7] OpenAI API Key の設定...${NC}"

# OpenAI API Key のチェック
if grep -q "OPENAI_API_KEY=sk-your-api-key-here" .env.production.local; then
    echo -e "${YELLOW}警告: OpenAI API Key が設定されていません${NC}"
    echo "OpenAI API Key を入力してください（https://platform.openai.com/api-keys から取得）:"
    read -r OPENAI_API_KEY
    
    if [ -n "$OPENAI_API_KEY" ]; then
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/OPENAI_API_KEY=.*/OPENAI_API_KEY=$OPENAI_API_KEY/" .env.production.local
        else
            sed -i "s/OPENAI_API_KEY=.*/OPENAI_API_KEY=$OPENAI_API_KEY/" .env.production.local
        fi
        echo -e "${GREEN}✓ OpenAI API Key を設定しました${NC}"
    else
        echo -e "${YELLOW}スキップしました。後で .env.production.local を編集してください${NC}"
    fi
else
    echo -e "${GREEN}✓ OpenAI API Key は既に設定されています${NC}"
fi

echo ""
echo -e "${BLUE}[5/7] Dockerサービスの起動...${NC}"

# 既存のコンテナを停止
if docker-compose -f docker-compose.prod.yml ps -q 2>/dev/null | grep -q .; then
    echo "既存のコンテナを停止しています..."
    docker-compose -f docker-compose.prod.yml down
fi

# サービスの起動
echo "Dockerサービスを起動しています..."
docker-compose -f docker-compose.prod.yml up -d

echo -e "${GREEN}✓ Dockerサービスを起動しました${NC}"

echo ""
echo -e "${BLUE}[6/7] サービスの起動待機...${NC}"

# ヘルスチェック待機
echo "サービスが起動するまで待機しています（最大60秒）..."
TIMEOUT=60
ELAPSED=0

while [ $ELAPSED -lt $TIMEOUT ]; do
    if docker-compose -f docker-compose.prod.yml ps | grep -q "Up (healthy)"; then
        echo -e "${GREEN}✓ サービスが起動しました${NC}"
        break
    fi
    sleep 2
    ELAPSED=$((ELAPSED + 2))
    echo -n "."
done
echo ""

if [ $ELAPSED -ge $TIMEOUT ]; then
    echo -e "${YELLOW}警告: サービスの起動に時間がかかっています${NC}"
    echo "docker-compose -f docker-compose.prod.yml logs でログを確認してください"
fi

echo ""
echo -e "${BLUE}[7/7] 最終確認...${NC}"

# サービスの状態表示
docker-compose -f docker-compose.prod.yml ps

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   セットアップが完了しました！                            ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}次のステップ:${NC}"
echo ""
echo "1. サービスの状態を確認:"
echo "   docker-compose -f docker-compose.prod.yml ps"
echo ""
echo "2. MCPクライアント（Claude Desktop等）を設定:"
echo "   LOCAL_PRODUCTION.md の「MCPクライアント統合」セクションを参照"
echo ""
echo "3. バックアップを設定:"
echo "   ./scripts/backup-production.sh"
echo ""
echo -e "${YELLOW}重要な情報:${NC}"
echo "- 生成されたパスワードは .env.production.local に保存されています"
echo "- このファイルは安全に保管してください"
echo "- 定期的にバックアップを取ることを推奨します"
echo ""
echo -e "${BLUE}サポート:${NC}"
echo "- ドキュメント: LOCAL_PRODUCTION.md"
echo "- トラブルシューティング: LOCAL_PRODUCTION.md#トラブルシューティング"
echo ""
