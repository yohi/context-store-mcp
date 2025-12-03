/**
 * Desktop App Collector implementation
 * Collects conversation data from AI Desktop Apps (Claude Desktop, ChatGPT Desktop, etc.)
 * 要件: 3.1, 3.4, 4.1
 */

import { BaseCollector } from './base-collector.js';
import type { ConversationEntry } from './types.js';
import { getLogger } from '../monitoring/structured-logger.js';

const logger = getLogger();

/**
 * Collector for AI Desktop Applications
 * Parses JSON-formatted log entries from desktop AI assistants
 * 
 * Supported formats:
 * - Claude Desktop: JSON logs with conversation structure
 * - ChatGPT Desktop: JSON logs with message exchanges
 * - Other desktop AI apps with similar JSON formats
 */
export class DesktopAppCollector extends BaseCollector {
  /**
   * Parse a log entry from AI Desktop App logs
   * 要件: 3.4 - 会話データ解析
   * 
   * Expected JSON formats:
   * 1. Standard conversation format:
   *    { "type": "conversation", "user_message": "...", "ai_response": "...", "timestamp": "...", "project": "..." }
   * 
   * 2. Message format:
   *    { "type": "message", "prompt": "...", "completion": "...", "timestamp": "...", "workspace": "..." }
   * 
   * 3. Chat format:
   *    { "type": "chat", "input": "...", "output": "...", "timestamp": "...", "context": { "project": "..." } }
   * 
   * @param line - Single line from the log file
   * @returns Parsed conversation entry or null if parsing fails
   */
  protected parseLogEntry(line: string): ConversationEntry | null {
    try {
      const log = JSON.parse(line);

      // Skip non-conversation entries
      if (!this.isConversationEntry(log)) {
        return null;
      }

      // Extract user message and AI response based on format
      const userMessage = this.extractUserMessage(log);
      const aiResponse = this.extractAIResponse(log);

      // Both must be present
      if (!userMessage || !aiResponse) {
        return null;
      }

      // Extract timestamp
      const timestamp = this.extractTimestamp(log);

      // Extract project context
      const projectContext = this.extractProjectContext(log);

      const entry: ConversationEntry = {
        userMessage,
        aiResponse,
        timestamp,
      };
      if (projectContext) {
        entry.projectContext = projectContext;
      }
      return entry;
    } catch (error) {
      // Not valid JSON or parsing failed
      // 要件: 3.6 - 解析エラーの継続動作
      logger.debug('Failed to parse desktop app log entry as JSON', {
        source: this.config.source,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return null;
    }
  }

  /**
   * Check if the log entry is a conversation-related entry
   */
  private isConversationEntry(log: unknown): boolean {
    if (typeof log !== 'object' || log === null) {
      return false;
    }

    const entry = log as Record<string, unknown>;

    // Check for known conversation types
    const validTypes = ['conversation', 'message', 'chat', 'interaction', 'exchange'];
    if (entry['type'] && typeof entry['type'] === 'string') {
      return validTypes.includes(entry['type']);
    }

    // If no type field, check if it has the required fields
    return this.hasRequiredFields(entry);
  }

  /**
   * Check if entry has required conversation fields
   */
  private hasRequiredFields(entry: Record<string, unknown>): boolean {
    // Check for various field combinations
    const hasUserMessage =
      entry['user_message'] ||
      entry['userMessage'] ||
      entry['prompt'] ||
      entry['input'] ||
      entry['query'];

    const hasAIResponse =
      entry['ai_response'] ||
      entry['aiResponse'] ||
      entry['completion'] ||
      entry['output'] ||
      entry['response'];

    return Boolean(hasUserMessage && hasAIResponse);
  }

  /**
   * Extract user message from various field names
   */
  private extractUserMessage(log: Record<string, unknown>): string | null {
    const fields = [
      'user_message',
      'userMessage',
      'prompt',
      'input',
      'query',
      'user',
      'question',
    ];

    for (const field of fields) {
      const value = log[field];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    return null;
  }

  /**
   * Extract AI response from various field names
   */
  private extractAIResponse(log: Record<string, unknown>): string | null {
    const fields = [
      'ai_response',
      'aiResponse',
      'completion',
      'output',
      'response',
      'assistant',
      'answer',
      'reply',
    ];

    for (const field of fields) {
      const value = log[field];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    return null;
  }

  /**
   * Extract timestamp from log entry
   */
  private extractTimestamp(log: Record<string, unknown>): Date {
    const timestampFields = ['timestamp', 'time', 'created_at', 'createdAt', 'date'];

    for (const field of timestampFields) {
      const value = log[field];
      if (value) {
        // Try to parse as date
        if (typeof value === 'string' || typeof value === 'number') {
          const date = new Date(value);
          if (!isNaN(date.getTime())) {
            return date;
          }
        }
      }
    }

    // Default to current time if no valid timestamp found
    return new Date();
  }

  /**
   * Extract project context from log entry
   */
  private extractProjectContext(log: Record<string, unknown>): string | undefined {
    // Direct project fields
    const directFields = ['project', 'workspace', 'workspaceName', 'projectName'];

    for (const field of directFields) {
      const value = log[field];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    // Check nested context object
    if (log['context'] && typeof log['context'] === 'object') {
      const context = log['context'] as Record<string, unknown>;
      for (const field of directFields) {
        const value = context[field];
        if (typeof value === 'string' && value.trim().length > 0) {
          return value.trim();
        }
      }
    }

    // Check metadata object
    if (log['metadata'] && typeof log['metadata'] === 'object') {
      const metadata = log['metadata'] as Record<string, unknown>;
      for (const field of directFields) {
        const value = metadata[field];
        if (typeof value === 'string' && value.trim().length > 0) {
          return value.trim();
        }
      }
    }

    return undefined;
  }
}
