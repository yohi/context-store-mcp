.PHONY: help up down restart logs ps clean test build dev

# デフォルトターゲット
help:
	@echo "Available commands:"
	@echo "  make up         - Start all Docker containers"
	@echo "  make down       - Stop and remove all containers"
	@echo "  make restart    - Restart all containers"
	@echo "  make logs       - Show logs from all containers"
	@echo "  make ps         - List running containers"
	@echo "  make clean      - Remove all containers, volumes, and networks"
	@echo "  make test       - Run tests"
	@echo "  make build      - Build TypeScript project"
	@echo "  make dev        - Start development server"

# Dockerコンテナ起動
up:
	docker-compose up -d
	@echo "Waiting for services to be healthy..."
	@sleep 5
	@docker-compose ps

# Dockerコンテナ停止・削除
down:
	docker-compose down

# Dockerコンテナ再起動
restart:
	docker-compose restart

# ログ表示
logs:
	docker-compose logs -f

# コンテナ状態確認
ps:
	docker-compose ps

# 完全クリーンアップ
clean:
	docker-compose down -v
	@echo "All containers, volumes, and networks removed."

# テスト実行
test:
	npm test

# ビルド
build:
	npm run build

# 開発サーバー起動
dev:
	npm run dev
