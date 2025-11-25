import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BackupManager } from '../../monitoring/backup-manager';
import * as path from 'path';

// Mock child_process
vi.mock('child_process', () => {
    return {
        execFile: vi.fn((cmd, args, options, callback) => {
            // Handle optional args/options
            const cb = typeof options === 'function' ? options : callback;
            if (cb) {
                cb(null, 'stdout', 'stderr');
            }
            return { stdout: 'stdout', stderr: 'stderr' } as any;
        }),
    };
});

// Mock fs to avoid actual file operations
vi.mock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs');
    return {
        ...actual,
        existsSync: vi.fn().mockReturnValue(true),
        mkdirSync: vi.fn(),
        unlinkSync: vi.fn(),
        statSync: vi.fn().mockReturnValue({ size: 1024 }),
    };
});

describe('BackupManager Command Execution', () => {
    const testConfig = {
        backupDir: '/tmp/backups',
        databases: {
            postgresql: {
                host: 'localhost',
                port: 5432,
                database: 'mydb',
                username: 'user',
                password: 'pgpassword',
            },
            neo4j: {
                host: 'localhost',
                port: 7687,
                database: 'graphdb',
                username: 'neo4j',
                password: 'neopassword',
            },
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should execute pg_dump with correct arguments and env', async () => {
        const manager = new BackupManager(testConfig);
        const { execFile } = await import('child_process');

        await manager.performBackup();

        // Verify pg_dump call
        expect(execFile).toHaveBeenCalledWith(
            'pg_dump',
            expect.arrayContaining([
                '-h', 'localhost',
                '-p', '5432',
                '-U', 'user',
                '-d', 'mydb',
                '-F', 'p',
                expect.stringContaining('postgresql.sql')
            ]),
            expect.objectContaining({
                env: expect.objectContaining({
                    PGPASSWORD: 'pgpassword',
                }),
            }),
            expect.any(Function)
        );
    });

    it('should execute neo4j-admin with correct arguments', async () => {
        const manager = new BackupManager(testConfig);
        const { execFile } = await import('child_process');

        await manager.performBackup();

        // Verify neo4j-admin call
        expect(execFile).toHaveBeenCalledWith(
            'neo4j-admin',
            expect.arrayContaining([
                'dump',
                '--database', 'graphdb',
                '--to', expect.stringContaining('neo4j.dump'),
            ]),
            expect.any(Function)
        );
    });

    it('should execute tar with correct arguments and cwd', async () => {
        const manager = new BackupManager(testConfig);
        const { execFile } = await import('child_process');

        await manager.performBackup();

        // Verify tar call
        expect(execFile).toHaveBeenCalledWith(
            'tar',
            expect.arrayContaining([
                '-czf',
                expect.stringContaining('.tar.gz'),
                expect.stringContaining('postgresql.sql'), // checking if filenames are passed
                expect.stringContaining('neo4j.dump')
            ]),
            expect.objectContaining({
                cwd: '/tmp/backups'
            }),
            expect.any(Function)
        );
    });
});
