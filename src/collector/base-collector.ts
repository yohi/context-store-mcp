/**
 * Base Collector implementation for automated conversation data collection
 * Lite mode feature - Monitors log files and extracts conversation data
 * 要件: 3.1, 3.2, 3.5, 5.1, 5.2, 5.4
 */

import { watch, type FSWatcher } from 'node:fs';
import { readFile, writeFile, access } from 'node:fs/promises';
import { Pool } from 'pg';
import { getLogger } from '../monitoring/structured-logger.js';
import type {
  CollectorConfig,
  ConversationEntry,
  CollectorState,
  CollectorResult,
  RetryConfig,
} from './types.js';
import type { MemoryManagerService, StoreMemoryParams } from '../memory/types.js';
import { isDuplicate, createMetadataWithHash } from './duplicate-prevention.js';

const logger = getLogger();

/**
 * Abstract base class for log file collectors
 * Provides common functionality for file watching, incremental processing, and state management
 */
export abstract class BaseCollector {
  protected config: CollectorConfig;
  protected memoryManager: MemoryManagerService;
  protected dbPool: Pool;
  protected lastPosition: number = 0;
  protected watcher?: FSWatcher;
  protected isRunning: boolean = false;
  protected retryConfig: RetryConfig;

  constructor(
    config: CollectorConfig,
    memoryManager: MemoryManagerService,
    dbPool: Pool,
    retryConfig?: Partial<RetryConfig>
  ) {
    this.config = config;
    this.memoryManager = memoryManager;
    this.dbPool = dbPool;
    this.retryConfig = {
      maxRetries: retryConfig?.maxRetries ?? 5,
      initialDelay: retryConfig?.initialDelay ?? 1000,
      maxDelay: retryConfig?.maxDelay ?? 30000,
      backoffMultiplier: retryConfig?.backoffMultiplier ?? 2,
    };
  }

  /**
   * Abstract method to parse a log entry
   * Must be implemented by subclasses for specific log formats
   * 要件: 3.4
   */
  protected abstract parseLogEntry(line: string): ConversationEntry | null;

  /**
   * Start the collector
   * Loads state and begins watching the log file
   * 要件: 3.1, 3.2, 5.1
   */
  async start(): Promise<CollectorResult<void>> {
    if (this.isRunning) {
      return {
        success: false,
        error: {
          type: 'STORAGE_ERROR',
          message: 'Collector is already running',
        },
      };
    }

    // Load previous state
    const stateResult = await this.loadState();
    if (!stateResult.success) {
      const err = new Error(stateResult.error.message);
      logger.warn('Failed to load collector state, starting from beginning', {
        error: err,
      });
      this.lastPosition = 0;
    }

    // Check if log file exists
    try {
      await access(this.config.logPath);
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'LOG_FILE_NOT_FOUND',
          message: `Log file not found: ${this.config.logPath}`,
        },
      };
    }

    // Process any existing content
    await this.processNewContent();

    // Start watching the log file
    try {
      await this.watchLogFile();
      this.isRunning = true;
      logger.info('Collector started', {
        source: this.config.source,
        logPath: this.config.logPath,
        lastPosition: this.lastPosition,
      });

      return { success: true, value: undefined };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to start file watcher', { error: err });
      return {
        success: false,
        error: {
          type: 'STORAGE_ERROR',
          message: `Failed to start file watcher: ${err.message}`,
        },
      };
    }
  }

  /**
   * Stop the collector
   * Saves state and stops watching the log file
   * 要件: 5.4
   */
  async stop(): Promise<CollectorResult<void>> {
    if (!this.isRunning) {
      return {
        success: false,
        error: {
          type: 'STORAGE_ERROR',
          message: 'Collector is not running',
        },
      };
    }

    // Stop file watcher
    if (this.watcher) {
      this.watcher.close();
      // @ts-expect-error - Setting to undefined is intentional for cleanup
      this.watcher = undefined;
    }

    // Save current state
    const saveResult = await this.saveState();
    if (!saveResult.success) {
      const err = new Error(saveResult.error.message);
      logger.error('Failed to save collector state', { error: err });
    }

    this.isRunning = false;
    logger.info('Collector stopped', {
      source: this.config.source,
      lastPosition: this.lastPosition,
    });

    return { success: true, value: undefined };
  }

  /**
   * Watch the log file for changes
   * 要件: 3.1, 3.2
   */
  protected async watchLogFile(): Promise<void> {
    this.watcher = watch(this.config.logPath, async (eventType) => {
      if (eventType === 'change') {
        await this.processNewContent();
      }
    });

    // Handle watcher errors
    this.watcher.on('error', (error) => {
      logger.error('File watcher error', {
        source: this.config.source,
        error,
      });
    });
  }

  /**
   * Process new content from the log file since last position
   * 要件: 3.5, 5.2
   */
  protected async processNewContent(): Promise<void> {
    try {
      // Read file content
      const content = await readFile(this.config.logPath, 'utf-8');

      // Detect log rotation/truncation: if file size is smaller than last position,
      // treat it as a new file and reset position to 0
      if (content.length < this.lastPosition) {
        logger.info('Log rotation detected, resetting position', {
          source: this.config.source,
          previousPosition: this.lastPosition,
          currentFileSize: content.length,
        });
        this.lastPosition = 0;
      }

      // Only process new content since last position
      if (content.length <= this.lastPosition) {
        return;
      }

      const newContent = content.slice(this.lastPosition);
      const lines = newContent.split('\n');

      logger.debug('Processing new content', {
        source: this.config.source,
        newLines: lines.length,
        lastPosition: this.lastPosition,
      });

      // Process each line
      for (const line of lines) {
        if (line.trim().length === 0) {
          continue;
        }

        try {
          const entry = this.parseLogEntry(line);
          if (entry) {
            await this.storeMemoryWithRetry(entry);
          }
        } catch (error) {
          // Log parse errors but continue processing
          // 要件: 3.6
          const err = error instanceof Error ? error : new Error(String(error));
          logger.warn('Failed to parse log entry', {
            source: this.config.source,
            line: line.substring(0, 100), // Log first 100 chars
            error: err,
          });
        }
      }

      // Update position
      this.lastPosition = content.length;

      // Save state periodically
      await this.saveState();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to process new content', {
        source: this.config.source,
        error: err,
      });
    }
  }

  /**
   * Store a conversation entry as memory with automatic tagging
   * 要件: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.5
   */
  protected async storeMemory(entry: ConversationEntry): Promise<CollectorResult<string>> {
    // Check for duplicates first
    // 要件: 5.5 - 重複防止
    const hashMetadata = createMetadataWithHash(
      entry.userMessage,
      entry.aiResponse,
      entry.timestamp
    );

    const duplicate = await isDuplicate(
      this.dbPool,
      hashMetadata.contentHash,
      this.config.source
    );

    if (duplicate) {
      logger.debug('Skipping duplicate conversation entry', {
        source: this.config.source,
        contentHash: hashMetadata.contentHash,
      });
      // Treat duplicates as already-processed (success) to avoid retries
      return {
        success: true,
        value: '', // Empty string as no new memory was created
      };
    }

    // Build tags
    const tags: string[] = [
      `source:${this.config.source}`,
    ];

    if (entry.projectContext) {
      tags.push(`project:${entry.projectContext}`);
    }

    // Create memory content
    const content = `User: ${entry.userMessage}\nAI: ${entry.aiResponse}`;

    // Store memory parameters with lite mode metadata
    const params: StoreMemoryParams = {
      content,
      memoryType: 'episodic', // All collector data is episodic
      metadata: {
        source: this.config.source,
        timestamp: entry.timestamp,
        tags,
        // Add lite mode metadata for duplicate detection and filtering
        ...hashMetadata,
        sourceType: this.config.sourceType,
        ...(entry.projectContext ? { project: entry.projectContext } : {}),
      },
      // Explicit lite_mode_metadata for DB column storage (used by duplicate-prevention queries)
      lite_mode_metadata: {
        contentHash: hashMetadata.contentHash,
        source: this.config.source,
        sourceType: this.config.sourceType,
        ...(entry.projectContext ? { project: entry.projectContext } : {}),
      },
    };

    try {
      const result = await this.memoryManager.storeMemory(params);

      if (result.success) {
        logger.debug('Stored conversation memory', {
          source: this.config.source,
          memoryId: result.value,
          tags,
        });
        return { success: true, value: result.value };
      } else {
        return {
          success: false,
          error: {
            type: 'STORAGE_ERROR',
            message: result.error.message,
          },
        };
      }
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'STORAGE_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Store memory with exponential backoff retry
   * 要件: 5.3
   */
  protected async storeMemoryWithRetry(entry: ConversationEntry): Promise<void> {
    let attempt = 0;
    let delay = this.retryConfig.initialDelay;

    while (attempt < this.retryConfig.maxRetries) {
      const result = await this.storeMemory(entry);

      if (result.success) {
        return;
      }

      // Check if error is retryable (connection errors)
      if (result.error.type === 'CONNECTION_ERROR' || result.error.type === 'STORAGE_ERROR') {
        attempt++;

        if (attempt < this.retryConfig.maxRetries) {
          const err = new Error(result.error.message);
          logger.warn('Storage failed, retrying with exponential backoff', {
            source: this.config.source,
            attempt,
            delay,
            error: err,
          });

          // Wait before retry
          await this.sleep(delay);

          // Calculate next delay with exponential backoff
          delay = Math.min(
            delay * this.retryConfig.backoffMultiplier,
            this.retryConfig.maxDelay
          );
        } else {
          const err = new Error(result.error.message);
          logger.error('Storage failed after max retries', {
            source: this.config.source,
            attempts: attempt,
            error: err,
          });
        }
      } else {
        // Non-retryable error, log and return
        const err = new Error(result.error.message);
        logger.error('Non-retryable storage error', {
          source: this.config.source,
          error: err,
        });
        return;
      }
    }
  }

  /**
   * Load collector state from file
   * 要件: 5.4
   */
  protected async loadState(): Promise<CollectorResult<CollectorState>> {
    try {
      const stateContent = await readFile(this.config.stateFile, 'utf-8');
      const state: CollectorState = JSON.parse(stateContent);

      this.lastPosition = state.lastPosition;

      logger.info('Loaded collector state', {
        source: this.config.source,
        lastPosition: state.lastPosition,
        lastReadAt: state.lastReadAt,
      });

      return { success: true, value: state };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // State file doesn't exist yet, this is normal for first run
        return {
          success: false,
          error: {
            type: 'STATE_FILE_ERROR',
            message: 'State file not found (first run)',
          },
        };
      }

      return {
        success: false,
        error: {
          type: 'STATE_FILE_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Save collector state to file
   * 要件: 5.4
   */
  protected async saveState(): Promise<CollectorResult<void>> {
    const state: CollectorState = {
      lastPosition: this.lastPosition,
      lastReadAt: new Date(),
      collectorId: `${this.config.source}-${this.config.sourceType}`,
    };

    try {
      await writeFile(this.config.stateFile, JSON.stringify(state, null, 2), 'utf-8');

      logger.debug('Saved collector state', {
        source: this.config.source,
        lastPosition: this.lastPosition,
      });

      return { success: true, value: undefined };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'STATE_FILE_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get collector status
   */
  getStatus(): {
    isRunning: boolean;
    source: string;
    sourceType: string;
    lastPosition: number;
  } {
    return {
      isRunning: this.isRunning,
      source: this.config.source,
      sourceType: this.config.sourceType,
      lastPosition: this.lastPosition,
    };
  }
}
