# Fix: ImportanceScore NaN Handling

## Problem

In `src/storage/postgres-store-adapter.ts` at line 158, the mapping used:

```typescript
importanceScore: parseFloat(row.importance_score),
```

This caused issues when `row.importance_score` was `null` or `undefined`:
- `parseFloat(null)` returns `NaN`
- `parseFloat(undefined)` returns `NaN`
- `NaN` propagates through calculations and can cause unexpected behavior

## Solution

Updated the mapping to safely handle null/undefined values and non-numeric values:

```typescript
importanceScore: row.importance_score == null 
  ? 0 
  : (typeof row.importance_score === 'number' 
      ? row.importance_score 
      : parseFloat(row.importance_score)) || 0,
```

### Logic Flow

1. **Check for null/undefined**: `row.importance_score == null`
   - Returns `0` if the value is `null` or `undefined`

2. **Check if already a number**: `typeof row.importance_score === 'number'`
   - If it's already a number, use it directly (avoids unnecessary parsing)

3. **Parse string values**: `parseFloat(row.importance_score)`
   - Attempts to parse the value as a float

4. **Fallback to 0**: `|| 0`
   - If `parseFloat` returns `NaN` or `0`, the `|| 0` ensures we get `0`
   - This handles non-numeric strings, empty strings, etc.

### Edge Cases Handled

- ✅ `null` → `0`
- ✅ `undefined` → `0`
- ✅ `NaN` → `0`
- ✅ Empty string `""` → `0`
- ✅ Non-numeric string `"invalid"` → `0`
- ✅ Numeric string `"0.75"` → `0.75`
- ✅ Number `0.75` → `0.75`
- ✅ Zero `0` → `0`
- ✅ Negative numbers `-0.5` → `-0.5`

### Note on Infinity

The current implementation allows `Infinity` to pass through since it's technically a number. If we need to guard against `Infinity`, we could add:

```typescript
importanceScore: row.importance_score == null 
  ? 0 
  : (typeof row.importance_score === 'number' && Number.isFinite(row.importance_score)
      ? row.importance_score 
      : parseFloat(row.importance_score)) || 0,
```

However, for the current use case, this is not necessary as database numeric columns typically don't store `Infinity`.

## Testing

Created comprehensive unit tests in `src/tests/storage/importance-score-mapping.test.ts` that verify:
- All edge cases are handled correctly
- The function never returns `NaN`
- All return values are finite numbers (or `Infinity` in the edge case)

All 11 tests pass successfully.

## Files Modified

- `src/storage/postgres-store-adapter.ts` (line 158): Updated `importanceScore` mapping
- `src/tests/storage/importance-score-mapping.test.ts`: Added comprehensive unit tests

## Impact

This fix ensures that:
1. Memory objects always have a valid numeric `importanceScore`
2. No `NaN` values propagate through the system
3. Database null values are handled gracefully
4. The system is more robust against unexpected data
