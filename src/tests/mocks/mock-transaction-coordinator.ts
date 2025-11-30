/**
 * MockTransactionCoordinator
 * TransactionCoordinatorのモック実装
 * テスト用途専用 - 履歴管理とSaga操作をシミュレート
 */

import type { MemoryId, MemoryType, MemoryMetadata } from '../../memory/types.js';

export interface MemoryEntity {
    id: MemoryId;
    content: string;
    memoryType: MemoryType;
    metadata: MemoryMetadata;
}

export interface MemoryHistoryEntry {
    id: string;
    memoryId: MemoryId;
    version: number;
    content: string;
    metadata: MemoryMetadata;
    timestamp: Date;
}

export type TransactionResult =
    | {
        status: 'ok';
        memoryId: MemoryId;
    }
    | {
        status: 'partial';
        memoryId: MemoryId;
        warning: {
            type: 'SYNC_FAILURE';
            message: string;
        };
    }
    | {
        status: 'failed';
        error: {
            type: string;
            message: string;
        };
    };

export class MockTransactionCoordinator {
    private versions = new Map<MemoryId, MemoryHistoryEntry[]>();
    private shouldFail = false;
    private shouldPartialFail = false;

    async storeMemoryWithSaga(entity: MemoryEntity): Promise<TransactionResult> {
        if (this.shouldFail) {
            return {
                status: 'failed',
                error: {
                    type: 'STORAGE_ERROR',
                    message: 'Mock storage failure',
                },
            };
        }

        // 初期バージョンを保存
        await this.saveMemoryVersion(entity, 1);

        if (this.shouldPartialFail) {
            return {
                status: 'partial',
                memoryId: entity.id,
                warning: {
                    type: 'SYNC_FAILURE',
                    message: 'Mock partial failure',
                },
            };
        }

        return {
            status: 'ok',
            memoryId: entity.id,
        };
    }

    async updateMemoryWithSaga(entity: MemoryEntity): Promise<TransactionResult> {
        if (this.shouldFail) {
            return {
                status: 'failed',
                error: {
                    type: 'STORAGE_ERROR',
                    message: 'Mock update failure',
                },
            };
        }

        // 現在のバージョン番号を取得
        const existingVersions = this.versions.get(entity.id) || [];
        const newVersion = existingVersions.length + 1;

        // 新しいバージョンを保存
        await this.saveMemoryVersion(entity, newVersion);

        if (this.shouldPartialFail) {
            return {
                status: 'partial',
                memoryId: entity.id,
                warning: {
                    type: 'SYNC_FAILURE',
                    message: 'Mock partial failure',
                },
            };
        }

        return {
            status: 'ok',
            memoryId: entity.id,
        };
    }

    async deleteMemoryWithSaga(id: MemoryId): Promise<TransactionResult> {
        if (this.shouldFail) {
            return {
                status: 'failed',
                error: {
                    type: 'STORAGE_ERROR',
                    message: 'Mock delete failure',
                },
            };
        }

        if (this.shouldPartialFail) {
            return {
                status: 'partial',
                memoryId: id,
                warning: {
                    type: 'SYNC_FAILURE',
                    message: 'Mock partial failure',
                },
            };
        }

        return {
            status: 'ok',
            memoryId: id,
        };
    }

    async saveMemoryVersion(entity: MemoryEntity, version: number): Promise<void> {
        const historyEntry: MemoryHistoryEntry = {
            id: `${entity.id}-v${version}`,
            memoryId: entity.id,
            version,
            content: entity.content,
            metadata: entity.metadata,
            timestamp: new Date(),
        };

        const existingVersions = this.versions.get(entity.id) || [];
        existingVersions.push(historyEntry);
        this.versions.set(entity.id, existingVersions);
    }

    async getMemoryVersions(id: MemoryId): Promise<MemoryHistoryEntry[]> {
        return this.versions.get(id) || [];
    }

    async getMemoryVersion(id: MemoryId, version: number): Promise<MemoryEntity | null> {
        const versions = this.versions.get(id);
        if (!versions) return null;

        const entry = versions.find((v) => v.version === version);
        if (!entry) return null;

        return {
            id: entry.memoryId,
            content: entry.content,
            memoryType: 'semantic', // デフォルト値
            metadata: entry.metadata,
        };
    }

    async hardDeleteMemory(id: MemoryId): Promise<TransactionResult> {
        this.versions.delete(id);

        return {
            status: 'ok',
            memoryId: id,
        };
    }

    async findSoftDeletedMemories(_threshold: Date): Promise<MemoryId[]> {
        // モックでは空配列を返す（実装は不要）
        return [];
    }

    async getDatabaseSize(): Promise<number> {
        // モックでは固定値を返す
        return 1024 * 1024; // 1MB
    }

    async deleteLowImportanceMemories(_threshold: number, _beforeDate: Date): Promise<number> {
        // モックでは0を返す
        return 0;
    }

    // テストヘルパー
    setFailureMode(fail: boolean, partial: boolean = false): void {
        this.shouldFail = fail;
        this.shouldPartialFail = partial;
    }

    clear(): void {
        this.versions.clear();
        this.shouldFail = false;
        this.shouldPartialFail = false;
    }
}
