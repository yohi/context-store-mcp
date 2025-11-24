# Project Structure

## 概要

本プロジェクト「Context Store MCP」は、AIエージェント向けの長期記憶システムを構築するために、明確に定義されたモジュール構造と責任分離の原則に基づいています。これにより、コードの保守性、拡張性、およびテスト容易性を高めています。

## ルートディレクトリ構成

*   `.env.example`: 環境変数の設定例。
*   `.gitignore`: Gitによるバージョン管理から除外するファイルやディレクトリ。
*   `package.json`, `package-lock.json`: プロジェクトの依存関係とスクリプト。
*   `tsconfig.json`: TypeScriptコンパイラの設定ファイル。
*   `vitest.config.ts`: Vitestテストフレームワークの設定ファイル。
*   `eslint.config.js`, `.prettierrc.json`, `.prettierignore`: コード品質とフォーマットの設定ファイル。
*   `docker-compose.yml`: 開発環境およびテスト環境用のDockerコンテナ定義。
*   `src/`: プロジェクトの主要なソースコードが配置されるディレクトリ。
*   `dist/`: TypeScriptコンパイル後のJavaScriptファイルが出力されるディレクトリ。
*   `node_modules/`: プロジェクトの依存関係がインストールされるディレクトリ。
*   `.kiro/`: Kiro CLIツールが使用する設定ファイルや仕様ファイル。

## サブディレクトリ構造 (`src/`)

`src/`ディレクトリは、プロジェクトの主要なドメインと機能に基づいてさらに分割されています。

*   `src/index.ts`: アプリケーションのエントリーポイント。
*   `src/mcp/`: MCP (Model Context Protocol) サーバーの実装およびプロトコル関連のコンポーネント。
    *   `circuit-breaker.ts`: サーキットブレーカーパターンの実装。
    *   `errors.ts`: アプリケーション固有のエラー定義。
    *   `lru-cache.ts`: LRUキャッシュの実装。
    *   `performance-metrics.ts`: 性能指標の収集と管理。
    *   `rate-limiter.ts`: レートリミッターの実装。
    *   `server.ts`: MCPサーバーのコア実装。
    *   `timeout-controller.ts`: タイムアウト制御のロジック。
*   `src/memory/`: 記憶の永続化、管理、分類に関連するコンポーネント。
    *   `memory-classifier.ts`: 記憶タイプ分類ロジック。
    *   `memory-manager.ts`: 記憶のCRUD操作をオーケストレーションするマネージャー。
    *   `types.ts`: 記憶ドメイン固有の型定義。
*   `src/performance/`: パフォーマンス最適化とスケーラビリティに関連するコンポーネント。
    *   `autoscaling-manager.ts`: 自動スケーリングの管理。
    *   `background-job-manager.ts`: バックグラウンドジョブの管理。
    *   `batch-processor.ts`: バッチ処理のロジック。
    *   `connection-pool-manager.ts`: データベース接続プールの管理。
    *   `index-optimizer.ts`: データベースインデックスの最適化。
    *   `query-optimizer.ts`: クエリ最適化ロジック。
*   `src/query/`: 記憶の検索とクエリ処理に関連するコンポーネント。
    *   `query-processor.ts`: 検索クエリの解析と実行。
    *   `search-quality-evaluator.ts`: 検索品質の評価と改善。
    *   `types.ts`: クエリドメイン固有の型定義。
*   `src/security/`: セキュリティ、認証、認可、監査に関連するコンポーネント。
    *   `api-key-manager.ts`: APIキーの管理。
    *   `audit-logger.ts`: 監査ログの記録。
    *   `data-isolation.ts`: データ分離のロジック。
    *   `deletion-manager.ts`: GDPR準拠の完全削除機能。
    *   `encryption.ts`: 暗号化ユーティリティ。
    *   `mcp-auth-middleware.ts`: MCP認証ミドルウェア。
    *   `permission-middleware.ts`: 権限チェックミドルウェア。
    *   `rbac-manager.ts`: RBAC (Role-Based Access Control) の管理。
    *   `security-event-detector.ts`: セキュリティイベントの検出。
*   `src/storage/`: データベースとのやり取りを抽象化するアダプターと関連コンポーネント。
    *   `api-key-store-adapter.ts`: APIキー専用のストレージアダプター。
    *   `circuit-breaker.ts`: ストレージアクセス用のサーキットブレーカー。
    *   `failover-manager.ts`: ストレージのフェイルオーバー管理。
    *   `graph-store-adapter.ts`: Neo4jグラフデータベース用アダプター。
    *   `reconciliation-service.ts`: ストレージ間の整合性維持サービス。
    *   `scheduled-reconciliation-job.ts`: 定期的な整合性チェックジョブ。
    *   `storage-adapter.ts`: 汎用ストレージアダプターインターフェース。
    *   `transaction-coordinator.ts`: ハイブリッドストレージ間のトランザクション調整。
    *   `vector-store-adapter.ts`: PostgreSQL + pgvector用ベクトルストレージアダプター。
*   `src/tests/`: 各モジュールに対応するユニットテスト、統合テスト、E2Eテスト。
    *   `database/`, `mcp/`, `memory/`, `performance/`, `query/`, `security/`, `storage/`: 各ドメインのテストファイル。
*   `src/types/`: アプリケーション全体で共有される汎用的な型定義。
*   `src/utils/`: 共通ユーティリティ関数やヘルパー。

## コード編成パターン

*   **ドメイン駆動設計 (DDD)**: `src/`下の各ディレクトリは、アプリケーションの主要なドメイン（`memory`, `query`, `security`, `storage`など）に対応しており、それぞれのド責務と境界が明確です。
*   **レイヤードアーキテクチャ**: MCPサーバー層、メモリ管理層、クエリ処理層、ストレージアダプター層といった論理的な層が明確に分離されており、各層は上位層から下位層への単方向の依存関係を持ちます。
*   **アダプターパターン**: データベースや外部APIへのアクセスは、`src/storage/`内のアダプターを通じて抽象化されており、特定の技術への依存度を低減し、交換容易性を高めています。
*   **依存性注入 (DI)**: コンポーネント間の依存関係はコンストラクタを通じて注入され、テスト容易性と柔軟な設定変更を可能にしています。

## ファイル命名規則

*   **小文字ケバブケース**: ファイル名とディレクトリ名はすべて小文字で、単語間はハイフン (`-`) で区切ります (例: `memory-manager.ts`, `vector-store-adapter.ts`)。
*   **インターフェース**: インターフェースファイルは `I` プレフィックスを付けず、`types.ts` に集約するか、`{domain}-adapter.ts` のように具象クラスと同一ファイルに定義します。
*   **テストファイル**: 対応するソースファイル名に `.test.ts` を付加します (例: `memory-manager.test.ts`)。

## インポートの整理

*   **相対パス**: プロジェクト内のモジュール間は相対パス (`../`, `./`) を使用します。
*   **絶対パス**: Node.js組み込みモジュールや`npm`パッケージは、モジュール名を直接指定します。
*   **型インポート**: 型のみをインポートする場合は `import type` を明示的に使用します。

## 主要な設計原則

*   **関心の分離**: 各モジュールは単一の責任を持ち、特定の機能に集中します。
*   **モジュール性**: コードベースは独立した再利用可能なモジュールに分割されます。
*   **拡張性**: 新しい機能やストレージ技術の追加が容易なように設計されています。
*   **テスト容易性**: 依存性注入とモジュール性の高さにより、各コンポーネントが単独でテスト可能です。
*   **MCP標準への準拠**: AIエージェントエコシステムとの相互運用性を確保するため、Model Context Protocolの仕様を厳守します。
