# Context Store MCP - 未実装機能とIssue

## Task 3.2 - 記憶の更新、削除、統合機能の完全実装

### Issue #1: バージョン履歴管理の実装
**ステータス**: 未実装
**優先度**: 中
**関連要件**: requirements.md 1.3（記憶更新）

**説明**:
現在の `updateMemory()` は記憶を上書きするのみで、更新履歴を保持していない。設計書に基づき、バージョン管理機能を実装する必要がある。

**実装内容**:
- [ ] `memory_versions` テーブルの追加（PostgreSQL）
  ```sql
  CREATE TABLE memory_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID REFERENCES memories(id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(memory_id, version_number)
  );
  ```
- [ ] `updateMemory()` でバージョン記録を自動保存
- [ ] バージョン取得API `getMemoryVersions(memoryId)` の実装
- [ ] 特定バージョンへのロールバック機能 `revertToVersion(memoryId, versionNumber)`
- [ ] ユニットテスト追加（バージョン保存、取得、ロールバック）

**設計参照**: design.md 行609-629（ドメインモデル）

---

### Issue #2: 類似記憶の自動検出と統合提案
**ステータス**: 未実装
**優先度**: 高
**関連要件**: requirements.md 1.3（記憶統合）

**説明**:
現在の `mergeMemories()` はIDを明示的に指定する必要がある。設計書では「類似記憶の検出と統合提案」が要求されているため、自動検出機能が必要。

**実装内容**:
- [ ] 類似性検出ロジックの実装
  - コサイン類似度による検出（threshold ≥ 0.9）
  - 同一タグを持つ記憶の検出
  - 時間的近接性の考慮（作成時刻の差 < 1時間）
- [ ] `findSimilarMemories(memoryId, threshold)` API
- [ ] `suggestMerges()` - マージ候補を返すAPI
- [ ] マージ提案のユーザー承認フロー
- [ ] ユニットテスト追加（類似性検出精度、マージ提案）

**設計参照**: design.md 行1386-1625（自動整理機能）

---

### Issue #3: ソフト削除のタイムスタンプ管理
**ステータス**: 未実装
**優先度**: 中
**関連要件**: requirements.md 1.5（削除）、6.4（GDPR準拠削除）

**説明**:
現在の `deleteMemory()` は `isDeleted` フラグのみ設定し、削除日時を記録していない。GDPR準拠の段階的削除には `deletedAt` が必須。

**実装内容**:
- [ ] `Memory` 型に `deletedAt?: Date` フィールド追加
- [ ] `deleteMemory()` で削除タイムスタンプを記録
  ```typescript
  const deletedMemory: Memory = {
    ...existing,
    isDeleted: true,
    deletedAt: new Date(),
    updatedAt: new Date(),
  };
  ```
- [ ] データベーススキーマに `deleted_at` カラム追加
  ```sql
  ALTER TABLE memories ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE;
  CREATE INDEX idx_memories_deleted_at ON memories(deleted_at) WHERE is_deleted = true;
  ```
- [ ] ユニットテスト追加（削除タイムスタンプの検証）

**設計参照**: design.md 行683-696（物理データモデル）、行1109-1382（GDPR準拠削除）

---

### Issue #4: ガベージコレクション機能の実装
**ステータス**: 未実装（スタブのみ）
**優先度**: 高
**関連要件**: requirements.md 1.4（自動整理）

**説明**:
`performGarbageCollection()` は現在 `throw new Error('Not implemented yet')` のみ。ソフト削除された記憶の物理削除と、自動整理機能を実装する必要がある。

**実装内容**:
- [ ] ソフト削除後の物理削除ロジック
  - `deletedAt` から30日経過した記憶を削除
  - `isProtected = true` の記憶は除外
- [ ] ストレージ使用率の監視
  ```typescript
  async function getStorageUsageRatio(): Promise<number> {
    const result = await db.query(`
      SELECT pg_database_size(current_database()) as used,
             current_setting('block_size')::bigint * pg_database.datallowconn as max
      FROM pg_database WHERE datname = current_database()
    `);
    return result.rows[0].used / result.rows[0].max;
  }
  ```
- [ ] 重要度スコアに基づく自動削除
  - `importanceScore < 0.3` かつ `lastAccessedAt < NOW() - INTERVAL '30 days'`
  - ストレージ使用率 ≥ 80% で自動起動
- [ ] バックグラウンドワーカーの実装（定期実行: 5分ごと）
- [ ] 統合テスト追加（GC動作確認、保護記憶の除外確認）

**設計参照**: design.md 行1383-1636（自動整理システム）

---

## 実装優先順位

1. **Issue #3** (deletedAt) - 最も単純、他のIssueの基盤
2. **Issue #4** (GC) - 高優先度、ストレージ管理に必須
3. **Issue #2** (類似性検出) - 高優先度、UX向上
4. **Issue #1** (バージョン履歴) - 中優先度、監査要件

## 完了条件

全Issueが完了し、以下の条件を満たしたとき、タスク3.2を`[x]`にマーク:

- [ ] Issue #1-4 すべて実装完了
- [ ] ユニットテスト全パス（既存35件 + 新規20件以上）
- [ ] 統合テスト追加（GC、類似性検出）
- [ ] コードレビュー完了（`coderabbit --prompt-only`）
- [ ] ドキュメント更新（API仕様、使用例）
