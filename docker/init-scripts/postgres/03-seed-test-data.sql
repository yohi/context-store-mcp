-- テストデータ投入スクリプト
-- Task 1.3: データベーススキーマの設計と初期化
-- 開発・テスト用のサンプルデータを投入

-- ========================================
-- テストデータ投入（開発環境のみ）
-- ========================================

-- 環境変数チェック（本番環境では実行しない）
DO $$
BEGIN
  IF current_database() NOT LIKE '%test%' AND current_database() NOT LIKE '%dev%' THEN
    RAISE EXCEPTION 'このスクリプトは開発環境またはテスト環境でのみ実行できます。現在のデータベース: %', current_database();
  END IF;
END $$;

-- ========================================
-- エピソード記憶のサンプルデータ
-- ========================================

INSERT INTO memories (id, content, memory_type, metadata, importance_score, is_protected) VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    '昨日のミーティングで、新機能のリリース日を来月15日に決定した。プロダクトマネージャーのAliceとエンジニアリングリードのBobが合意。',
    'episodic',
    '{"source": "meeting_notes", "participants": ["Alice", "Bob"], "date": "2025-01-15", "tags": ["meeting", "release-planning"]}'::jsonb,
    0.8,
    true
  ),
  (
    '11111111-1111-1111-1111-111111111112',
    'プロジェクトのキックオフミーティングで、技術スタックをTypeScript + PostgreSQL + Neo4jに決定。理由はスケーラビリティと開発者体験の向上。',
    'episodic',
    '{"source": "meeting_notes", "project": "context-store-mcp", "tags": ["kickoff", "tech-stack"]}'::jsonb,
    0.75,
    false
  );

-- ========================================
-- 意味記憶のサンプルデータ
-- ========================================

INSERT INTO memories (id, content, memory_type, metadata, importance_score, is_protected) VALUES
  (
    '22222222-2222-2222-2222-222222222221',
    'MCPプロトコルはModel Context Protocolの略で、AIエージェントが外部ツールやリソースにアクセスするための標準化されたインターフェース。JSON-RPCベースの通信を使用する。',
    'semantic',
    '{"source": "documentation", "category": "protocol", "tags": ["MCP", "protocol", "standard"]}'::jsonb,
    0.9,
    true
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'PostgreSQLのpgvector拡張機能は、ベクトル埋め込みの保存と類似性検索を可能にする。HNSWインデックスを使用することで高速な近似最近傍探索が実現できる。',
    'semantic',
    '{"source": "documentation", "category": "database", "tags": ["PostgreSQL", "pgvector", "vector-search"]}'::jsonb,
    0.85,
    false
  ),
  (
    '22222222-2222-2222-2222-222222222223',
    'Neo4jはグラフデータベースで、ノードとリレーションシップで構成される。Cypherクエリ言語を使用してグラフパターンマッチングを行う。',
    'semantic',
    '{"source": "documentation", "category": "database", "tags": ["Neo4j", "graph-database", "Cypher"]}'::jsonb,
    0.8,
    false
  );

-- ========================================
-- 手続き記憶のサンプルデータ
-- ========================================

INSERT INTO memories (id, content, memory_type, metadata, importance_score, is_protected) VALUES
  (
    '33333333-3333-3333-3333-333333333331',
    'データベーススキーマの変更手順:\n1. マイグレーションファイルを作成\n2. 開発環境でテスト\n3. CIでテストを実行\n4. ステージング環境にデプロイ\n5. 本番環境にデプロイ\n6. ロールバック計画を準備',
    'procedural',
    '{"source": "runbook", "category": "deployment", "tags": ["migration", "database", "deployment"]}'::jsonb,
    0.7,
    true
  ),
  (
    '33333333-3333-3333-3333-333333333332',
    'Neo4jバックアップの手順:\n1. Neo4j Adminツールでダンプを作成\n2. ダンプファイルをS3にアップロード\n3. バックアップメタデータをPostgreSQLに記録\n4. 復旧テストを実施',
    'procedural',
    '{"source": "runbook", "category": "backup", "tags": ["Neo4j", "backup", "recovery"]}'::jsonb,
    0.65,
    false
  );

-- ========================================
-- ベクトル埋め込みのダミーデータ
-- ========================================

-- 注意: 本番環境では実際のOpenAI Embeddingsを使用する
-- ここでは開発用にランダムなベクトルを生成

INSERT INTO memory_vectors (memory_id, embedding)
SELECT
  id,
  ARRAY(SELECT random()::float FROM generate_series(1, 1536))::vector
FROM memories
WHERE NOT EXISTS (
  SELECT 1 FROM memory_vectors WHERE memory_vectors.memory_id = memories.id
);

-- ========================================
-- 検索結果ログのサンプルデータ
-- ========================================

INSERT INTO search_result_log (memory_id, query, relevance_score, searched_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'リリース日の決定', 0.92, NOW() - INTERVAL '1 day'),
  ('11111111-1111-1111-1111-111111111111', '来月のリリース', 0.88, NOW() - INTERVAL '2 days'),
  ('22222222-2222-2222-2222-222222222221', 'MCPプロトコルとは', 0.95, NOW() - INTERVAL '3 days'),
  ('22222222-2222-2222-2222-222222222222', 'pgvectorの使い方', 0.90, NOW() - INTERVAL '5 days'),
  ('33333333-3333-3333-3333-333333333331', 'データベースマイグレーション手順', 0.93, NOW() - INTERVAL '7 days');

-- ========================================
-- 重要度スコアの更新
-- ========================================

-- 検索結果ログに基づいて重要度スコアを再計算
UPDATE memories
SET importance_score = LEAST(1.0, GREATEST(0.0,
  (SELECT COUNT(*) * 0.05 FROM search_result_log
   WHERE memory_id = memories.id
   AND searched_at >= NOW() - INTERVAL '30 days')
))
WHERE id IN (SELECT DISTINCT memory_id FROM search_result_log);

-- ========================================
-- 確認メッセージ
-- ========================================

DO $$
DECLARE
  memory_count INT;
  vector_count INT;
  search_log_count INT;
BEGIN
  SELECT COUNT(*) INTO memory_count FROM memories;
  SELECT COUNT(*) INTO vector_count FROM memory_vectors;
  SELECT COUNT(*) INTO search_log_count FROM search_result_log;

  RAISE NOTICE 'Test data seeded successfully';
  RAISE NOTICE 'Memories inserted: %', memory_count;
  RAISE NOTICE 'Vectors inserted: %', vector_count;
  RAISE NOTICE 'Search logs inserted: %', search_log_count;
  RAISE NOTICE 'Environment: %', current_database();
END $$;
