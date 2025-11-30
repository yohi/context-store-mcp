# Fix: Rollback Restore Memory Bug

## Problem

In `src/memory/memory-manager.ts` around lines 800-809, the rollback mechanism in `mergeMemories` tried to restore soft-deleted memories by calling:

```typescript
await this.updateMemory(deletedId, { isDeleted: false, deletedAt: null });
```

However, this had no effect because `updateMemory` (lines 243-267) explicitly filters out protected fields including `isDeleted` and `deletedAt`:

```typescript
const {
  id: _id,
  createdAt: _createdAt,
  isDeleted: _isDeleted,      // ← Filtered out
  deletedAt: _deletedAt,      // ← Filtered out
  metadata: _metadata,
  version: _version,
  ...allowedUpdates
} = updates;
```

This meant that when a merge operation failed partway through, the already-deleted source memories could not be restored, leaving the system in an inconsistent state.

## Solution

Added a dedicated private method `restoreMemory(id: MemoryId)` that:

1. **Bypasses the protected field filtering** by performing a direct database update
2. **Sets `is_deleted = false` and `deleted_at = null`** directly in PostgreSQL
3. **Handles both TransactionCoordinator and direct storage adapter** scenarios
4. **Returns proper error handling** with Result<boolean, MemoryError>

### Implementation Details

The method is implemented at lines 425-490 and works as follows:

- If `TransactionCoordinator` is available, it accesses the PostgreSQL pool directly via `(this.transactionCoordinator as any).postgresPool`
- If only the storage adapter is available, it accesses the pool via `(this.storage as any).pool`
- Executes: `UPDATE memories SET is_deleted = false, deleted_at = null WHERE id = $1`

### Updated Rollback Logic

The rollback code in `mergeMemories` (line 875) now uses:

```typescript
await this.restoreMemory(deletedId);
```

Instead of the ineffective `updateMemory` call.

## Alternative Approaches Considered

1. **Add an `allowProtected` flag to `updateMemory`**: This would work but would expose protected field modification to all callers, which could lead to misuse.

2. **Add a dedicated `undeleteMemory` public method**: This could be useful for user-facing features, but for now the rollback scenario is the only use case, so a private method is more appropriate.

3. **Use TransactionCoordinator's saga pattern**: This would be the ideal solution, but would require significant refactoring of the merge operation to be a proper saga transaction.

## Testing

- All integration tests pass (43 tests in 6 files)
- The fix ensures that rollback operations can now properly restore soft-deleted memories
- Type checking passes with no errors related to this change

## Files Modified

- `src/memory/memory-manager.ts`:
  - Added `restoreMemory` method (lines 425-490)
  - Updated rollback logic in `mergeMemories` (line 875)
