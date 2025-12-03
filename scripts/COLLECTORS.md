# Collector Startup Scripts

このディレクトリには、各種AIツールから会話データを自動収集するコレクターの起動スクリプトが含まれています。

## 概要

コレクターは、AI Desktop App、AI IDE、CLIエージェントのログファイルを監視し、会話データを自動的にContext Store MCPに保存します。これにより、手動での記憶保存が不要になります。

## 利用可能なコレクター

### 1. Desktop App Collector

AI Desktop Applicationからの会話を収集します。

**対応アプリケーション:**
- Claude Desktop
- ChatGPT Desktop
- その他のデスクトップAIアシスタント

**起動方法:**
```bash
npm run collector:desktop-app
```

**必要な環境変数:**
```bash
# Claude Desktop
COLLECTOR_CLAUDE_DESKTOP_LOG_PATH=~/.config/Claude/logs/conversations.log

# ChatGPT Desktop
COLLECTOR_CHATGPT_DESKTOP_LOG_PATH=~/.config/ChatGPT/logs/conversations.log

# PostgreSQL接続情報
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=context_store
POSTGRES_USER=context_store_user
POSTGRES_PASSWORD=your_password

# オプション: ポーリング間隔（ミリ秒）
COLLECTOR_POLL_INTERVAL=1000
```

### 2. AI IDE Collector

AI機能を搭載したIDEからの会話を収集します。

**対応IDE:**
- Cursor
- Windsurf
- GitHub Copilot
- Cline
- その他のAI IDE

**起動方法:**
```bash
npm run collector:ai-ide
```

**必要な環境変数:**
```bash
# Cursor
COLLECTOR_CURSOR_LOG_PATH=~/.cursor/logs/conversations.log

# Windsurf
COLLECTOR_WINDSURF_LOG_PATH=~/.windsurf/logs/conversations.log

# GitHub Copilot
COLLECTOR_COPILOT_LOG_PATH=~/.vscode/extensions/github.copilot/logs/conversations.log

# Cline
COLLECTOR_CLINE_LOG_PATH=~/.cline/logs/conversations.log

# PostgreSQL接続情報
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=context_store
POSTGRES_USER=context_store_user
POSTGRES_PASSWORD=your_password

# オプション: ポーリング間隔（ミリ秒）
COLLECTOR_POLL_INTERVAL=1000
```

### 3. CLI Agent Collector

CLIベースのAIエージェントからの会話を収集します。

**対応エージェント:**
- ClaudeCode
- GeminiCLI
- CodexCLI
- CursorCLI
- その他のCLI AIエージェント

**起動方法:**
```bash
npm run collector:cli-agent
```

**必要な環境変数:**
```bash
# ClaudeCode
COLLECTOR_CLAUDE_CODE_LOG_PATH=~/.claude-code/logs/conversations.log

# GeminiCLI
COLLECTOR_GEMINI_CLI_LOG_PATH=~/.gemini-cli/logs/conversations.log

# CodexCLI
COLLECTOR_CODEX_CLI_LOG_PATH=~/.codex-cli/logs/conversations.log

# CursorCLI
COLLECTOR_CURSOR_CLI_LOG_PATH=~/.cursor-cli/logs/conversations.log

# PostgreSQL接続情報
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=context_store
POSTGRES_USER=context_store_user
POSTGRES_PASSWORD=your_password

# オプション: ポーリング間隔（ミリ秒）
COLLECTOR_POLL_INTERVAL=1000
```

## セットアップ手順

### 1. 環境変数の設定

`.env`ファイルに必要な環境変数を追加します：

```bash
# .envファイルに追加
COLLECTOR_CLAUDE_DESKTOP_LOG_PATH=~/.config/Claude/logs/conversations.log
COLLECTOR_CURSOR_LOG_PATH=~/.cursor/logs/conversations.log
# ... その他のコレクター設定
```

### 2. ログファイルパスの確認

各AIツールのログファイルパスを確認します。パスはツールやOSによって異なる場合があります。

**macOS:**
```bash
# Claude Desktop
~/Library/Application Support/Claude/logs/

# Cursor
~/Library/Application Support/Cursor/logs/
```

**Linux:**
```bash
# Claude Desktop
~/.config/Claude/logs/

# Cursor
~/.config/Cursor/logs/
```

**Windows:**
```powershell
# Claude Desktop
%APPDATA%\Claude\logs\

# Cursor
%APPDATA%\Cursor\logs\
```

### 3. PostgreSQLの起動

コレクターを起動する前に、PostgreSQLが起動していることを確認します：

```bash
# Lite Modeの場合
docker-compose --profile lite up -d

# フルモードの場合
docker-compose --profile full up -d
```

### 4. コレクターの起動

必要なコレクターを起動します：

```bash
# Desktop Appコレクターを起動
npm run collector:desktop-app

# AI IDEコレクターを起動（別のターミナルで）
npm run collector:ai-ide

# CLI Agentコレクターを起動（別のターミナルで）
npm run collector:cli-agent
```

## バックグラウンド実行

### systemd（Linux）

systemdサービスとして実行する場合：

```bash
# サービスファイルを作成
sudo nano /etc/systemd/system/context-store-collector-desktop.service
```

```ini
[Unit]
Description=Context Store Desktop App Collector
After=network.target postgresql.service

[Service]
Type=simple
User=your_username
WorkingDirectory=/path/to/context-store-mcp
Environment="NODE_ENV=production"
EnvironmentFile=/path/to/context-store-mcp/.env
ExecStart=/usr/bin/npm run collector:desktop-app
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# サービスを有効化して起動
sudo systemctl enable context-store-collector-desktop
sudo systemctl start context-store-collector-desktop

# ステータス確認
sudo systemctl status context-store-collector-desktop

# ログ確認
sudo journalctl -u context-store-collector-desktop -f
```

### PM2（クロスプラットフォーム）

PM2を使用してバックグラウンド実行する場合：

```bash
# PM2をインストール
npm install -g pm2

# コレクターを起動
pm2 start npm --name "collector-desktop" -- run collector:desktop-app
pm2 start npm --name "collector-ai-ide" -- run collector:ai-ide
pm2 start npm --name "collector-cli-agent" -- run collector:cli-agent

# ステータス確認
pm2 status

# ログ確認
pm2 logs collector-desktop

# 自動起動設定
pm2 startup
pm2 save
```

### launchd（macOS）

macOSでlaunchdを使用する場合：

```bash
# plistファイルを作成
nano ~/Library/LaunchAgents/com.contextstore.collector.desktop.plist
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.contextstore.collector.desktop</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/npm</string>
        <string>run</string>
        <string>collector:desktop-app</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/context-store-mcp</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/collector-desktop.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/collector-desktop.error.log</string>
</dict>
</plist>
```

```bash
# サービスを読み込んで起動
launchctl load ~/Library/LaunchAgents/com.contextstore.collector.desktop.plist

# ステータス確認
launchctl list | grep contextstore

# サービスを停止
launchctl unload ~/Library/LaunchAgents/com.contextstore.collector.desktop.plist
```

## トラブルシューティング

### コレクターが起動しない

1. **環境変数を確認:**
   ```bash
   env | grep COLLECTOR
   env | grep POSTGRES
   ```

2. **ログファイルパスを確認:**
   ```bash
   ls -la ~/.config/Claude/logs/
   ```

3. **PostgreSQL接続を確認:**
   ```bash
   psql -h localhost -U context_store_user -d context_store
   ```

### データが収集されない

1. **ログファイルの権限を確認:**
   ```bash
   ls -la ~/.config/Claude/logs/conversations.log
   ```

2. **コレクターのログを確認:**
   ```bash
   # PM2の場合
   pm2 logs collector-desktop
   
   # systemdの場合
   sudo journalctl -u context-store-collector-desktop -f
   ```

3. **ログファイルの形式を確認:**
   各AIツールのログ形式が想定通りか確認します。

### 重複データが保存される

コレクターには重複防止メカニズムが組み込まれていますが、問題が発生する場合：

1. **状態ファイルを確認:**
   ```bash
   cat ~/.context-store/collector-state-claude-desktop.json
   ```

2. **状態ファイルをリセット:**
   ```bash
   rm ~/.context-store/collector-state-*.json
   ```

3. **データベースの重複を確認:**
   ```sql
   SELECT content, COUNT(*) 
   FROM conversations 
   GROUP BY content 
   HAVING COUNT(*) > 1;
   ```

## 監視とメンテナンス

### ヘルスチェック

コレクターの動作状態を確認：

```bash
# PM2の場合
pm2 status

# systemdの場合
sudo systemctl status context-store-collector-*
```

### ログローテーション

コレクターのログが大きくなりすぎないように、ログローテーションを設定：

```bash
# /etc/logrotate.d/context-store-collector
/var/log/context-store-collector/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0644 your_username your_username
}
```

### パフォーマンス監視

```bash
# CPU/メモリ使用量を確認
top -p $(pgrep -f collector)

# PM2の場合
pm2 monit
```

## セキュリティ考慮事項

1. **ログファイルの権限:** コレクターは読み取り専用アクセスのみを必要とします
2. **データベース認証情報:** `.env`ファイルの権限を適切に設定（`chmod 600 .env`）
3. **ネットワークアクセス:** コレクターはローカルPostgreSQLへの接続のみを必要とします

## 関連ドキュメント

- [Lite Mode Migration Guide](./LITE_MODE_MIGRATION.md)
- [Lite Mode Troubleshooting](../docs/lite-mode-troubleshooting.md)
- [README - Lite Mode Section](../README.md#lite-mode)
