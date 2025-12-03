/**
 * Duplicate prevention mechanism for collector system
 * 要件: 5.5
 */

import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { getLogger } from '../monitoring/structured-logger.js';

const logger = getLogger();

/**
 * Generate a content hash for duplicate detection
 * Uses SHA-256 to create a unique fingerprint of the conversation
 */
export function generateContentHash(userMessage: string, aiResponse: string, timestamp: Date): string {
  const content = `${userMessage}|${aiResponse}|${timestamp.toISOString()}`;
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Check if a conversation entry already exists in the database
 * 要件: 5.5 - データベースレベルでの重複チェック
 * 
 * @param pool - PostgreSQL connection pool
 * @param contentHash - Hash of the conversation content
 * @param source - Source identifier
 * @returns true if duplicate exists, false otherwise
 */
export async function isDuplicate(
  pool: Pool,
  contentHash: string,
  source: string
): Promise<boolean> {
  try {
    // Check if a memory with the same content hash and source exists
    // We use lite_mode_metadata to store the content hash for duplicate detection
    const query = `
      SELECT EXISTS (
        SELECT 1 FROM memories
        WHERE lite_mode_metadata->>'contentHash' = $1
          AND lite_mode_metadata->>'source' = $2
          AND is_deleted = false
      ) AS exists
    `;

    const result = await pool.query(query, [contentHash, source]);
    const exists = result.rows[0]?.exists ?? false;

    if (exists) {
      logger.debug('Duplicate conversation detected', {
        contentHash,
        source,
      });
    }

    return exists;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to check for duplicates', {
      error: err,
      contentHash,
      source,
    });
    // On error, assume not duplicate to avoid blocking legitimate entries
    return false;
  }
}

/**
 * Store content hash in memory metadata for duplicate detection
 * This should be called when storing a new memory
 * 
 * @param userMessage - User's message
 * @param aiResponse - AI's response
 * @param timestamp - Conversation timestamp
 * @returns Metadata object with content hash
 */
export function createMetadataWithHash(
  userMessage: string,
  aiResponse: string,
  timestamp: Date
): { contentHash: string } {
  return {
    contentHash: generateContentHash(userMessage, aiResponse, timestamp),
  };
}

/**
 * Clean up old duplicate detection hashes
 * Removes content hashes from memories older than the specified days
 * This helps keep the metadata clean and reduces storage overhead
 * 
 * @param pool - PostgreSQL connection pool
 * @param olderThanDays - Remove hashes from memories older than this many days
 * @returns Number of records cleaned
 */
export async function cleanupOldHashes(
  pool: Pool,
  olderThanDays: number = 90
): Promise<number> {
  try {
    const query = `
      UPDATE memories
      SET lite_mode_metadata = lite_mode_metadata - 'contentHash'
      WHERE created_at < NOW() - INTERVAL '${olderThanDays} days'
        AND lite_mode_metadata ? 'contentHash'
        AND is_deleted = false
      RETURNING id
    `;

    const result = await pool.query(query);
    const count = result.rowCount ?? 0;

    if (count > 0) {
      logger.info('Cleaned up old content hashes', {
        count,
        olderThanDays,
      });
    }

    return count;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to clean up old hashes', {
      error: err,
      olderThanDays,
    });
    return 0;
  }
}
