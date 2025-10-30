# 実装計画

## プロジェクト基盤

- [ ] 1. プロジェクトの基盤構築とインフラストラクチャのセットアップ
- [x] 1.1 開発環境の初期化と依存関係の準備
  - TypeScript開発環境の構築
  - MCPサーバーSDKの統合
  - データベースクライアントとORM環境の準備
  - ロギングとユーティリティツールの導入
  - 開発支援ツールとコード品質管理の設定
  - _Requirements: 全要件の基盤となる環境構築_

- [x] 1.2 コンテナ化された開発環境の構築
  - PostgreSQLデータベースとベクトル拡張機能の準備
  - グラフデータベースの構築と初期設定
  - キャッシュシステムの導入
  - コンテナ間の連携設定
  - 環境設定の管理システム構築
  - _Requirements: 5.1, 5.2_

- [x] 1.3 データベーススキーマの設計と初期化
  - リレーショナルデータベースのテーブル構造定義
  - ベクトル検索機能の有効化
  - グラフデータベースの制約と構造定義
  - テストデータの準備
  - スキーマ変更管理の仕組み構築
  - _Requirements: 5.1, 5.2, 5.4_

## MCPプロトコル実装

- [ ] 2. MCPサーバーの基本実装とプロトコル準拠
- [ ] 2.1 MCPサーバーのコア機能実装
  - MCP標準に準拠したサーバー初期化
  - リモートプロシージャコール処理の実装
  - 通信層の設定
  - セッション管理機能の構築
  - エラー処理と標準化されたレスポンス生成
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 2.2 包括的なエラーハンドリングとSLA準拠のレスポンス処理
  - MCP標準エラーコードの完全実装
  - タイムアウト制御とリトライロジックの構築
  - レート制限機能の実装
  - リクエスト検証とバリデーション
  - サーキットブレーカーパターンの実装
  - パフォーマンスメトリクスの記録
  - _Requirements: 4.3, 7.1_

- [x] 2.3 LRUキャッシュ退避機能の実装
  - コンテキスト用LRUキャッシュクラスの作成
  - O(1)読み取り・書き込み性能の実装
  - 自動退避メカニズムの実装
  - 有効期限管理機能の実装
  - 統計情報取得機能の実装
  - 包括的なユニットテスト（24件すべてパス）
  - _Requirements: 7.1, パフォーマンス最適化_

## 記憶管理システム

- [ ] 3. 記憶の永続化と管理機能の実装
- [x] 3.1 記憶管理サービスの基本機能
  - 記憶保存処理の実装
  - メタデータ処理と検証
  - 一意識別子の生成と管理
  - タイムスタンプの自動管理
  - データ整合性チェック機構
  - _Requirements: 1.1, 1.2, 1.6_

- [ ] 3.2 記憶の更新、削除、統合機能 **[部分実装]**
  - [x] 記憶更新処理（基本機能）
  - [ ] 履歴管理（バージョン記録）- 未実装
  - [x] 段階的削除処理（ソフト削除、保護機能付き）
  - [x] 削除タイムスタンプ（deletedAt）
  - [ ] 類似記憶の自動検出 - 未実装
  - [x] ID指定による統合（mergeMemories）
  - [x] 関連性の維持機構（タグのマージ、コンテンツ結合）
  - [x] 不要データの自動整理（performGarbageCollection）- **タスク3.3で実装完了**
  - [x] インメモリストレージ実装（PostgreSQL統合は後続タスク）
  - [x] 基本ユニットテスト35件パス
  - _Requirements: 1.3, 1.4, 1.5_
  - **TODO**: Issue作成 - バージョン履歴、類似性検出

- [x] 3.3 ストレージ自動整理システムの実装
  - ガベージコレクション機能（24時間以上前のソフト削除記憶を物理削除）
  - 重要度スコア計算ロジック（参照スコア × 0.6 + 中心性スコア × 0.4）
  - ストレージ最適化機能（全記憶の重要度スコア更新 + GC実行）
  - 保護メモリの除外機能（is_protected=trueは削除対象外）
  - インメモリ実装完了（PostgreSQL/Neo4j統合は後続タスク）
  - 8ユニットテスト全パス（43テスト中8テストが新規追加）
  - _Requirements: 1.4_

## 記憶タイプ分類

- [ ] 4. 多層的記憶タイプの分類システム
- [x] 4.1 記憶タイプ自動分類エンジンの構築
  - コンテンツ解析による分類ロジック
  - エピソード記憶の識別処理
  - 意味記憶の識別処理
  - 手続き記憶の識別処理
  - 分類信頼度の算出
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 4.2 分類精度の測定と改善システム **[部分実装]**
  - [x] 評価データセットの管理（LabeledSample型）
  - [x] 分類精度の測定ロジック（evaluateAccuracy）
  - [x] 混同行列（Confusion Matrix）の計算
  - [x] 全体精度とタイプ別精度の算出
  - [x] ユーザーフィードバックの収集（ClassificationStats）
  - [ ] 分類モデルの学習機構（trainClassifier） - プレースホルダー実装のみ → **Issue #22**
  - [x] 精度レポート生成（AccuracyMetrics、ClassificationStats）
  - [x] 13ユニットテスト全パス
  - _Requirements: 3.4_
  - **TODO**: [Issue #22](https://github.com/yohi/context-store-mcp/issues/22) - trainClassifierの完全実装（機械学習モデルの統合）

- [x] 4.3 記憶タイプ間の関連付けと管理
  - タイプ間リンクの生成と維持
  - 相互参照の管理
  - タイプ別のストレージ振り分け
  - タイプフィルタリング機能
  - ユーザーによるタイプ上書き機能
  - _Requirements: 3.5, 3.6_

## ベクトル検索実装

- [ ] 5. ベクトルストレージと意味的検索の構築
- [x] 5.1 ベクトルストレージアダプターの実装
  - 埋め込みAPI統合
  - ベクトル生成と正規化
  - ベクトル保存処理
  - 高速近似最近傍探索インデックスの構築
  - バッチ処理による効率化
  - _Requirements: 2.1, 5.1_

- [x] 5.2 類似性検索とランキング機能
  - 類似度計算による検索実装
  - 閾値フィルタリング
  - スコアリングアルゴリズム
  - 検索結果のランキング
  - メタデータフィルタの適用
  - 拡張された検索オプション（limit, offset, excludeIds, diversityEnabled）
  - 4つのスコアリング戦略（similarity_only, recency_weighted, importance_weighted, hybrid）
  - MMR（Maximal Marginal Relevance）アルゴリズムによる多様性確保
    - **実装完了**: 真のコサイン類似度を使用したMMRアルゴリズムを実装
    - **動作**: SELECTクエリでembeddingを取得し、候補間のコサイン類似度を計算
    - **アルゴリズム**: `MMR = λ × 関連性 - (1 - λ) × max_cosine_similarity`
    - **パフォーマンス**: 候補プール制限（最大1000件）により計算量を管理
    - **精度**: ベクトル空間上の真の類似度に基づく多様性確保
  - カスタマイズ可能なスコアリング重み設定
  - _Requirements: 2.3, 2.5_

## グラフデータベース統合

- [ ] 6. グラフストレージと構造的検索の実装
- [x] 6.1 グラフストレージアダプターの基本実装
  - グラフデータベース接続管理
  - ノードの作成、更新、削除
  - プロパティの管理と検証
  - トランザクション処理
  - エラーハンドリングとリトライ
  - 18ユニットテスト全パス
  - _Requirements: 5.2, 5.3_

- [x] 6.2 関係性の管理とグラフトラバーサル
  - リレーションシップの作成、取得、削除
  - ノードのリレーションシップ取得（出力/入力/両方向、タイプフィルタ付き）
  - グラフトラバーサル（Cypherパターンマッチング）
  - 最短パス探索（maxDepthパラメータ対応）
  - 次数中心性計算（Degree Centrality）
  - 簡易コミュニティ検出（連結成分分析）
  - 35ユニットテスト全パス（タスク6.1の18テスト + タスク6.2の17テスト）
  - _Requirements: 2.1, 5.2, 3.5_

## クエリ処理システム

- [ ] 7. 高度な検索とクエリ最適化の実装
- [x] 7.1 クエリプロセッサーの基本機能
  - 自然言語クエリの解析（意図推論、キーワード抽出）
  - 時間フィルタの解釈と適用（相対時間・絶対時間の変換）
  - タグとメタデータフィルタリング（記憶タイプ、タグ、時間範囲）
  - クエリプランの生成と最適化（早期フィルタ適用、キャッシュルックアップ）
  - 検索戦略の自動選択（vector_only, hybrid, graph_priority, metadata_filtering）
  - 42ユニットテスト全パス（参照: `src/tests/query/query-processor.test.ts`）
  - _Requirements: 2.2, 2.4, 2.6_

- [~] 7.2 ハイブリッド検索とキャッシング
  - ハイブリッド検索メソッドの実装 (hybridSearch) - **要実装: 現在スタブ実装(query-processor.ts:669-671)**
  - 重み付けスコアマージング (semantic: 0.7, structural: 0.3) - **要実装**
  - 重みの自動正規化機能 - **要実装**
  - クエリハッシュ生成 (SHA256) - ✓ 実装済み
  - LRUCache統合によるキャッシング - ✓ 実装済み
  - キャッシュヒット率計算機能 - ✓ 実装済み
  - キャッシュ無効化メソッド (invalidateCache, invalidateCacheByTags, invalidateCacheByMemoryType, clearCache) - ✓ 実装済み
  - 44ユニットテスト全パス (タスク7.1の24テスト + タスク7.2の20テスト) - **要調整: プレースホルダーテスト多数**
  - _Requirements: 2.1, 2.3, 2.5_
  - **残作業: hybridSearchの実装、VectorStoreAdapterとGraphStoreAdapterの統合、実装に基づくテストの更新**

- [x] 7.3 検索品質評価システムの実装
  - 評価データセット管理 (SearchEvaluationDataset型)
  - Precision@K、Recall@K、F1スコア計算機能
  - Average Precision、MAP (Mean Average Precision) 計算
  - **Fleiss' Kappa係数によるアノテーター間一致度計算 (完全実装)** - カテゴリごとの集計、P̄（平均観測一致度）、P_e（期待一致度）による正確な κ 計算
  - **データセット検証** (最低100クエリ、2名以上のアノテーター、Kappa ≥ 0.6)
  - 検索ログ記録機能 (SearchLogEntry、UserFeedbackLog)
  - ユーザーフィードバック収集 (RelevanceFeedback)
  - **A/Bテストフレームワーク (統計的有意性検定、p値計算)** - Welchのt検定（不等分散対応、Welch-Satterthwaite自由度補正、t分布累積分布関数による両側検定、不完全ベータ関数/Lentz連分数展開による近似）
  - 改善計画自動生成機能
  - 30ユニットテスト全パス
  - _Requirements: 2.1_
  - **注意事項: 統計検定の制限と推奨事項**
    - **小サンプル**: n < 30の場合、正規分布仮定が崩れp値の精度が低下する可能性あり（実装内で警告表示）
    - **p値近似**: erf関数ベースのCDF近似を使用（厳密な実装ではない）
    - **本番推奨**: 厳密な統計検証が必要な場合は外部ライブラリ（jstat、simple-statisticsなど）の使用を検討
    - 参照実装: `src/query/search-quality-evaluator.ts:368-408` (A/Bテスト), `src/query/search-quality-evaluator.ts:202-285` (Fleiss' Kappa)

## セキュリティとアクセス制御

- [ ] 8. セキュリティ機能とデータ保護の実装
- [x] 8.1 認証と暗号化の実装
  - AES-256-GCM暗号化モジュール実装（`src/security/encryption.ts`）
  - エンベロープ暗号化パターン（DEK + CMK）
  - ローカル開発用MasterKeyProvider実装
  - APIキー管理システム（`src/security/api-key-manager.ts`）
    - セキュアなAPIキー生成（csm_v1形式、Base62エンコード）
    - SHA-256ハッシュ化による保存
    - TTL管理と有効期限チェック
    - キーの無効化（revoke）とローテーション機能
  - MCP認証ミドルウェア（`src/security/mcp-auth-middleware.ts`）
    - Bearer Token / X-API-Key ヘッダー対応
    - レート制限（5分間に3回失敗で15分間ブロック）
    - 権限スコープチェック
    - 監査ログ生成機能
  - キーローテーション管理（KeyRotationManager）
    - DEKローテーション自動判定（90%経過時）
    - データ再暗号化機能
  - 66ユニットテスト全パス
    - encryption.test.ts: 24テスト
    - api-key-manager.test.ts: 26テスト
    - mcp-auth-middleware.test.ts: 16テスト
  - _Requirements: 6.1, 6.2_
  - **注意**: 本番環境ではAWS KMSまたはHashiCorp Vaultを使用すること

- [x] 8.2 アクセス制御とロール管理
  - RBACManager実装（`src/security/rbac-manager.ts`）
    - デフォルトロール定義（admin, user, read_only）
    - カスタムロール作成・削除機能
    - ユーザー-ロール割り当て管理
    - 権限チェック機能（hasPermission, getAllPermissions）
    - 5分間のキャッシュTTL（設定可能）
    - 最小権限の原則（デフォルトはread_only）
  - PermissionMiddleware実装（`src/security/permission-middleware.ts`）
    - 単一権限チェック（requirePermission）
    - 複数権限チェック（requireAnyPermission, requireAllPermissions）
    - MCPツール別権限マッピング（store_memory, search_memory, update_memory, delete_memory）
    - 構造化されたPermissionError生成
  - DataIsolationManager実装（`src/security/data-isolation.ts`）
    - ユーザー別クエリフィルタ生成（PostgreSQL WHERE句、Neo4j Cypherフィルタ）
    - パラメータ化クエリ対応（SQLインジェクション対策）
    - データ所有権検証（validateOwnership）
    - Admin権限での全データアクセス
  - 54ユニットテスト全パス
    - rbac-manager.test.ts: 23テスト
    - permission-middleware.test.ts: 14テスト
    - data-isolation.test.ts: 17テスト
  - _Requirements: 6.3_

- [x] 8.3 監査ログと追跡システム
  - AuditLogger実装（`src/security/audit-logger.ts`）
    - HMAC-SHA256による改ざん防止デジタル署名
    - 必須フィールド完全実装（timestamp, event_type, user_id, session_id, ip_address, resource_id, action, result, metadata）
    - 検索/クエリ機能（ユーザーID、イベントタイプ、時間範囲、リソースID）
    - ページネーション対応（limit, offset）
    - アクセス履歴追跡（getAccessHistory）
    - ログ保持期間管理（purgeOldLogs）
    - エクスポート機能（JSON, CSV）
    - 21ユニットテスト全パス
  - SecurityEventDetector実装（`src/security/security-event-detector.ts`）
    - 異常検出パターン実装（excessive_data_access, unknown_ip_access, bulk_export_attempt, auth_failure_spike）
    - 閾値ベース検出（100件以上、1000件以上、50回以上）
    - ベースライン比較（通常の10倍以上）
    - 脅威レベル分類（warning, important, critical）
    - 既知IPアドレス管理
    - ユーザーベースライン設定
    - 16ユニットテスト全パス
  - AlertManager実装（`src/security/alert-manager.ts`）
    - マルチチャネル通知（log, email, sms, pagerDuty）
    - 脅威レベル別通知戦略
    - 自動応答アクション（セッション停止、IPブロック）
    - アラート履歴管理と検索
    - ダッシュボードリンク生成
    - 16ユニットテスト全パス
  - 53ユニットテスト全パス（既存120テストと合わせて173テスト）
    - audit-logger.test.ts: 21テスト
    - security-event-detector.test.ts: 16テスト
    - alert-manager.test.ts: 16テスト
  - _Requirements: 6.5, 6.6_

- [x] 8.4 GDPR準拠の完全削除機能
  - DeletionManager実装（`src/security/deletion-manager.ts`）
  - 段階的削除ワークフロー（Phase 1: Soft Delete + Key Destruction, Phase 2: Background Purge, Phase 3: Backup Deletion）
  - 削除証明書（DeletionReceipt）の発行機能
  - 削除検証メカニズム（verifyDeletion）
  - 監査ログエクスポート（JSON/CSV）
  - 孤立削除検出（detectOrphanedDeletions）
  - 削除メトリクス（getDeletionMetrics）
  - 指数バックオフによる再試行ポリシー（最大3回）
  - 24ユニットテスト全パス
  - _Requirements: 6.4_
  - **注意**: 本実装はインメモリストレージアダプター使用。PostgreSQL/Neo4j統合は後続タスクで実施

## ハイブリッドストレージ一貫性

- [ ] 9. ストレージ間の一貫性とフェイルオーバー
- [x] 9.1 トランザクション調整とSagaパターン
  - PostgreSQL-Neo4j間の調整戦略（Sagaパターン実装完了）
  - 補償トランザクションの実装（sync_status マーキング機構）
  - 部分失敗時のロールバック（PG成功+Neo4j失敗、PG失敗全体ロールバック）
  - べき等性の保証（ON CONFLICT DO NOTHING, MERGE対応）
  - トランザクション境界の定義（PG内ACID、PG-Neo4j間は結果整合性）
  - 指数バックオフリトライ（最大3回、100ms/200ms/400ms）
  - 9ユニットテスト全パス
  - _Requirements: 5.3, 5.4_

- [ ] 9.2 フェイルオーバーとエラーリカバリー
  - コンポーネント別フェイルオーバーモード
  - 再試行ポリシーとバックオフ戦略
  - サーキットブレーカーパターン
  - 読み取り専用モードへの自動切り替え
  - 同期失敗の追跡と再試行
  - _Requirements: 5.3_

- [ ] 9.3 整合性監視と自動修復
  - 定期整合性チェックジョブ
  - ストレージ間の差分検出
  - 孤立データの自動削除
  - 同期失敗アラートの発火
  - 整合性レポート生成
  - _Requirements: 5.4, 5.5_

## パフォーマンス最適化

- [ ] 10. パフォーマンス向上とスケーラビリティの実装
- [ ] 10.1 パフォーマンスチューニング
  - データベース接続プーリングの最適化
  - 非同期処理とバックグラウンドジョブ
  - インデックスの最適化と再構築
  - クエリ最適化と実行計画分析
  - バッチ処理の並列化
  - _Requirements: 7.1, 7.3, 7.5_

- [ ] 10.2 スケーラビリティと自動化
  - オートスケーリングのトリガー設定
  - データパーティショニング戦略
  - リソース使用量の自動調整
  - 性能劣化の自動検知
  - バックグラウンド最適化処理
  - _Requirements: 7.2, 7.4, 7.6_

## 監視と運用

- [ ] 11. システム監視と運用管理機能の実装
- [ ] 11.1 メトリクス収集と監視
  - パフォーマンスメトリクスの実装
  - システムリソース使用率の記録
  - レスポンスタイムの計測
  - エラー率とスループットの監視
  - カスタムメトリクスの定義
  - _Requirements: 8.1, 8.2, 8.3_

- [ ] 11.2 ログ管理とメンテナンス機能
  - 構造化ログの実装
  - エラートレースとスタック情報の記録
  - ヘルスチェック機能
  - メンテナンスモードの実装
  - 自動バックアップ機能
  - _Requirements: 8.4, 8.5, 8.6_

## テストとバリデーション

- [ ] 12. 包括的なテストスイートの実装
- [ ] 12.1 ユニットテストと統合テスト
  - 各コンポーネントの単体テスト
  - モック環境の構築
  - 統合テストシナリオの実装
  - エラーケースとエッジケースのテスト
  - カバレッジ測定と改善
  - _Requirements: 全要件のテスト検証_

- [ ] 12.2 セキュリティテストの実装
  - 認証失敗動作の検証テスト
  - データ保存時暗号化の検証
  - 通信暗号化の検証
  - アクセス制御と監査ログの検証
  - 脆弱性スキャンと侵入テスト
  - GDPR準拠削除の検証
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [ ] 12.3 E2Eテストとパフォーマンステスト
  - エンドツーエンドフロー検証
  - 複数クライアント同時接続テスト
  - 負荷テストとストレステスト
  - レスポンスタイム測定
  - メモリリークと性能劣化の検出
  - _Requirements: 7.1, 7.2, 7.4_

## 統合と最終調整

- [ ] 13. システム統合と本番準備
- [ ] 13.1 全コンポーネントの統合と動作確認
  - サービス間連携の確認
  - データフローの完全性検証
  - エラー伝播とリカバリーの確認
  - 設定の最終調整
  - ドキュメントの最終確認
  - _Requirements: 全要件の統合検証_

- [ ] 13.2 デプロイメント準備と最終テスト
  - コンテナイメージのビルドと最適化
  - 環境設定の最終確認
  - セキュリティスキャンと脆弱性対応
  - パフォーマンスベンチマーク実施
  - 本番環境での動作確認
  - _Requirements: 全要件の本番準備_
