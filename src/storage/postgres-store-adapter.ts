import type { Pool } from 'pg';
import type { StorageAdapter } from './storage-adapter.js';
import type { Memory, MemoryId, SearchParams } from '../memory/types.js';

export class PostgresStorageAdapter implements StorageAdapter {
    private pool: Pool;

    constructor(pool: Pool) {
        this.pool = pool;
    }

    async storeMemory(memory: Memory): Promise<MemoryId> {
        const query = `
      INSERT INTO memories (id, content, memory_type, metadata, created_at, updated_at, last_accessed_at, access_count, importance_score, is_deleted, is_protected, deleted_at, version)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id
    `;
        const values = [
            memory.id,
            memory.content,
            memory.memoryType,
            JSON.stringify(memory.metadata),
            memory.createdAt,
            memory.updatedAt,
            memory.lastAccessedAt,
            memory.accessCount,
            memory.importanceScore,
            memory.isDeleted,
            memory.isProtected,
            memory.deletedAt,
            memory.version,
        ];

        const result = await this.pool.query(query, values);
        return result.rows[0].id;
    }

    async getMemory(id: MemoryId): Promise<Memory | null> {
        const query = `SELECT * FROM memories WHERE id = $1`;
        const result = await this.pool.query(query, [id]);

        if (result.rows.length === 0) {
            return null;
        }

        return this.mapRowToMemory(result.rows[0]);
    }

    async updateMemory(id: MemoryId, updates: Partial<Memory>): Promise<boolean> {
        const allowedUpdates = [
            'content',
            'memory_type',
            'metadata',
            'updated_at',
            'last_accessed_at',
            'access_count',
            'importance_score',
            'is_deleted',
            'is_protected',
            'deleted_at',
            'version',
        ];

        const setClauses: string[] = [];
        const values: any[] = [id];
        let paramIndex = 2;

        for (const [key, value] of Object.entries(updates)) {
            // Map camelCase to snake_case
            const dbKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

            if (allowedUpdates.includes(dbKey)) {
                setClauses.push(`${dbKey} = $${paramIndex}`);
                values.push(key === 'metadata' ? JSON.stringify(value) : value);
                paramIndex++;
            }
        }

        if (setClauses.length === 0) {
            return false;
        }

        const query = `UPDATE memories SET ${setClauses.join(', ')} WHERE id = $1`;
        const result = await this.pool.query(query, values);

        return (result.rowCount ?? 0) > 0;
    }

    async deleteMemory(id: MemoryId): Promise<boolean> {
        // Soft delete
        const query = `UPDATE memories SET is_deleted = true, deleted_at = NOW() WHERE id = $1`;
        const result = await this.pool.query(query, [id]);
        return (result.rowCount ?? 0) > 0;
    }

    async searchMemories(params: SearchParams): Promise<Memory[]> {
        let query = `SELECT * FROM memories WHERE is_deleted = false`;
        const values: any[] = [];
        let paramIndex = 1;

        if (params.query) {
            // Basic text search if query is provided (though vector search is preferred)
            query += ` AND content ILIKE $${paramIndex}`;
            values.push(`%${params.query}%`);
            paramIndex++;
        }

        if (params.memoryTypes && params.memoryTypes.length > 0) {
            query += ` AND memory_type = ANY($${paramIndex})`;
            values.push(params.memoryTypes);
            paramIndex++;
        }

        if (params.tags && params.tags.length > 0) {
            query += ` AND metadata->'tags' ?| $${paramIndex}`;
            values.push(params.tags);
            paramIndex++;
        }

        if (params.userId) {
            query += ` AND metadata->>'userId' = $${paramIndex}`;
            values.push(params.userId);
            paramIndex++;
        }

        if (params.projectId) {
            query += ` AND metadata->>'projectId' = $${paramIndex}`;
            values.push(params.projectId);
            paramIndex++;
        }

        if (params.limit) {
            query += ` LIMIT $${paramIndex}`;
            values.push(params.limit);
            paramIndex++;
        }

        const result = await this.pool.query(query, values);
        return result.rows.map(this.mapRowToMemory);
    }

    async getAllMemoryIds(): Promise<MemoryId[]> {
        const query = `SELECT id FROM memories WHERE is_deleted = false`;
        const result = await this.pool.query(query);
        return result.rows.map((row) => row.id);
    }

    private mapRowToMemory(row: any): Memory {
        return {
            id: row.id,
            content: row.content,
            memoryType: row.memory_type,
            metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
            lastAccessedAt: new Date(row.last_accessed_at),
            accessCount: row.access_count,
            importanceScore: row.importance_score == null ? 0 : (typeof row.importance_score === 'number' ? row.importance_score : parseFloat(row.importance_score)) || 0,
            isDeleted: row.is_deleted,
            isProtected: row.is_protected,
            deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
            version: row.version,
        };
    }

    /**
     * データベース接続プールをクローズする
     * すべてのアクティブな接続を終了し、リソースを解放します
     */
    async close(): Promise<void> {
        await this.pool.end();
    }
}
