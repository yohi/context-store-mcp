# Lite Mode トラブルシューティングガイド

このドキュメントは、Context Store MCP Lite Modeの一般的な問題と解決策をまとめたものです。

## 目次

- [接続の問題](#接続の問題)
- [設定の問題](#設定の問題)
- [埋め込み生成の問題](#埋め込み生成の問題)
- [パフォーマンスの問題](#パフォーマンスの問題)
- [コレクターの問題](#コレクターの問題)
- [MCP統合の問題](#mcp統合の問題)

## 接続の問題

### PostgreSQL接続エラー

**症状**: `ECONNREFUSED` または `Connection refused` エラー

**原因と解決策**:

1. **PostgreSQLが起動していない**
   ```bash
   # PostgreSQLの状態を確認
   docker-compose ps
   
   # PostgreSQLを起動
   docker-compose --profile lite up -d postgres
   ```

2. **接続情報が間違っている**
   ```bash
   # .envファイルを確認
   cat .env | grep POSTGRES
   
   # 正しい値を設定
   POSTGRES_HOST=localhost
   POSTGRES_PORT=5432
   POSTGRES_USER=context_store
   POSTGRES_PASSWORD=your_password
   POSTGRES_DB=context_store
   ```

3. **ファイアウォールがポートをブロックしている**
   ```bash
   # ポート5432が開いているか確認
   telnet localhost 5432
   
   # または
   nc -zv localhost 5432
   ```

4. **Dockerネットワークの問題**
   ```bash
   # Dockerコンテナから接続する場合
   POSTGRES_HOST=host.docker.internal  # macOS/Windows
   POSTGRES_HOST=172.17.0.1            # Linux
   ```

### タイムアウトエラー

**症状**: `Connection timeout` エラー

**解決策**:

```bash
# PostgreSQLのログを確認
docker-compose logs postgres

# max_connectionsを増やす（必要に応じて）
# docker-compose.ymlで設定
services:
  postgres:
    command: postgres -c max_connections=200
```

## 設定の問題

### 環境変数が認識されない

**症状**: デフォルト値が使用される、または設定エラー

**解決策**:

1. **.envファイルの場所を確認**
   ```bash
   # プロジェクトルートに.envがあるか確認
   ls -la .env
   
   # 内容を確認
   cat .env
   ```

2. **環境変数の優先順位を理解する**
   - システム環境変数 > .envファイル
   - 明示的に設定された環境変数が優先されます

3. **環境変数をエクスポート**
   ```bash
   # 一時的に設定
   export LITE_MODE=true
   export ENABLE_GRAPH_STORE=false
   
   # または.envファイルを読み込む
   source .env
   ```

### 無効な設定値

**症状**: 警告ログ、予期しない動作

**解決策**:

```bash
# 設定を検証
npm run validate-config

# 有効な値を確認
# LITE_MODE: true, false
# ENABLE_GRAPH_STORE: true, false
# ENABLE_REDIS_CACHE: true, false
# EMBEDDING_PROVIDER: openai, local-cli, custom-api
```

## 埋め込み生成の問題

### OpenAI APIエラー

**症状**: `401 Unauthorized` または `429 Rate Limit`

**解決策**:

1. **APIキーを確認**
   ```bash
   # APIキーが設定されているか確認
   echo $OPENAI_API_KEY
   
   # 有効なキーか確認
   curl https://api.openai.com/v1/models \
     -H "Authorization: Bearer $OPENAI_API_KEY"
   ```

2. **レート制限に対処**
   ```bash
   # リクエスト間隔を調整（実装による）
   # または、ローカルCLIに切り替え
   EMBEDDING_PROVIDER=local-cli
   EMBEDDING_CLI_COMMAND="gemini-cli embed"
   ```

### ローカルCLIエラー

**症状**: `Command not found` または `Execution failed`

**解決策**:

1. **CLIツールがインストールされているか確認**
   ```bash
   # コマンドが利用可能か確認
   which gemini-cli
   which claude-code
   
   # テスト実行
   gemini-cli embed "test text"
   ```

2. **コマンドパスを完全指定**
   ```bash
   # 絶対パスを使用
   EMBEDDING_CLI_COMMAND="/usr/local/bin/gemini-cli embed"
   ```

3. **出力フォーマットを確認**
   ```bash
   # CLIの出力がJSON形式か確認
   gemini-cli embed "test" | jq .
   
   # 期待される形式: {"embedding": [0.1, 0.2, ...]}
   ```

### カスタムAPIエラー

**症状**: `ECONNREFUSED` または `Invalid response`

**解決策**:

1. **エンドポイントが稼働しているか確認**
   ```bash
   # エンドポイントをテスト
   curl -X POST http://localhost:8080/embed \
     -H "Content-Type: application/json" \
     -d '{"text":"test"}'
   ```

2. **レスポンス形式を確認**
   ```json
   // 期待される形式
   {
     "embedding": [0.1, 0.2, 0.3, ...]
   }
   ```

3. **ネットワーク設定を確認**
   ```bash
   # ローカルホストの代わりにIPアドレスを使用
   EMBEDDING_API_ENDPOINT=http://192.168.1.100:8080/embed
   ```

## パフォーマンスの問題

### メモリ使用量が高い

**症状**: システムが遅い、メモリ不足エラー

**解決策**:

1. **インメモリキャッシュのサイズを調整**
   ```typescript
   // src/cache/in-memory-cache-adapter.ts
   private maxSize: number = 500; // デフォルト: 1000
   ```

2. **PostgreSQL接続プールを調整**
   ```bash
   # .envファイルで設定
   POSTGRES_MAX_CONNECTIONS=10  # デフォルト: 20
   ```

3. **不要なコレクターを停止**
   ```bash
   # 実行中のコレクタープロセスを確認
   ps aux | grep collector
   
   # 不要なものを停止
   kill <PID>
   ```

### 検索が遅い

**症状**: クエリ応答時間 > 2秒

**解決策**:

1. **PostgreSQLインデックスを確認**
   ```sql
   -- インデックスの状態を確認
   SELECT * FROM pg_indexes WHERE tablename = 'conversations';
   
   -- 必要に応じて再構築
   REINDEX TABLE conversations;
   ```

2. **キャッシュを有効化**
   ```bash
   # Redisが利用可能な場合
   ENABLE_REDIS_CACHE=true
   ```

3. **検索結果の制限を調整**
   ```typescript
   // クエリパラメータで制限
   const results = await search(query, { limit: 10 });
   ```

## コレクターの問題

### ログファイルが検出されない

**症状**: 会話データが収集されない

**解決策**:

1. **ログファイルのパスを確認**
   ```bash
   # Claude Desktopのログパス例
   # macOS
   ~/Library/Logs/Claude/
   
   # Windows
   %APPDATA%\Claude\logs\
   
   # Linux
   ~/.config/Claude/logs/
   ```

2. **ファイルアクセス権限を確認**
   ```bash
   # 読み取り権限があるか確認
   ls -la ~/Library/Logs/Claude/
   
   # 必要に応じて権限を付与
   chmod +r ~/Library/Logs/Claude/*.log
   ```

### 重複データが保存される

**症状**: 同じ会話が複数回保存される

**解決策**:

1. **コレクター状態ファイルを確認**
   ```bash
   # 状態ファイルの場所
   cat ~/.context-store/collector-state.json
   ```

2. **複数のコレクターが実行されていないか確認**
   ```bash
   # 実行中のコレクタープロセスを確認
   ps aux | grep collector
   
   # 重複プロセスを停止
   ```

3. **データベースの重複チェックを確認**
   ```sql
   -- 重複エントリを確認
   SELECT content, COUNT(*) 
   FROM conversations 
   GROUP BY content 
   HAVING COUNT(*) > 1;
   ```

### 解析エラー

**症状**: ログエントリが正しく解析されない

**解決策**:

1. **ログフォーマットを確認**
   ```bash
   # ログファイルの内容を確認
   tail -f ~/Library/Logs/Claude/app.log
   ```

2. **カスタムパーサーを実装**
   ```typescript
   // 特定のログフォーマット用のパーサーを作成
   class CustomCollector extends BaseCollector {
     parseLogEntry(line: string): ConversationEntry | null {
       // カスタム解析ロジック
     }
   }
   ```

## MCP統合の問題

### MCPクライアントがサーバーを認識しない

**症状**: Context Storeが利用可能なツールに表示されない

**解決策**:

1. **MCP設定ファイルを確認**
   ```bash
   # Claude Desktopの設定ファイル
   # macOS
   cat ~/Library/Application\ Support/Claude/claude_desktop_config.json
   
   # Windows
   type %APPDATA%\Claude\claude_desktop_config.json
   
   # Linux
   cat ~/.config/Claude/claude_desktop_config.json
   ```

2. **JSON形式を検証**
   ```bash
   # jqで検証
   cat claude_desktop_config.json | jq .
   
   # エラーがある場合は修正
   ```

3. **MCPクライアントを再起動**
   - Claude Desktopを完全に終了
   - アプリケーションを再起動
   - 設定が読み込まれるまで数秒待つ

### コマンド実行エラー

**症状**: `Command not found` または `Permission denied`

**解決策**:

1. **コマンドパスを確認**
   ```json
   {
     "mcpServers": {
       "context-store": {
         "command": "/usr/local/bin/node",  // 絶対パス
         "args": ["/path/to/context-store/dist/index.js"]
       }
     }
   }
   ```

2. **実行権限を確認**
   ```bash
   # スクリプトに実行権限を付与
   chmod +x dist/index.js
   ```

3. **環境変数を設定**
   ```json
   {
     "mcpServers": {
       "context-store": {
         "command": "node",
         "args": ["dist/index.js"],
         "env": {
           "POSTGRES_HOST": "localhost",
           "POSTGRES_PORT": "5432",
           "LITE_MODE": "true"
         }
       }
     }
   }
   ```

### Docker実行の問題

**症状**: Dockerコンテナが起動しない

**解決策**:

1. **Dockerイメージを確認**
   ```bash
   # イメージが存在するか確認
   docker images | grep context-store-mcp
   
   # 存在しない場合はビルド
   npm run docker:build
   ```

2. **ネットワーク設定を確認**
   ```json
   {
     "mcpServers": {
       "context-store": {
         "command": "docker",
         "args": [
           "run", "--rm", "-i",
           "--network", "host",  // ホストネットワークを使用
           "context-store-mcp:latest"
         ]
       }
     }
   }
   ```

3. **Dockerログを確認**
   ```bash
   # コンテナのログを確認
   docker logs <container_id>
   ```

## ログとデバッグ

### ログレベルの調整

```bash
# デバッグログを有効化
LOG_LEVEL=debug npm start

# または環境変数で設定
export LOG_LEVEL=debug
```

### ログファイルの場所

```bash
# アプリケーションログ
tail -f logs/combined.log
tail -f logs/error.log

# PostgreSQLログ
docker-compose logs -f postgres

# MCPクライアントログ
# Claude Desktop (macOS)
tail -f ~/Library/Logs/Claude/mcp*.log
```

### デバッグモード

```bash
# Node.jsデバッガーを使用
node --inspect dist/index.js

# または
npm run dev  # tsx watchでデバッグ情報を表示
```

## サポートとヘルプ

問題が解決しない場合：

1. **GitHubでIssueを作成**: [Issues](https://github.com/yohi/context-store-mcp/issues)
2. **ログファイルを添付**: `logs/error.log`の関連部分
3. **環境情報を提供**:
   ```bash
   # システム情報を収集
   node --version
   docker --version
   docker-compose --version
   uname -a
   ```

4. **設定を共有**（機密情報を除く）:
   ```bash
   # .envファイル（パスワードを除く）
   cat .env | grep -v PASSWORD
   ```

## 関連ドキュメント

- [README.md](../README.md) - 基本的なセットアップ
- [Lite Mode要件](../.kiro/specs/lite-mode/requirements.md) - 要件定義
- [Lite Mode設計](../.kiro/specs/lite-mode/design.md) - 技術設計
- [マイグレーションガイド](../scripts/LITE_MODE_MIGRATION.md) - 移行手順
