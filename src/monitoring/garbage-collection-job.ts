/**
 * Garbage Collection Job
 * Requirements: Task 3.2 Issue #4
 */

import type { MemoryManager } from '../memory/memory-manager.js';

export interface GarbageCollectionJobConfig {
    interval?: number; // Default: 5 minutes
    enabled?: boolean;
}

export class GarbageCollectionJob {
    private interval: number;
    private enabled: boolean;
    private timer: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;

    constructor(
        private memoryManager: MemoryManager,
        config?: GarbageCollectionJobConfig
    ) {
        this.interval = config?.interval ?? 5 * 60 * 1000; // 5 minutes
        this.enabled = config?.enabled ?? true;
    }

    start(): void {
        if (!this.enabled || this.timer) return;

        console.log('[GC Job] Starting garbage collection job...');
        this.timer = setInterval(async () => {
            if (this.isRunning) return;

            this.isRunning = true;
            try {
                console.log('[GC Job] Running garbage collection...');
                await this.memoryManager.performGarbageCollection();
                console.log('[GC Job] Garbage collection completed.');
            } catch (error) {
                console.error('[GC Job] Garbage collection failed:', error);
            } finally {
                this.isRunning = false;
            }
        }, this.interval);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            console.log('[GC Job] Stopped garbage collection job.');
        }
    }
}
