#!/bin/bash

# Context Store MCP デプロイメントスクリプト
# このスクリプトはContext Store MCPシステムのデプロイを処理します

set -e  # エラー時に終了

# 出力用の色設定
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # 色なし

# 設定
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${PROJECT_ROOT}/.env.production"

# 関数定義
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Dockerの確認
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    # Docker Composeの確認とラッパー変数の設定
    if command -v docker-compose &> /dev/null; then
        DOCKER_COMPOSE_BIN="docker-compose"
        log_info "Using docker-compose (v1)"
    elif docker compose version &> /dev/null; then
        DOCKER_COMPOSE_BIN="docker compose"
        log_info "Using docker compose (v2 plugin)"
    else
        log_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    # Node.jsの確認
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed. Please install Node.js 20+ first."
        exit 1
    fi
    
    # 環境変数ファイルの確認
    if [ ! -f "$ENV_FILE" ]; then
        log_error "Production environment file not found: $ENV_FILE"
        log_info "Please copy .env.production.example to .env.production and configure it."
        exit 1
    fi
    
    log_info "All prerequisites met."
}

validate_environment() {
    log_info "Validating environment configuration..."
    
    # 環境変数ファイルの読み込み
    set -a
    source "$ENV_FILE"
    set +a
    
    # 必須変数の確認
    REQUIRED_VARS=(
        "POSTGRES_PASSWORD"
        "NEO4J_PASSWORD"
        "REDIS_PASSWORD"
        "OPENAI_API_KEY"
        "SIGNATURE_SECRET"
    )
    
    for var in "${REQUIRED_VARS[@]}"; do
        if [ -z "${!var}" ] || [[ "${!var}" == *"CHANGE_ME"* ]]; then
            log_error "Required environment variable $var is not set or contains default value."
            exit 1
        fi
    done
    
    log_info "Environment configuration validated."
}

run_security_scan() {
    log_info "Running security scan..."
    
    cd "$PROJECT_ROOT"
    
    # npm auditの実行
    if npm audit --production --audit-level=high; then
        log_info "No high-severity vulnerabilities found."
    else
        log_warn "Security vulnerabilities detected. Please review and fix before deploying."
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

build_application() {
    log_info "Building application..."
    
    cd "$PROJECT_ROOT"
    
    # 依存関係のインストール
    log_info "Installing dependencies..."
    npm ci --omit=dev
    
    # TypeScriptのビルド
    log_info "Compiling TypeScript..."
    npm run build
    
    # ビルドの検証
    if [ ! -f "dist/index.js" ]; then
        log_error "Build failed: dist/index.js not found."
        exit 1
    fi
    
    log_info "Application built successfully."
}

build_docker_image() {
    log_info "Building Docker image..."
    
    cd "$PROJECT_ROOT"
    
    # イメージのビルド
    docker build -t "context-store-mcp:latest" -t "context-store-mcp:$(date +%Y%m%d-%H%M%S)" .
    
    log_info "Docker image built successfully."
}

run_tests() {
    log_info "Running tests..."
    
    cd "$PROJECT_ROOT"
    
    # ユニットテストの実行
    if npm test -- --run; then
        log_info "All tests passed."
    else
        log_error "Tests failed. Please fix before deploying."
        exit 1
    fi
}

deploy_services() {
    log_info "Deploying services..."
    
    cd "$PROJECT_ROOT"
    
    # 既存サービスの停止
    log_info "Stopping existing services..."
    $DOCKER_COMPOSE_BIN -f docker-compose.prod.yml down
    
    # サービスの開始
    log_info "Starting services..."
    $DOCKER_COMPOSE_BIN -f docker-compose.prod.yml up -d
    
    # サービスの健全性を待機
    log_info "Waiting for services to be healthy..."
    sleep 10
    
    # サービスの健全性確認
    if $DOCKER_COMPOSE_BIN -f docker-compose.prod.yml ps | grep -q "unhealthy"; then
        log_error "Some services are unhealthy. Please check logs."
        $DOCKER_COMPOSE_BIN -f docker-compose.prod.yml ps
        exit 1
    fi
    
    log_info "Services deployed successfully."
}

run_health_check() {
    log_info "Running health check..."
    
    cd "$PROJECT_ROOT"
    
    # アプリケーションの起動待機
    sleep 5
    
    # ヘルスチェック・スクリプトの実行
    if npx tsx scripts/health-check.ts; then
        log_info "Health check passed."
    else
        log_warn "Health check failed. Please verify manually."
    fi
}

show_status() {
    log_info "Deployment Status:"
    echo ""
    $DOCKER_COMPOSE_BIN -f "$PROJECT_ROOT/docker-compose.prod.yml" ps
    echo ""
    log_info "Logs can be viewed with: $DOCKER_COMPOSE_BIN -f docker-compose.prod.yml logs -f"
}

# メインデプロイフロー
main() {
    log_info "Starting Context Store MCP deployment..."
    echo ""
    
    check_prerequisites
    validate_environment
    run_security_scan
    build_application
    build_docker_image
    run_tests
    deploy_services
    run_health_check
    show_status
    
    echo ""
    log_info "Deployment completed successfully!"
    log_info "Application is running at http://localhost:${APP_PORT:-3000}"
}

# メイン関数の実行
main "$@"
