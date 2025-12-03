/**
 * AI IDE Collector implementation
 * Collects conversation data from AI-powered IDEs (Cursor, Windsurf, Copilot, Cline, etc.)
 * 要件: 3.2, 3.4, 4.2
 */

import { BaseCollector } from './base-collector.js';
import type { ConversationEntry } from './types.js';

/**
 * Collector for AI-powered IDEs
 * Supports both JSON and plain text log formats
 * 
 * Supported IDEs:
 * - Cursor: JSON-based chat logs
 * - Windsurf: Mixed format logs
 * - GitHub Copilot: Completion logs
 * - Cline: Structured interaction logs
 */
export class AIIDECollector extends BaseCollector {
  // State for multi-line parsing
  private pendingUserMessage: string | null = null;
  private pendingTimestamp: Date | null = null;
  private pendingProjectContext: string | null = null;

  /**
   * Helper to create ConversationEntry with proper optional handling
   */
  private createEntry(
    userMessage: string,
    aiResponse: string,
    timestamp: Date,
    projectContext: string | null | undefined
  ): ConversationEntry {
    const entry: ConversationEntry = {
      userMessage,
      aiResponse,
      timestamp,
    };
    if (projectContext) {
      entry.projectContext = projectContext;
    }
    return entry;
  }

  /**
   * Parse a log entry from AI IDE logs
   * 要件: 3.4 - 会話データ解析
   * 
   * Supports two formats:
   * 1. JSON format (preferred):
   *    { "type": "chat", "input": "...", "output": "...", "timestamp": "...", "workspace": "..." }
   * 
   * 2. Plain text format:
   *    User: <message>
   *    AI: <response>
   *    or
   *    > <user input>
   *    < <ai output>
   * 
   * @param line - Single line from the log file
   * @returns Parsed conversation entry or null if parsing incomplete/failed
   */
  protected parseLogEntry(line: string): ConversationEntry | null {
    // Try JSON format first
    const jsonEntry = this.tryParseJSON(line);
    if (jsonEntry) {
      return jsonEntry;
    }

    // Try plain text format
    return this.tryParsePlainText(line);
  }

  /**
   * Try to parse as JSON format
   */
  private tryParseJSON(line: string): ConversationEntry | null {
    try {
      const log = JSON.parse(line);

      if (typeof log !== 'object' || log === null) {
        return null;
      }

      const entry = log as Record<string, unknown>;

      // Check for conversation-related types
      const validTypes = ['chat', 'completion', 'interaction', 'conversation', 'message'];
      const hasValidType = entry['type'] && typeof entry['type'] === 'string' && validTypes.includes(entry['type']);

      if (!hasValidType && !this.hasRequiredFields(entry)) {
        return null;
      }

      // Extract fields
      const userMessage = this.extractUserMessage(entry);
      const aiResponse = this.extractAIResponse(entry);

      if (!userMessage || !aiResponse) {
        return null;
      }

      const timestamp = this.extractTimestamp(entry);
      const projectContext = this.extractProjectContext(entry);

      return this.createEntry(userMessage, aiResponse, timestamp, projectContext);
    } catch {
      // Not valid JSON
      return null;
    }
  }

  /**
   * Try to parse as plain text format
   * Handles multi-line conversations with state management
   */
  private tryParsePlainText(line: string): ConversationEntry | null {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      return null;
    }

    // Pattern 1: "User: <message>" or "Human: <message>"
    const userPattern1 = /^(?:User|Human|You):\s*(.+)$/i;
    const match1 = trimmed.match(userPattern1);
    if (match1 && match1[1]) {
      this.pendingUserMessage = match1[1].trim();
      this.pendingTimestamp = new Date();
      this.pendingProjectContext = this.extractProjectFromLine(trimmed);
      return null; // Wait for AI response
    }

    // Pattern 2: "AI: <response>" or "Assistant: <response>"
    const aiPattern1 = /^(?:AI|Assistant|Bot):\s*(.+)$/i;
    const match2 = trimmed.match(aiPattern1);
    if (match2 && match2[1] && this.pendingUserMessage !== null) {
      const userMsg = this.pendingUserMessage;
      const entry = this.createEntry(
        userMsg,
        match2[1].trim(),
        this.pendingTimestamp || new Date(),
        this.pendingProjectContext
      );
      // Reset state
      this.pendingUserMessage = null;
      this.pendingTimestamp = null;
      this.pendingProjectContext = null;
      return entry;
    }

    // Pattern 3: "> <user input>" (common in CLI-style logs)
    const userPattern2 = /^>\s*(.+)$/;
    const match3 = trimmed.match(userPattern2);
    if (match3 && match3[1]) {
      this.pendingUserMessage = match3[1].trim();
      this.pendingTimestamp = new Date();
      this.pendingProjectContext = this.extractProjectFromLine(trimmed);
      return null; // Wait for AI response
    }

    // Pattern 4: "< <ai output>" (common in CLI-style logs)
    const aiPattern2 = /^<\s*(.+)$/;
    const match4 = trimmed.match(aiPattern2);
    if (match4 && match4[1] && this.pendingUserMessage !== null) {
      const userMsg = this.pendingUserMessage;
      const entry = this.createEntry(
        userMsg,
        match4[1].trim(),
        this.pendingTimestamp || new Date(),
        this.pendingProjectContext
      );
      // Reset state
      this.pendingUserMessage = null;
      this.pendingTimestamp = null;
      this.pendingProjectContext = null;
      return entry;
    }

    // Pattern 5: "[timestamp] User: <message>" with timestamp prefix
    const timestampUserPattern = /^\[([^\]]+)\]\s*(?:User|Human):\s*(.+)$/i;
    const match5 = trimmed.match(timestampUserPattern);
    if (match5 && match5[1] && match5[2]) {
      this.pendingUserMessage = match5[2].trim();
      this.pendingTimestamp = this.parseTimestampString(match5[1]);
      this.pendingProjectContext = this.extractProjectFromLine(trimmed);
      return null;
    }

    // Pattern 6: "[timestamp] AI: <response>" with timestamp prefix
    const timestampAIPattern = /^\[([^\]]+)\]\s*(?:AI|Assistant):\s*(.+)$/i;
    const match6 = trimmed.match(timestampAIPattern);
    if (match6 && match6[1] && match6[2] && this.pendingUserMessage !== null) {
      const userMsg = this.pendingUserMessage;
      const entry = this.createEntry(
        userMsg,
        match6[2].trim(),
        this.parseTimestampString(match6[1]),
        this.pendingProjectContext
      );
      // Reset state
      this.pendingUserMessage = null;
      this.pendingTimestamp = null;
      this.pendingProjectContext = null;
      return entry;
    }

    return null;
  }

  /**
   * Check if entry has required conversation fields
   */
  private hasRequiredFields(entry: Record<string, unknown>): boolean {
    const hasUserMessage =
      entry['input'] || entry['query'] || entry['prompt'] || entry['user_message'] || entry['request'];

    const hasAIResponse =
      entry['output'] || entry['response'] || entry['completion'] || entry['ai_response'] || entry['result'];

    return Boolean(hasUserMessage && hasAIResponse);
  }

  /**
   * Extract user message from various field names
   */
  private extractUserMessage(log: Record<string, unknown>): string | null {
    const fields = [
      'input',
      'query',
      'prompt',
      'user_message',
      'userMessage',
      'request',
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
      'output',
      'response',
      'completion',
      'ai_response',
      'aiResponse',
      'result',
      'assistant',
      'answer',
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
    const timestampFields = ['timestamp', 'time', 'created_at', 'createdAt', 'date', 'ts'];

    for (const field of timestampFields) {
      const value = log[field];
      if (value) {
        if (typeof value === 'string' || typeof value === 'number') {
          const date = new Date(value);
          if (!isNaN(date.getTime())) {
            return date;
          }
        }
      }
    }

    return new Date();
  }

  /**
   * Extract project context from log entry
   */
  private extractProjectContext(log: Record<string, unknown>): string | undefined {
    const directFields = [
      'workspace',
      'workspaceName',
      'project',
      'projectName',
      'cwd',
      'directory',
      'folder',
    ];

    for (const field of directFields) {
      const value = log[field];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    // Check nested objects
    if (log['context'] && typeof log['context'] === 'object') {
      const context = log['context'] as Record<string, unknown>;
      for (const field of directFields) {
        const value = context[field];
        if (typeof value === 'string' && value.trim().length > 0) {
          return value.trim();
        }
      }
    }

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

  /**
   * Extract project context from a plain text line
   */
  private extractProjectFromLine(line: string): string | null {
    // Look for patterns like [project:name] or (workspace:name)
    const projectPattern = /[\[\(](?:project|workspace|cwd):\s*([^\]\)]+)[\]\)]/i;
    const match = line.match(projectPattern);
    if (match && match[1]) {
      return match[1].trim();
    }

    return null;
  }

  /**
   * Parse timestamp string to Date
   */
  private parseTimestampString(timestampStr: string): Date {
    const date = new Date(timestampStr);
    if (!isNaN(date.getTime())) {
      return date;
    }
    return new Date();
  }
}
