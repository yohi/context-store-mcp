/**
 * Collector system types and interfaces
 * Lite mode feature - Automated conversation data collection
 */

/**
 * Source type classification for collectors
 */
export type SourceType = 'desktop-app' | 'ide' | 'cli-agent';

/**
 * Collector configuration interface
 * 要件: 3.1, 3.2, 3.3, 5.1
 */
export interface CollectorConfig {
  /** Path to the log file to monitor */
  logPath: string;
  
  /** Source identifier (e.g., 'claude-desktop', 'cursor', 'claude-code') */
  source: string;
  
  /** Type of source (AI Desktop App, AI IDE, or CLI Agent) */
  sourceType: SourceType;
  
  /** Polling interval in milliseconds for checking file changes */
  pollInterval: number;
  
  /** Path to the state file for persisting collector position */
  stateFile: string;
}

/**
 * Parsed conversation entry from log files
 * 要件: 3.4, 3.5
 */
export interface ConversationEntry {
  /** User's message/input */
  userMessage: string;
  
  /** AI's response/output */
  aiResponse: string;
  
  /** Timestamp of the conversation */
  timestamp: Date;
  
  /** Optional project context (workspace, directory, etc.) */
  projectContext?: string;
}

/**
 * Collector state for persistence
 * 要件: 5.4
 */
export interface CollectorState {
  /** Last read position in the log file (byte offset) */
  lastPosition: number;
  
  /** Timestamp of last successful read */
  lastReadAt: Date;
  
  /** Collector identifier */
  collectorId: string;
}

/**
 * Retry configuration for exponential backoff
 * 要件: 5.3
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  
  /** Initial delay in milliseconds */
  initialDelay: number;
  
  /** Maximum delay in milliseconds */
  maxDelay: number;
  
  /** Backoff multiplier (typically 2 for exponential backoff) */
  backoffMultiplier: number;
}

/**
 * Collector error types
 */
export type CollectorError =
  | { type: 'LOG_FILE_NOT_FOUND'; message: string }
  | { type: 'PARSE_ERROR'; message: string; line?: string }
  | { type: 'CONNECTION_ERROR'; message: string }
  | { type: 'STORAGE_ERROR'; message: string }
  | { type: 'STATE_FILE_ERROR'; message: string };

/**
 * Result type for collector operations
 */
export type CollectorResult<T> = 
  | { success: true; value: T }
  | { success: false; error: CollectorError };
