# MemoryManager Resource Disposal Implementation

## 概要

このドキュメントは、MemoryManagerのリソース管理機能の実装について説明します。この実装により、MemoryManagerが作成したPostgreSQLの接続プールが適切にクリーンアップされ、リソースリークが防止されます。

## 実装内容

### 1. PostgresStorageAdapterへのclose()メソッドの追加

**ファイル**: `src/storage/postgres-store-adapter.ts`

PostgresStorageAdapterに`close()`メソッドを追加しました。このメソッドは、内部のPostgreSQL接続プールを適切にクローズします。

```typescript
async close(): Promise<void> {
    await this.pool.end();
}
```

### 2. MemoryManagerへの所有権追跡とdispose()メソッドの追加

**ファイル**: `src/memory/memory-manager.ts`

#### 追加されたプロパティ

- `ownsStorage: boolean` - MemoryManagerが接続プールを作成したかどうかを追跡
- `isDisposed: boolean` - dispose()が既に呼ばれたかを追跡（冪等性のため）

#### コンストラクタの変更

コンストラクタで、ストレージアダプターが外部から提供されたか、内部で作成されたかを追跡するようになりました：

```typescript
constructor(config?: MemoryManagerConfig) {
  if (config?.storage) {
    this.storage = config.storage;
    this.ownsStorage = false; // 外部から提供されたストレージ
  } else {
    // デフォルトでPostgreSQLアダプターを使用
    const pool = new Pool({...});
    this.storage = new PostgresStorageAdapter(pool);
    this.ownsStorage = true; // このMemoryManagerがPoolを作成した
  }
  // ...
}
```

#### dispose()メソッドの実装

新しい`dispose()`メソッドは以下の特徴を持ちます：

- **条件付きクリーンアップ**: MemoryManagerが接続プールを作成した場合のみクローズ
- **冪等性**: 複数回呼び出しても安全
- **エラー処理**: pool.end()のエラーを適切に伝播

```typescript
async dispose(): Promise<void> {
  // 既にdisposeされている場合は何もしない（冪等性）
  if (this.isDisposed) {
    return;
  }

  // このMemoryManagerがストレージを作成した場合のみクローズ
  if (this.ownsStorage && this.storage instanceof PostgresStorageAdapter) {
    try {
      await this.storage.close();
      console.log('MemoryManager: PostgreSQL connection pool closed');
    } catch (error) {
      console.error('MemoryManager: Error closing storage:', error);
      throw error;
    }
  }

  this.isDisposed = true;
}
```

### 3. MCPサーバーのクリーンアップ処理の更新

**ファイル**: `src/mcp/server.ts`

サーバーのクリーンアップ関数を更新し、`memoryManager.dispose()`を呼び出すようにしました：

```typescript
const cleanup = async (): Promise<void> => {
  console.error('Shutting down Context Store MCP Server...');

  // GCジョブを停止
  gcJob.stop();

  // MemoryManagerのリソースをクリーンアップ
  try {
    await memoryManager.dispose();
  } catch (error) {
    console.error('Error disposing MemoryManager:', error);
  }

  // その他のクリーンアップ処理...
};
```

### 4. テストの追加

**ファイル**: `src/tests/memory/memory-manager-dispose.test.ts`

以下のシナリオをカバーする包括的なテストを追加しました：

- dispose()メソッドが存在し、呼び出し可能であること
- 外部提供のストレージの場合、プールをクローズしないこと
- 冪等性（複数回呼び出しても安全）
- PostgresStorageAdapter.close()が正しくpool.end()を呼び出すこと
- エラーが適切に伝播されること

### 5. ドキュメントの更新

**ファイル**: `README.md`

READMEに「リソース管理」セクションを追加し、以下を説明しました：

- dispose()メソッドの使用方法
- 自動作成されたプールと外部提供のストレージの違い
- 冪等性の保証
- 実装例

## 使用方法

### 基本的な使用方法（自動作成されたプール）

```typescript
import { MemoryManager } from './memory/memory-manager.js';

const memoryManager = new MemoryManager();

// シャットダウン時
process.on('SIGTERM', async () => {
  await memoryManager.dispose();
  process.exit(0);
});
```

### 外部ストレージを使用する場合

```typescript
import { Pool } from 'pg';
import { PostgresStorageAdapter } from './storage/postgres-store-adapter.js';
import { MemoryManager } from './memory/memory-manager.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const storage = new PostgresStorageAdapter(pool);
const memoryManager = new MemoryManager({ storage });

// シャットダウン時
await memoryManager.dispose(); // 何もしない（外部管理のため）
await pool.end(); // 呼び出し側が明示的にクローズ
```

## 設計上の決定事項

### 1. 所有権ベースのクリーンアップ

MemoryManagerは、自身が作成したリソースのみをクリーンアップします。これにより：

- **責任の明確化**: リソースを作成した側が解放の責任を持つ
- **柔軟性**: 外部でプールを管理する場合の制御を維持
- **安全性**: 二重解放を防止

### 2. 冪等性

dispose()メソッドは冪等であり、複数回呼び出しても安全です。これにより：

- **エラー処理の簡素化**: クリーンアップコードでの例外処理が容易
- **シャットダウンの堅牢性**: 複数のシャットダウンパスがあっても安全

### 3. エラー伝播

pool.end()のエラーは適切に伝播されます。これにより：

- **デバッグの容易さ**: クリーンアップ時の問題を検出可能
- **ログ記録**: エラーがコンソールに記録される

## テスト結果

すべてのテストが成功しました：

```
✓ src/tests/memory/memory-manager-dispose.test.ts (5)
  ✓ MemoryManager Disposal (5)
    ✓ dispose() method (3)
      ✓ should exist and be callable
      ✓ should not close the pool when storage is provided externally
      ✓ should be idempotent when storage is external
    ✓ PostgresStorageAdapter close() method (2)
      ✓ should close the pool when called
      ✓ should propagate errors from pool.end()

Test Files  1 passed (1)
     Tests  5 passed (5)
```

## 影響範囲

### 変更されたファイル

1. `src/storage/postgres-store-adapter.ts` - close()メソッドの追加
2. `src/memory/memory-manager.ts` - 所有権追跡とdispose()メソッドの追加
3. `src/mcp/server.ts` - クリーンアップ処理の更新
4. `src/tests/integration/global-setup.ts` - 未使用のインポートの削除（ビルドエラー修正）
5. `src/tests/memory/memory-manager-dispose.test.ts` - 新規テストファイル
6. `README.md` - リソース管理のドキュメント追加

### 後方互換性

この変更は完全に後方互換性があります：

- 既存のコードは変更なしで動作します
- dispose()の呼び出しはオプションです（推奨されますが必須ではありません）
- 既存のテストはすべて成功します

## 今後の推奨事項

1. **アプリケーションコードの更新**: すべてのMemoryManagerインスタンスでdispose()を呼び出すようにする
2. **監視の追加**: dispose()の呼び出しを監視し、適切なクリーンアップを確認
3. **ドキュメントの拡充**: 他のストレージアダプター（Neo4j、Redis等）にも同様のクリーンアップメソッドを追加

## まとめ

この実装により、MemoryManagerは適切なリソース管理を行い、PostgreSQL接続プールのリークを防止します。実装は以下の原則に従っています：

- **明確な所有権**: リソースを作成した側が解放の責任を持つ
- **冪等性**: 複数回の呼び出しに対して安全
- **エラー処理**: 適切なエラー伝播とログ記録
- **後方互換性**: 既存のコードへの影響なし
- **テスト可能性**: 包括的なユニットテスト
