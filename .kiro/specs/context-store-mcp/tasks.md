# 実装計画

## プロジェクト基盤

- [ ] 1. プロジェクトの基盤構築とインフラストラクチャのセットアップ
- [ ] 1.1 Node.jsプロジェクトの初期化と必要パッケージの導入
  - TypeScript環境の設定と型定義の準備
  - MCPサーバーSDKのインストールと設定
  - データベースドライバーとORMツールの導入
  - ロギングとユーティリティライブラリのセットアップ
  - 開発ツールとLintルールの設定
  - _Requirements: 全要件の基盤となる環境構築_

- [ ] 1.2 Docker Compose環境の構築と起動確認
  - PostgreSQLとpgvector拡張のセットアップ
  - Neo4j Community Editionの設定と初期化
  - Redisキャッシュサーバーの構成
  - ボリュームマウントとネットワーク設定
  - 環境変数の管理と.envファイルの作成
  - _Requirements: 5.1, 5.2_

- [ ] 1.3 データベーススキーマの初期化とマイグレーション
  - PostgreSQLのテーブル定義とインデックス作成
  - pgvectorの有効化と設定
  - Neo4jのノードとリレーション制約の定義
  - 初期データとテストデータの投入スクリプト
  - マイグレーション管理の仕組み構築
  - _Requirements: 5.1, 5.2, 5.4_

## MCPプロトコル実装

- [ ] 2. MCPサーバーの基本実装とプロトコル準拠
- [ ] 2.1 MCPサーバーのコア機能実装
  - MCP標準に準拠したサーバー初期化処理
  - JSON-RPCハンドラーの実装
  - トランスポート層の設定（stdio/HTTP）
  - セッション管理とライフサイクル処理
  - エラーハンドリングとレスポンス標準化（詳細は2.1.1参照）
  - _Requirements: 4.1, 4.2, 4.3_

- [ ] 2.1.1 エラーハンドリングとレスポンス標準化の詳細実装
  - **必須MCPエラーコードの実装:**
    - `-32700`: Parse Error（不正なJSON）
    - `-32600`: Invalid Request（JSON-RPC仕様違反）
    - `-32601`: Method Not Found（存在しないツール呼び出し）
    - `-32602`: Invalid Params（パラメータ検証失敗）
    - `-32603`: Internal Error（サーバー内部エラー）
    - `-32001`: Timeout Error（データベースタイムアウト、外部API呼び出しタイムアウト）
    - `-32002`: Authentication Failed（APIキー不正、セッショントークン無効）
    - `-32003`: Rate Limit Exceeded（レート制限超過: 100req/min/client）
    - `-32004`: Resource Not Found（指定された記憶IDが存在しない）
    - `-32005`: Storage Error（PostgreSQL/Neo4j接続失敗、書き込み失敗）
    - `-32006`: Validation Error（スキーマ検証失敗、制約違反）

  - **測定可能なSLAターゲット:**
    - **レスポンスタイム:**
      - p50（中央値）: ≤ 100ms（全ツール呼び出し）
      - p95（95パーセンタイル）: ≤ 500ms（ベクトル検索含む）
      - p99（99パーセンタイル）: ≤ 2000ms（複雑なグラフクエリ）
    - **タイムアウト閾値:**
      - データベースクエリ: 5秒（PostgreSQL）、3秒（Neo4j）
      - 外部API呼び出し（OpenAI埋め込み）: 10秒
      - JSON-RPCリクエスト全体: 15秒
    - **可用性:** 99.9%（月間ダウンタイム ≤ 43分）
    - **エラー率:** 全リクエストの1%未満（5xx相当のInternal Error）

  - **例外シナリオと標準化レスポンス:**

    **1. タイムアウトエラー（-32001）**
    ```json
    {
      "jsonrpc": "2.0",
      "id": "req-123",
      "error": {
        "code": -32001,
        "message": "Request timeout",
        "data": {
          "timeout_ms": 5000,
          "operation": "vector_search",
          "query": "user's search query...",
          "retryable": true,
          "retry_after_ms": 1000
        }
      }
    }
    ```
    - HTTP Status: 504 Gateway Timeout（HTTP transport使用時）
    - Retry Strategy: 指数バックオフ（1s, 2s, 4s）、最大3回

    **2. 認証失敗（-32002）**
    ```json
    {
      "jsonrpc": "2.0",
      "id": "req-456",
      "error": {
        "code": -32002,
        "message": "Authentication failed",
        "data": {
          "reason": "invalid_api_key",
          "hint": "Please check your MCP server configuration",
          "retryable": false
        }
      }
    }
    ```
    - HTTP Status: 401 Unauthorized
    - Retry Strategy: 再試行不可、クライアント設定の修正が必要

    **3. レート制限超過（-32003）**
    ```json
    {
      "jsonrpc": "2.0",
      "id": "req-789",
      "error": {
        "code": -32003,
        "message": "Rate limit exceeded",
        "data": {
          "limit": 100,
          "window_seconds": 60,
          "retry_after_seconds": 45,
          "current_usage": 102,
          "retryable": true
        }
      }
    }
    ```
    - HTTP Status: 429 Too Many Requests
    - Retry Strategy: `retry_after_seconds`後に再試行

    **4. 不正なリクエスト（-32602）**
    ```json
    {
      "jsonrpc": "2.0",
      "id": "req-101",
      "error": {
        "code": -32602,
        "message": "Invalid params",
        "data": {
          "validation_errors": [
            {
              "field": "query",
              "constraint": "minLength",
              "expected": 1,
              "actual": 0,
              "message": "Query must not be empty"
            },
            {
              "field": "limit",
              "constraint": "maximum",
              "expected": 100,
              "actual": 500,
              "message": "Limit must be ≤ 100"
            }
          ],
          "retryable": false
        }
      }
    }
    ```
    - HTTP Status: 400 Bad Request
    - Retry Strategy: 再試行不可、クライアントが修正必要

    **5. リソース未検出（-32004）**
    ```json
    {
      "jsonrpc": "2.0",
      "id": "req-202",
      "error": {
        "code": -32004,
        "message": "Resource not found",
        "data": {
          "resource_type": "memory",
          "resource_id": "550e8400-e29b-41d4-a716-446655440000",
          "retryable": false,
          "suggestion": "Use search_memory to find existing memories"
        }
      }
    }
    ```
    - HTTP Status: 404 Not Found
    - Retry Strategy: 再試行不可

    **6. ストレージエラー（-32005）**
    ```json
    {
      "jsonrpc": "2.0",
      "id": "req-303",
      "error": {
        "code": -32005,
        "message": "Storage error",
        "data": {
          "storage_type": "postgresql",
          "operation": "insert",
          "error_detail": "Connection pool exhausted",
          "retryable": true,
          "retry_after_ms": 2000,
          "incident_id": "inc-20250118-001"
        }
      }
    }
    ```
    - HTTP Status: 503 Service Unavailable
    - Retry Strategy: 指数バックオフ（2s, 4s, 8s）、最大3回

    **7. 内部エラー（-32603）**
    ```json
    {
      "jsonrpc": "2.0",
      "id": "req-404",
      "error": {
        "code": -32603,
        "message": "Internal server error",
        "data": {
          "error_id": "err-20250118-123456",
          "timestamp": "2025-01-18T10:30:00Z",
          "retryable": true,
          "support_contact": "context-store-support@example.com"
        }
      }
    }
    ```
    - HTTP Status: 500 Internal Server Error
    - Retry Strategy: 指数バックオフ（1s, 2s, 4s）、最大3回
    - Note: スタックトレースは本番環境では含めない（ログのみ）

  - **実装チェックリスト:**
    - [ ] 全MCPエラーコード（-32700 ~ -32006）のエラークラス実装
    - [ ] エラーレスポンスビルダーの実装（standardized shape保証）
    - [ ] グローバルエラーハンドラーミドルウェアの実装
    - [ ] タイムアウト制御（Promise.race with timeout）の実装
    - [ ] レート制限ミドルウェア（Redis使用、Token Bucket algorithm）の実装
    - [ ] リクエストバリデーション（JSON Schema or Zod）の実装
    - [ ] Circuit Breaker パターンの実装（PostgreSQL/Neo4j/OpenAI用）
    - [ ] エラーメトリクスの記録（Prometheusカウンター: `mcp_errors_total{code, operation}`）
    - [ ] レスポンスタイムヒストグラム（Prometheus: `mcp_request_duration_seconds{operation, quantile}`）

    - [ ] **ユニットテスト（各エラーケース）:**
      - [ ] タイムアウトエラーのシミュレーションと検証（遅延モックDB）
      - [ ] 無効なAPIキーによる認証失敗テスト
      - [ ] レート制限超過シナリオのテスト（連続リクエスト）
      - [ ] 不正なパラメータ（空文字列、範囲外値）のバリデーションテスト
      - [ ] 存在しない記憶IDでの404エラーテスト
      - [ ] データベース接続失敗シミュレーションテスト
      - [ ] 予期しない例外からの-32603変換テスト

    - [ ] **統合テスト（E2E）:**
      - [ ] 実PostgreSQL/Neo4jタイムアウトシナリオ（接続プール枯渇）
      - [ ] OpenAI API障害時のフォールバック動作テスト
      - [ ] 並行リクエストによるレート制限テスト
      - [ ] 不正なJSON-RPCペイロードの拒否テスト
      - [ ] エラー発生時のロールバック検証（トランザクション整合性）

    - [ ] **サンプルペイロード（テストフィクスチャ）:**
      - [ ] 各エラーケースの入力ペイロード例（`test/fixtures/error-cases/`）
      - [ ] 期待されるエラーレスポンスのスナップショット（`test/snapshots/`）
      - [ ] パフォーマンステスト用の負荷ペイロード（k6/Artillery script）

  - _Requirements: 4.3（無効なリクエスト処理）, 7.1（レスポンスタイムSLA）_

- [ ] 2.2 ツールとリソースの定義と公開
  - store_memoryツールの定義とスキーマ作成
  - search_memoryツールの定義とパラメータ検証
  - delete_memoryとupdate_memoryツールの実装
  - memory_statsリソースの公開設定
  - ケーパビリティの宣言と応答処理
  - _Requirements: 4.4, 4.5, 4.6_

## 記憶管理システム

- [ ] 3. 記憶の永続化と管理機能の実装
- [ ] 3.1 Memory Managerサービスの基本実装
  - 記憶の保存処理とトランザクション管理
  - メタデータの処理と検証ロジック
  - UUIDの生成と一意性保証
  - タイムスタンプの自動付与と管理
  - データ整合性のチェック機構
  - _Requirements: 1.1, 1.2, 1.6_

- [ ] 3.2 記憶の更新、削除、マージ機能
  - 既存記憶の更新処理と履歴管理
  - 論理削除と物理削除の実装
  - 関連記憶の自動検出とマージ提案
  - カスケード処理と参照整合性の維持
  - ガベージコレクションの実装
  - _Requirements: 1.3, 1.4, 1.5_

## 記憶タイプ分類

- [ ] 4. 多層的記憶タイプの分類システム
- [ ] 4.1 Memory Type Classifierの実装
  - コンテンツ解析による自動分類ロジック
  - エピソード記憶の識別と処理
  - 意味記憶の識別と処理
  - 手続き記憶の識別と処理
  - 信頼度スコアの算出アルゴリズム
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 4.2 記憶タイプ間の関連付けと管理
  - タイプ間のリンク生成と維持
  - 相互参照の管理と更新
  - タイプ別のストレージ振り分け処理
  - タイプフィルタリング機能の実装
  - メタデータによるタイプ上書き機能
  - _Requirements: 3.5, 3.6_

## ベクトル検索実装

- [ ] 5. ベクトルストレージと意味的検索の構築
- [ ] 5.1 Vector Store Adapterの実装
  - OpenAI埋め込みAPIとの統合
  - ベクトル生成と正規化処理
  - PostgreSQLへのベクトル保存処理
  - HNSWインデックスの構築と最適化
  - バッチ処理による効率化
  - _Requirements: 2.1, 5.1_

- [ ] 5.2 類似性検索とランキング機能
  - コサイン類似度による検索実装
  - 閾値フィルタリングと結果制限
  - スコアリングアルゴリズムの実装
  - 検索結果のランキング処理
  - メタデータフィルタの適用
  - _Requirements: 2.3, 2.5_

## グラフデータベース統合

- [ ] 6. グラフストレージと構造的検索の実装
- [ ] 6.1 Graph Store Adapterの基本実装
  - Neo4jドライバーの接続管理
  - ノードの作成、更新、削除処理
  - プロパティの管理と検証
  - トランザクション処理の実装
  - エラーハンドリングとリトライ
  - _Requirements: 5.2, 5.3_

- [ ] 6.2 関係性の管理とグラフトラバーサル
  - リレーションシップの作成と削除
  - Cypherクエリの生成と実行
  - パスファインディングアルゴリズム
  - コミュニティ検出の実装
  - 中心性計算とグラフ分析
  - _Requirements: 2.1, 5.2_

## クエリ処理システム

- [ ] 7. 高度な検索とクエリ最適化の実装
- [ ] 7.1 Query Processorの基本機能
  - 自然言語クエリの解析処理
  - 時間フィルタの解釈と適用
  - タグとメタデータによるフィルタリング
  - クエリプランの生成と最適化
  - 検索戦略の自動選択
  - _Requirements: 2.2, 2.4, 2.6_

- [ ] 7.2 ハイブリッド検索とキャッシング
  - ベクトル検索とグラフ検索の統合
  - 重み付けによる結果のマージ
  - Redisキャッシュの実装と管理
  - キャッシュヒット率の最適化
  - TTLとキャッシュ無効化戦略
  - _Requirements: 2.1, 2.3, 2.5_

## セキュリティとアクセス制御

- [ ] 8. セキュリティ機能とデータ保護の実装
- [ ] 8.1 認証と暗号化の実装
  - MCP標準認証メカニズムの実装
  - APIキー管理と検証処理
  - データ暗号化の設定と実装
  - TLS通信の設定と証明書管理
  - セッションセキュリティの強化
  - _Requirements: 6.1, 6.2, 6.3_

- [ ] 8.2 監査ログとアクセス制御
  - アクセスログの記録システム
  - 監査証跡の永続化と管理
  - ユーザー別アクセス制御の実装
  - GDPR準拠の削除機能実装
  - セキュリティイベントの通知機能
  - _Requirements: 6.4, 6.5, 6.6_

## パフォーマンス最適化

- [ ] 9. パフォーマンス向上とスケーラビリティの実装
- [ ] 9.1 パフォーマンスチューニング
  - データベース接続プーリングの最適化
  - 非同期処理とバックグラウンドジョブ
  - インデックスの最適化と再構築
  - クエリ最適化とEXPLAIN分析
  - バッチ処理の並列化
  - _Requirements: 7.1, 7.3, 7.5_

- [ ] 9.2 スケーラビリティと自動化
  - オートスケーリングのトリガー設定
  - パーティショニング戦略の実装
  - リソース使用量の自動調整
  - 性能劣化の自動検知と対処
  - バックグラウンド最適化処理
  - _Requirements: 7.2, 7.4, 7.6_

## 監視と運用

- [ ] 10. システム監視と運用管理機能の実装
- [ ] 10.1 メトリクス収集と監視
  - Prometheusメトリクスの実装
  - CPU、メモリ、ディスク使用率の記録
  - レスポンスタイムの計測と記録
  - エラー率とスループットの監視
  - カスタムメトリクスの定義
  - _Requirements: 8.1, 8.2, 8.3_

- [ ] 10.2 ログ管理とメンテナンス機能
  - 構造化ログの実装（Winston）
  - エラートレースとスタック情報の記録
  - ヘルスチェックエンドポイントの実装
  - メンテナンスモードの実装
  - 自動バックアップとリストア機能
  - _Requirements: 8.4, 8.5, 8.6_

## テストとバリデーション

- [ ] 11. 包括的なテストスイートの実装
- [ ] 11.1 ユニットテストと統合テスト
  - 各コンポーネントの単体テスト作成
  - モック環境の構築と設定
  - 統合テストシナリオの実装
  - エラーケースとエッジケースのテスト
  - カバレッジ測定と改善
  - **セキュリティ関連のユニット/統合テスト（要件6対応）:**
    - [ ] 認証失敗動作の検証
      - 無効なAPIキーでのリクエスト拒否テスト
      - 期限切れセッショントークンの検出テスト
      - 認証ヘッダー欠落時の401エラー応答テスト
      - 不正な署名を持つトークンの拒否テスト
    - [ ] データ保存時暗号化（Data-at-Rest）の検証
      - PostgreSQLストレージ内の機密データ暗号化確認
      - Neo4jストレージ内のプロパティ暗号化確認
      - 暗号化キーローテーション処理のテスト
      - 暗号化されたデータの正常な復号化テスト
      - ディスクダンプからの平文データ漏洩防止確認
    - [ ] 通信暗号化（Data-in-Transit）の検証
      - TLS 1.3接続の強制確認（HTTP transport）
      - 自己署名証明書の拒否テスト
      - 証明書検証（hostname verification）のテスト
      - 弱い暗号スイート（deprecated ciphers）の拒否テスト
      - MITMプロキシによる通信傍受防止の確認
    - [ ] アクセス制御と監査ログの検証
      - ユーザーAがユーザーBの記憶にアクセス不可の確認
      - ロールベースアクセス制御（RBAC）の動作テスト
      - 全アクセス操作の監査ログ記録確認（create/read/update/delete）
      - 監査ログの改ざん防止（immutable append-only log）検証
      - セキュリティイベント（不正アクセス試行）の通知テスト
      - 監査ログからの特定ユーザーアクション追跡テスト
  - _Requirements: 全要件のテスト検証, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [ ] 11.2 E2Eテストとパフォーマンステスト
  - エンドツーエンドのフロー検証
  - 複数クライアントの同時接続テスト
  - 負荷テストとストレステスト
  - レスポンスタイムの測定と検証
  - メモリリークと性能劣化の検出
  - _Requirements: 7.1, 7.2, 7.4_

- [ ] 11.2.1 セキュリティテスト（E2E/侵入テスト）
  - **認証失敗フローのE2Eテスト:**
    - [ ] 認証なしクライアントによる全APIエンドポイントへのアクセス拒否確認
    - [ ] 無効なAPIキーを持つクライアントのハンドシェイク失敗シナリオ
    - [ ] セッショントークン期限切れ後の自動再認証フロー検証
    - [ ] 複数の不正アクセス試行後のアカウントロックアウト（rate limiting）
    - [ ] 認証失敗時の情報漏洩防止（timing attack対策、エラーメッセージの一般化）

  - **暗号化検証のE2Eテスト:**
    - [ ] エンドツーエンド暗号化フロー（クライアント→MCP→PostgreSQL/Neo4j）の検証
    - [ ] 機密データ（記憶コンテンツ、メタデータ）の暗号化状態確認
      - PostgreSQL: `SELECT content FROM memories`で暗号化データのみ取得可能
      - Neo4j: ノードプロパティのバイナリ/暗号化形式確認
    - [ ] TLS証明書の有効性検証（期限、CN/SANマッチング）
    - [ ] 暗号化キー管理フロー（キー生成、保存、アクセス制御）のテスト
    - [ ] キーローテーション中のサービス継続性確認（Blue-Green key rotation）

  - **監査ログ整合性のE2Eテスト:**
    - [ ] 全CRUD操作の監査ログ記録完全性確認
      - 記憶の作成、読み取り、更新、削除の全てがログに記録
      - ログエントリの必須フィールド（timestamp, user_id, action, resource_id, result）検証
    - [ ] 監査ログの改ざん検出メカニズム検証
      - ログエントリのハッシュチェーン（hash chain）検証
      - 外部監査ログストレージ（S3, CloudWatch Logs）への送信確認
    - [ ] セキュリティイベント（不正アクセス、権限エスカレーション試行）の通知フロー
      - Webhook/Email通知の送信確認
      - 通知内容の機密性（PII/機密情報のマスキング）確認
    - [ ] 監査ログのクエリと分析
      - 特定ユーザーの過去30日間のアクション抽出
      - 異常パターン検出（深夜の大量削除、短時間の大量アクセス）

  - **侵入テストと負荷時セキュリティ検証:**
    - [ ] SQLインジェクション攻撃の防止確認
      - 記憶検索クエリに悪意のあるSQL挿入試行
      - プリペアドステートメントによる攻撃無効化の検証
    - [ ] Cypherインジェクション攻撃の防止確認（Neo4j）
      - グラフクエリへの不正Cypher挿入試行
      - パラメータ化クエリによる攻撃無効化の検証
    - [ ] XSS（Cross-Site Scripting）対策の確認
      - 記憶コンテンツに悪意のあるスクリプト保存試行
      - 検索結果返却時のサニタイゼーション検証
    - [ ] レート制限の堅牢性テスト
      - 分散攻撃（複数IPからの同時リクエスト）への耐性確認
      - レート制限回避試行（IP偽装、User-Agent変更）の無効化
    - [ ] DoS（Denial of Service）攻撃への耐性確認
      - 大量の並行リクエストによるリソース枯渇試行
      - Circuit Breakerによるカスケード障害防止の検証
      - リクエストサイズ制限（max payload size）の強制確認
    - [ ] 高負荷時のセキュリティ機能維持
      - 1000 req/sの負荷下での認証処理の正常動作
      - 負荷増加時の監査ログ記録の完全性維持
      - ストレス下での暗号化/復号化処理の性能劣化測定

  - **GDPR準拠とデータ削除検証:**
    - [ ] 完全削除（Right to be Forgotten）の実装確認
      - ユーザーデータの論理削除→物理削除フロー
      - PostgreSQL/Neo4j両方からの完全削除検証
      - バックアップからの削除確認（PITR point-in-time recovery対策）
    - [ ] 削除後の復元不可能性確認
      - 削除されたデータの検索結果非表示
      - データベースダンプからの復元試行の失敗確認

  - **ペネトレーションテストツールの活用:**
    - [ ] OWASP ZAP自動スキャンによる脆弱性検出
    - [ ] Burp Suiteを用いた手動セキュリティテスト
    - [ ] Nmap/Nmapによるポートスキャンと不要サービス検出
    - [ ] 検出された脆弱性の修正と再テスト

  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6（セキュリティとプライバシー全要件）_

## 統合と最終調整

- [ ] 12. システム統合と本番準備
- [ ] 12.1 全コンポーネントの統合と動作確認
  - 各サービス間の連携確認
  - データフローの完全性検証
  - エラー伝播とリカバリーの確認
  - 設定の最終調整と最適化
  - ドキュメントの最終確認
  - _Requirements: 全要件の統合検証_

- [ ] 12.2 デプロイメント準備と最終テスト
  - Docker イメージのビルドと最適化
  - 環境変数と設定の最終確認
  - セキュリティスキャンと脆弱性対応
  - パフォーマンスベンチマーク実施
  - 本番環境での動作確認
  - _Requirements: 全要件の本番準備_