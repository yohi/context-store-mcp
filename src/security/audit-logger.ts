/**
 * Audit Logger
 *
 * Requirements: 6.5 - 監査ログの維持
 * - ログ保持期間: 365日間（1年間）保持
 * - 不変ストレージ: WORM（Write-Once-Read-Many）ストレージ
 * - 必須フィールド: timestamp, event_type, user_id, session_id, ip_address, resource_id, action, result
 * - オプションフィールド: error_code, metadata
 * - 検索/クエリSLA:
 *   - 過去30日間（ホットストレージ）: 5秒以内に検索可能
 *   - 31日～365日（コールドストレージ）: 30秒以内に検索可能
 * - アクセス履歴追跡: 各記憶ごとにアクセス履歴を管理
 * - 改ざん防止: デジタル署名（HMAC-SHA256）を付与
 */

import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

/**
 * Deep freeze an object recursively to make it immutable (WORM requirement)
 * Handles cycles using WeakSet and freezes both objects and arrays
 *
 * @param obj - Object or array to freeze
 * @param visited - WeakSet to track visited objects (prevents infinite recursion on cycles)
 * @returns Deeply frozen object
 */
function deepFreeze<T>(obj: T, visited: WeakSet<object> = new WeakSet()): T {
  // Skip primitives, null, undefined, and functions
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // Skip if already frozen
  if (Object.isFrozen(obj)) {
    return obj;
  }

  // Handle cycles: skip if already visited
  if (visited.has(obj)) {
    return obj;
  }

  // Mark as visited
  visited.add(obj);

  // Freeze the object/array itself
  Object.freeze(obj);

  // Recursively freeze all properties (works for both objects and arrays)
  Object.getOwnPropertyNames(obj).forEach((prop) => {
    const value = (obj as Record<string, unknown>)[prop];

    // Recursively freeze nested objects/arrays
    if (value !== null && typeof value === 'object') {
      deepFreeze(value, visited);
    }
  });

  return obj;
}

/**
 * Event types for audit logging
 */
export type EventType =
  | 'memory_created'
  | 'memory_updated'
  | 'memory_deleted'
  | 'memory_searched'
  | 'auth_success'
  | 'auth_failed';

/**
 * Event result status
 */
export type EventResult = 'success' | 'failure';

/**
 * Audit log entry structure
 */
export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  eventType: EventType;
  userId: string;
  sessionId: string;
  ipAddress: string;
  resourceId: string;
  action: string;
  result: EventResult;
  errorCode?: string;
  metadata?: Record<string, unknown>;
  signature: string;
}

/**
 * Parameters for logging an event
 */
export interface LogEventParams {
  eventType: EventType;
  userId: string;
  sessionId: string;
  ipAddress: string;
  resourceId: string;
  action: string;
  result: EventResult;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Query parameters for log search
 */
export interface QueryLogsParams {
  userId?: string;
  eventType?: EventType;
  resourceId?: string;
  startTime?: Date;
  endTime?: Date;
  result?: EventResult;
  limit?: number;
  offset?: number;
}

/**
 * Access history for a memory
 */
export interface AccessHistory {
  memoryId: string;
  totalAccesses: number;
  lastAccessedAt: Date | null;
  accessLog: AuditLogEntry[];
  uniqueUsers: Set<string>;
}

/**
 * Export format
 */
export type ExportFormat = 'json' | 'csv';

/**
 * Export parameters
 */
export interface ExportLogsParams {
  format: ExportFormat;
  startTime?: Date;
  endTime?: Date;
  userId?: string;
  eventType?: EventType;
}

/**
 * Audit Logger
 *
 * Provides tamper-evident audit logging with HMAC-SHA256 signatures
 */
export class AuditLogger {
  private logs: Map<string, AuditLogEntry>;
  private readonly secretKey: string;
  private readonly allowMutableLogs: boolean;

  /**
   * Create a new AuditLogger instance
   *
   * @param secretKey - Secret key for HMAC signature generation
   * @param options - Optional configuration
   * @param options.allowMutableLogs - Allow log mutations (for testing only, ignored in production)
   * @throws Error if no secret key is provided in production environment
   * @throws Error if secret key has insufficient entropy
   */
  constructor(secretKey?: string, options?: { allowMutableLogs?: boolean }) {
    this.logs = new Map();

    const isProduction = process.env['NODE_ENV'] === 'production';
    const providedKey = secretKey || process.env['AUDIT_LOG_SECRET_KEY'];

    // In production, secret key is required
    if (isProduction && !providedKey) {
      throw new Error(
        'AUDIT_LOG_SECRET_KEY is required in production environment. ' +
          'Set the AUDIT_LOG_SECRET_KEY environment variable or provide a secretKey parameter.'
      );
    }

    // Use provided key or fallback to development default
    const effectiveKey = providedKey || 'default-secret-key-for-development';

    // Validate secret key entropy
    this.validateSecretKey(effectiveKey, isProduction);

    this.secretKey = effectiveKey;

    // WORM enforcement: logs are immutable in production regardless of option
    // allowMutableLogs only applies to non-production environments (for testing)
    this.allowMutableLogs = isProduction ? false : (options?.allowMutableLogs ?? true);
  }

  /**
   * Validate secret key entropy
   *
   * @param key - Secret key to validate
   * @param isProduction - Whether running in production environment
   * @throws Error if key is weak in production
   */
  private validateSecretKey(key: string, isProduction: boolean): void {
    const MIN_LENGTH = 32;
    const weakKeys = [
      'default-secret-key-for-development',
      'test',
      'password',
      'secret',
      '123456',
      'changeme',
    ];

    const isWeak = key.length < MIN_LENGTH || weakKeys.includes(key.toLowerCase());

    if (isProduction && isWeak) {
      throw new Error(
        `Weak secret key detected in production. Secret key must be at least ${MIN_LENGTH} characters ` +
          'and not be a common weak value. Generate a strong random key for production use.'
      );
    }

    if (!isProduction && isWeak) {
      console.warn(
        '[AuditLogger] WARNING: Using weak or default secret key in development. ' +
          `For production, use a strong key with at least ${MIN_LENGTH} characters.`
      );
    }
  }

  /**
   * Log an audit event
   *
   * @param params - Event parameters
   * @returns The created audit log entry
   */
  async logEvent(params: LogEventParams): Promise<AuditLogEntry> {
    const id = randomUUID();
    const timestamp = new Date();

    // Create entry without signature first
    const entryWithoutSignature: Omit<AuditLogEntry, 'signature'> = {
      id,
      timestamp,
      eventType: params.eventType,
      userId: params.userId,
      sessionId: params.sessionId,
      ipAddress: params.ipAddress,
      resourceId: params.resourceId,
      action: params.action,
      result: params.result,
      ...(params.errorCode && { errorCode: params.errorCode }),
      ...(params.metadata && { metadata: params.metadata }),
    };

    // Generate signature
    const signature = this.generateSignature(entryWithoutSignature);

    // Create final entry with signature
    let entry: AuditLogEntry = {
      ...entryWithoutSignature,
      signature,
    };

    // Deep freeze in production to enforce WORM (Write-Once-Read-Many)
    if (process.env['NODE_ENV'] === 'production') {
      entry = deepFreeze(entry);
    }

    // Store in memory (in production, this would be written to WORM storage)
    this.logs.set(id, entry);

    return entry;
  }

  /**
   * Query audit logs
   *
   * @param params - Query parameters
   * @returns Matching audit log entries
   */
  async queryLogs(params: QueryLogsParams): Promise<AuditLogEntry[]> {
    let results = Array.from(this.logs.values());

    // Apply filters
    if (params.userId) {
      results = results.filter((log) => log.userId === params.userId);
    }

    if (params.eventType) {
      results = results.filter((log) => log.eventType === params.eventType);
    }

    if (params.resourceId) {
      results = results.filter((log) => log.resourceId === params.resourceId);
    }

    if (params.result) {
      results = results.filter((log) => log.result === params.result);
    }

    if (params.startTime) {
      results = results.filter((log) => log.timestamp >= params.startTime!);
    }

    if (params.endTime) {
      results = results.filter((log) => log.timestamp <= params.endTime!);
    }

    // Sort by timestamp descending (newest first)
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply pagination
    const offset = params.offset || 0;
    const limit = params.limit || results.length;

    // In production, entries are already deep-frozen (immutable)
    // In non-production (e.g., tests), return mutable references for test flexibility
    return results.slice(offset, offset + limit);
  }

  /**
   * Verify the signature of an audit log entry
   *
   * Uses constant-time comparison to prevent timing attacks
   *
   * @param entry - Audit log entry to verify
   * @returns True if signature is valid, false otherwise
   */
  async verifySignature(entry: AuditLogEntry): Promise<boolean> {
    const entryWithoutSignature = this.buildEntryWithoutSignature(entry);

    const expectedSignature = this.generateSignature(entryWithoutSignature);

    // Convert signatures to Buffers for constant-time comparison
    // Both signatures are hex-encoded strings
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const actualBuffer = Buffer.from(entry.signature, 'hex');

    // Check lengths first to avoid timingSafeEqual exceptions
    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }

    // Use constant-time comparison to prevent timing attacks
    return timingSafeEqual(expectedBuffer, actualBuffer);
  }

  /**
   * Build audit log entry without signature
   *
   * Explicitly constructs an entry object without signature field
   * to ensure type safety and prevent signature leakage
   *
   * @param entry - Full audit log entry or partial entry data
   * @returns Entry without signature field
   */
  private buildEntryWithoutSignature(entry: AuditLogEntry): Omit<AuditLogEntry, 'signature'> {
    return {
      id: entry.id,
      timestamp: entry.timestamp,
      eventType: entry.eventType,
      userId: entry.userId,
      sessionId: entry.sessionId,
      ipAddress: entry.ipAddress,
      resourceId: entry.resourceId,
      action: entry.action,
      result: entry.result,
      ...(entry.errorCode !== undefined ? { errorCode: entry.errorCode } : {}),
      ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
    };
  }

  /**
   * Get access history for a memory
   *
   * @param memoryId - Memory ID
   * @returns Access history for the memory
   */
  async getAccessHistory(memoryId: string): Promise<AccessHistory> {
    const accessLog = await this.queryLogs({
      resourceId: memoryId,
    });

    const uniqueUsers = new Set<string>();
    accessLog.forEach((log) => uniqueUsers.add(log.userId));

    const firstLogEntry = accessLog.length > 0 ? accessLog[0] : undefined;

    return {
      memoryId,
      totalAccesses: accessLog.length,
      lastAccessedAt: firstLogEntry ? firstLogEntry.timestamp : null,
      accessLog,
      uniqueUsers,
    };
  }

  /**
   * Purge old logs beyond retention period
   *
   * @param retentionDays - Retention period in days (default: 365)
   * @returns Number of purged log entries
   */
  async purgeOldLogs(retentionDays: number = 365): Promise<number> {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    let purgedCount = 0;

    for (const [id, entry] of this.logs.entries()) {
      if (entry.timestamp < cutoffDate) {
        this.logs.delete(id);
        purgedCount++;
      }
    }

    return purgedCount;
  }

  /**
   * Export logs in specified format
   *
   * @param params - Export parameters
   * @returns Exported logs as string
   */
  async exportLogs(params: ExportLogsParams): Promise<string> {
    const logs = await this.queryLogs({
      ...(params.startTime !== undefined ? { startTime: params.startTime } : {}),
      ...(params.endTime !== undefined ? { endTime: params.endTime } : {}),
      ...(params.userId !== undefined ? { userId: params.userId } : {}),
      ...(params.eventType !== undefined ? { eventType: params.eventType } : {}),
    });

    if (params.format === 'json') {
      return JSON.stringify(logs, null, 2);
    }

    if (params.format === 'csv') {
      const headers = [
        'id',
        'timestamp',
        'eventType',
        'userId',
        'sessionId',
        'ipAddress',
        'resourceId',
        'action',
        'result',
        'errorCode',
        'signature',
      ];

      const rows = logs.map((log) => [
        log.id,
        log.timestamp.toISOString(),
        log.eventType,
        log.userId,
        log.sessionId,
        log.ipAddress,
        log.resourceId,
        log.action,
        log.result,
        log.errorCode || '',
        log.signature,
      ]);

      // Convert to RFC 4180 compliant CSV with CSV injection prevention
      const headerRow = headers.map((h) => this.escapeCsvField(h)).join(',');
      const dataRows = rows.map((row) => row.map((field) => this.escapeCsvField(field)).join(','));

      return [headerRow, ...dataRows].join('\n');
    }

    throw new Error(`Unsupported export format: ${params.format}`);
  }

  /**
   * Update timestamp of a log entry (for testing purposes only)
   *
   * WORM Enforcement: This method enforces Write-Once-Read-Many immutability.
   * - In production: Always throws an error (logs are immutable)
   * - In non-production: Requires allowMutableLogs=true (default true for testing)
   *
   * @param id - Log entry ID
   * @param timestamp - New timestamp
   * @throws Error if attempting to update in production (WORM violation)
   * @throws Error if log entry not found
   * @throws Error if allowMutableLogs is false in non-production
   */
  async updateTimestamp(id: string, timestamp: Date): Promise<void> {
    const isProduction = process.env['NODE_ENV'] === 'production';

    // WORM enforcement: logs are immutable in production
    if (isProduction) {
      throw new Error(
        'Audit log entries are immutable in production (WORM requirement). ' +
          'updateTimestamp is only available in non-production environments for testing purposes.'
      );
    }

    // Check if mutations are allowed in non-production
    if (!this.allowMutableLogs) {
      throw new Error(
        'Audit log mutations are disabled. ' +
          'Create AuditLogger with { allowMutableLogs: true } to enable testing mutations.'
      );
    }

    const entry = this.logs.get(id);
    if (!entry) {
      throw new Error(`Log entry not found: ${id}`);
    }

    // Update timestamp and regenerate signature (only in non-production with allowMutableLogs=true)
    // Build entry without signature first, then apply timestamp update
    const updatedEntry = { ...entry, timestamp };
    const entryWithoutSignature = this.buildEntryWithoutSignature(updatedEntry);

    const signature = this.generateSignature(entryWithoutSignature);

    // Create new entry with updated signature
    const newEntry: AuditLogEntry = {
      ...entryWithoutSignature,
      signature,
    };

    this.logs.set(id, newEntry);
  }

  /**
   * Escape a CSV field according to RFC 4180 and prevent CSV injection
   *
   * @param value - Field value to escape
   * @returns Escaped and quoted CSV field
   */
  private escapeCsvField(value: unknown): string {
    // Convert null/undefined to empty string
    if (value === null || value === undefined) {
      return '""';
    }

    // Convert to string
    let field = String(value);

    // Prevent CSV injection by neutralizing formula-like values
    // Leading characters that trigger formula execution: =, +, -, @
    const dangerousChars = ['=', '+', '-', '@'];
    if (dangerousChars.some((char) => field.startsWith(char))) {
      // Prefix with single quote to neutralize
      field = "'" + field;
    }

    // Escape double quotes by doubling them (RFC 4180)
    field = field.replace(/"/g, '""');

    // Always wrap in double quotes (RFC 4180)
    return `"${field}"`;
  }

  /**
   * Generate HMAC-SHA256 signature for a log entry
   *
   * @param entry - Log entry without signature
   * @returns HMAC-SHA256 signature
   */
  private generateSignature(entry: Omit<AuditLogEntry, 'signature'>): string {
    const data = JSON.stringify({
      id: entry.id,
      timestamp: entry.timestamp.toISOString(),
      eventType: entry.eventType,
      userId: entry.userId,
      sessionId: entry.sessionId,
      ipAddress: entry.ipAddress,
      resourceId: entry.resourceId,
      action: entry.action,
      result: entry.result,
      ...(entry.errorCode && { errorCode: entry.errorCode }),
      ...(entry.metadata && { metadata: entry.metadata }),
    });

    const hmac = createHmac('sha256', this.secretKey);
    hmac.update(data);
    return hmac.digest('hex');
  }
}
