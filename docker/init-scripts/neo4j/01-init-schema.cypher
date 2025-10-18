// Neo4jスキーマ初期化スクリプト
// Task 1.3: データベーススキーマの設計と初期化
// design.md のNeo4jグラフスキーマに基づいて作成

// ========================================
// 制約の作成
// ========================================

// Memory ノードのid制約（一意性保証）
CREATE CONSTRAINT memory_id_unique IF NOT EXISTS
FOR (m:Memory)
REQUIRE m.id IS UNIQUE;

// ========================================
// インデックスの作成
// ========================================

// Memory ノードのtype インデックス
CREATE INDEX memory_type_index IF NOT EXISTS
FOR (m:Memory)
ON (m.type);

// Memory ノードのtimestamp インデックス
CREATE INDEX memory_timestamp_index IF NOT EXISTS
FOR (m:Memory)
ON (m.timestamp);

// Memory ノードのuser_id インデックス（アクセス制御用）
CREATE INDEX memory_user_id_index IF NOT EXISTS
FOR (m:Memory)
ON (m.user_id);

// ========================================
// リレーションシップタイプの定義（コメントのみ）
// ========================================

// 以下のリレーションシップタイプが使用されます（requirements.md 要件3.5準拠）:
//
// 1. REFERENCES
//    - 一般的な参照関係
//    - プロパティ: strength (0.0-1.0), createdAt, createdBy, reasoning
//
// 2. DERIVED_FROM
//    - 派生関係
//    - プロパティ: strength (0.0-1.0), createdAt, createdBy, reasoning
//
// 3. CONTRADICTS
//    - 矛盾関係
//    - プロパティ: strength (0.0-1.0), createdAt, createdBy, reasoning
//
// 4. SUPPORTS
//    - 支持関係
//    - プロパティ: strength (0.0-1.0), createdAt, createdBy, reasoning
//
// 5. PREREQUISITE
//    - 前提条件
//    - プロパティ: strength (0.0-1.0), createdAt, createdBy, reasoning
//
// 6. NEXT_STEP
//    - 次のステップ
//    - プロパティ: strength (0.0-1.0), createdAt, createdBy, reasoning
//
// すべてのリレーションシップは双方向でアクセス可能です:
// MATCH (a:Memory)-[r]-(b:Memory) WHERE a.id = $memoryId RETURN a, r, b;

// ========================================
// 確認メッセージ
// ========================================

// Neo4jスキーマ初期化完了
// - memory_id_unique 制約作成済み
// - memory_type_index インデックス作成済み
// - memory_timestamp_index インデックス作成済み
// - memory_user_id_index インデックス作成済み
