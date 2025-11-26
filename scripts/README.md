# Context Store MCP - 検証スクリプト

このディレクトリには、Context Store MCPシステムの統合検証とヘルスチェックを行うためのスクリプトが含まれています。

---

## スクリプト一覧

### 1. 設定検証スクリプト (`validate-configuration.ts`)

システム設定が正しく構成されているかを自動検証します。

**検証項目**:
- 環境変数の定義と形式
- データベース接続設定
- セキュリティ設定
- パフォーマンス設定
- ファイルシステムの構造
- 依存関係のインストール状況

**実行方法**:
```bash
tsx scripts/validate-configuration.ts
```

**出力例**:
```
================================================================================
Context Store MCP - 設定検証レポート
================================================================================

【環境変数】
--------------------------------------------------------------------------------
  ✓ NODE_ENV                     設定済み
  ✓ POSTGRES_HOST                設定済み
  ✓ POSTGRES_PORT                設定済み
  ...

【データベース設定】
--------------------------------------------------------------------------------
  ✓ PostgreSQLポート             5432
  ✓ Neo4j URI形式                Bolt/Neo4jプロトコル
  ...

サマリー
  合格: 45/50
  失敗: 0/50
  警告: 5/50

  ✓ すべての必須設定が正しく構成されています
```

**終了コード**:
- `0`: すべての必須設定が正しく構成されている
- `1`: 一部の必須設定に問題がある

---

### 2. ヘルスチェックスクリプト (`health-check.ts`)

システムの全コンポーネントが正常に動作しているかをチェックします。

**チェック対象**:
- MCP Server
- Memory Manager
- Query Processor
- PostgreSQL
- Neo4j
- Redis
- Security Components
- Monitoring System
- System Resources

**実行方法**:
```bash
tsx scripts/health-check.ts
```

**出力例**:
```
================================================================================
Context Store MCP - システムヘルスチェックレポート
================================================================================
実行日時: 2025-11-26 (現在時刻)
================================================================================

✓ MCP Server              HEALTHY   
  レイテンシ: 10ms
  メッセージ: MCPサーバーは正常に動作しています
  詳細: {
    "protocol": "MCP v1.0",
    "transport": "stdio"
  }

✓ Memory Manager          HEALTHY   
  レイテンシ: 15ms
  メッセージ: Memory Managerは正常に動作しています
  ...

サマリー
  正常: 9/9
  劣化: 0/9
  異常: 0/9

全体ステータス: HEALTHY
メッセージ: すべてのコンポーネントが正常に動作しています。
```

**終了コード**:
- `0`: すべてのコンポーネントが正常
- `1`: 一部のコンポーネントが異常

---

## 統合テスト

システム全体の統合テストは、Vitestを使用して実行されます。

**実行方法**:
```bash
npm run test -- src/tests/integration/system-integration.test.ts --run
```

**テスト内容**:
1. サービス間連携の確認（4テスト）
2. データフローの完全性検証（3テスト）
3. エラー伝播とリカバリーの確認（4テスト）
4. 設定の最終調整と検証（4テスト）
5. システム全体の健全性チェック（3テスト）

**合計**: 18テスト

---

## CI/CD統合

これらのスクリプトは、CI/CDパイプラインに統合することができます。

### GitHub Actions の例

```yaml
name: Integration Verification

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  verify:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Validate configuration
        run: tsx scripts/validate-configuration.ts
      
      - name: Run integration tests
        run: npm run test -- src/tests/integration/system-integration.test.ts --run
      
      - name: Health check
        run: tsx scripts/health-check.ts
```

---

## トラブルシューティング

### 設定検証が失敗する場合

1. `.env`ファイルが存在し、必須環境変数が設定されているか確認
2. `.env.example`を参考に、不足している環境変数を追加
3. 環境変数の値が正しい形式であるか確認

### ヘルスチェックが失敗する場合

1. データベースサービス（PostgreSQL、Neo4j、Redis）が起動しているか確認
   ```bash
   docker compose ps
   ```

2. サービスが起動していない場合、起動する
   ```bash
   docker compose up -d
   ```

3. 接続設定が正しいか確認
   ```bash
   tsx scripts/validate-configuration.ts
   ```

### 統合テストが失敗する場合

1. 依存関係が正しくインストールされているか確認
   ```bash
   npm install
   ```

2. TypeScriptのコンパイルエラーがないか確認
   ```bash
   npm run typecheck
   ```

3. 個別のテストファイルを実行して問題を特定
   ```bash
   npm run test -- src/tests/integration/system-integration.test.ts --run --reporter=verbose
   ```

---

## 開発ワークフロー

### 日常的な開発

1. コードを変更
2. ユニットテストを実行
   ```bash
   npm run test
   ```

### プルリクエスト前

1. 設定検証を実行
   ```bash
   tsx scripts/validate-configuration.ts
   ```

2. 統合テストを実行
   ```bash
   npm run test -- src/tests/integration/system-integration.test.ts --run
   ```

3. リンティングとフォーマット
   ```bash
   npm run lint
   npm run format
   ```

### デプロイ前

1. 設定検証を実行
   ```bash
   tsx scripts/validate-configuration.ts
   ```

2. 全テストを実行
   ```bash
   npm run test
   ```

3. ヘルスチェックを実行
   ```bash
   tsx scripts/health-check.ts
   ```

4. ビルドを実行
   ```bash
   npm run build
   ```

---

## 関連ドキュメント

- [統合検証レポート](../INTEGRATION_VERIFICATION.md)
- [タスク13.1完了サマリー](../TASK_13.1_COMPLETION_SUMMARY.md)
- [技術スタック](.kiro/steering/tech.md)
- [プロジェクト構造](.kiro/steering/structure.md)

---

**最終更新**: 2025年11月26日
**メンテナー**: Context Store MCP Team
