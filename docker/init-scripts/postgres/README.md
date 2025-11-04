# PostgreSQL Schema and Migrations

## Schema Files

### 01-enable-extensions.sql
Enables required PostgreSQL extensions:
- `uuid-ossp`: UUID generation functions
- `pgvector`: Vector similarity search support

### 02-create-schema.sql
Creates the initial database schema including:
- `memories` table with all core fields including `sync_status`
- `memory_vectors` table for vector embeddings
- Related audit and tracking tables
- All necessary indexes

### 03-add-sync-status-column.sql
Migration script to add `sync_status` column to existing `memories` table.

## sync_status Column

The `sync_status` column tracks synchronization state between PostgreSQL and Neo4j:

- **Type**: `VARCHAR(20)`
- **Default**: `'synced'`
- **Allowed Values**:
  - `'synced'`: Data is synchronized in both PostgreSQL and Neo4j
  - `'pending_graph'`: Saved in PostgreSQL, pending Neo4j sync
  - `'failed'`: Synchronization failed, needs retry
  - `'error'`: Error state, manual intervention may be required

### Usage in Code

Referenced by:
- `src/storage/failover-manager.ts`: Handles failover scenarios
- `src/storage/transaction-coordinator.ts`: Coordinates cross-database transactions

## Applying Migrations

### For New Databases

When creating a fresh database, all scripts run automatically in order (01, 02, 03...).

### For Existing Databases

To apply the `sync_status` migration to an existing database:

```bash
# Using docker exec
docker exec <postgres-container> psql -U <user> -d context_store -f /docker-entrypoint-initdb.d/03-add-sync-status-column.sql

# Using psql directly
psql -U context_store_user -d context_store -f docker/init-scripts/postgres/03-add-sync-status-column.sql
```

### Migration Script Features

The migration script (`03-add-sync-status-column.sql`):
- ✅ Checks if column already exists (idempotent)
- ✅ Adds column with CHECK constraint
- ✅ Creates partial index for non-synced records
- ✅ Sets default value for existing records
- ✅ Provides clear feedback via NOTICE messages

## Index Strategy

The `sync_status` column uses a **partial index**:

```sql
CREATE INDEX idx_memories_sync_status
ON memories(sync_status)
WHERE sync_status != 'synced';
```

**Benefits**:
- Smaller index size (only indexes non-synced records)
- Faster queries for finding pending/failed syncs
- No index overhead for the common case (synced records)

## Testing

Tests automatically use `context_store_test` database to avoid affecting production data.

See `src/tests/storage/failover-manager.test.ts` for test coverage.
