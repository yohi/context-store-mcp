/**
 * CLI Agent Collector implementation
 * Collects conversation data from CLI-based AI agents (ClaudeCode, GeminiCLI, CodexCLI, CursorCLI, etc.)
 * 要件: 3.3, 3.4, 4.3
 */

import { BaseCollector } from './base-collector.js';
import type { ConversationEntry } from './types.js';

/**
 * Collector for CLI-based AI agents
 * Supports both JSON and plain text log formats
 * 
 * Supported CLI agents:
 * - ClaudeCode: Anthropic's CLI coding assistant
 * - GeminiCLI: Google's Gemini CLI interface
 * - CodexCLI: OpenAI Codex CLI tool
 * - CursorCLI: Cursor's command-line interface
 */
export class CLIAgentCollector extends BaseCollector {
  // State for multi-line parsing
  private pendingCommand: string | null = null;
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
   * Parse a log entry from CLI agent logs
   * 要件: 3.4 - 会話データ解析
   * 
   * Supports two formats:
   * 1. JSON format:
   *    { "type": "interaction", "input": "...", "output": "...", "timestamp": "...", "cwd": "..." }
   *    { "type": "command", "command": "...", "result": "...", "timestamp": "...", "workspace": "..." }
   * 
   * 2. Plain text format:
   *    $ <command>
   *    > <result>
   *    or
   *    [timestamp] $ <command>
   *    [timestamp] > <result>
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

      // Check for CLI-specific types
      const validTypes = ['interaction', 'command', 'execution', 'conversation', 'chat'];
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
   * Handles multi-line command/response pairs with state management
   */
  private tryParsePlainText(line: string): ConversationEntry | null {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      return null;
    }

    // Pattern 1: "$ <command>" (shell-style command prompt)
    const commandPattern1 = /^\$\s*(.+)$/;
    const match1 = trimmed.match(commandPattern1);
    if (match1 && match1[1]) {
      this.pendingCommand = match1[1].trim();
      this.pendingTimestamp = new Date();
      this.pendingProjectContext = this.extractProjectFromLine(trimmed);
      return null; // Wait for result
    }

    // Pattern 2: "> <result>" (output indicator)
    const resultPattern1 = /^>\s*(.+)$/;
    const match2 = trimmed.match(resultPattern1);
    if (match2 && match2[1] && this.pendingCommand !== null) {
      const userMsg = this.pendingCommand;
      const entry = this.createEntry(
        userMsg,
        match2[1].trim(),
        this.pendingTimestamp || new Date(),
        this.pendingProjectContext
      );
      // Reset state
      this.pendingCommand = null;
      this.pendingTimestamp = null;
      this.pendingProjectContext = null;
      return entry;
    }

    // Pattern 3: "[timestamp] $ <command>" with timestamp prefix
    const timestampCommandPattern = /^\[([^\]]+)\]\s*\$\s*(.+)$/;
    const match3 = trimmed.match(timestampCommandPattern);
    if (match3 && match3[1] && match3[2]) {
      this.pendingCommand = match3[2].trim();
      this.pendingTimestamp = this.parseTimestampString(match3[1]);
      this.pendingProjectContext = this.extractProjectFromLine(trimmed);
      return null;
    }

    // Pattern 4: "[timestamp] > <result>" with timestamp prefix
    const timestampResultPattern = /^\[([^\]]+)\]\s*>\s*(.+)$/;
    const match4 = trimmed.match(timestampResultPattern);
    if (match4 && match4[1] && match4[2] && this.pendingCommand !== null) {
      const userMsg = this.pendingCommand;
      const entry = this.createEntry(
        userMsg,
        match4[2].trim(),
        this.parseTimestampString(match4[1]),
        this.pendingProjectContext
      );
      // Reset state
      this.pendingCommand = null;
      this.pendingTimestamp = null;
      this.pendingProjectContext = null;
      return entry;
    }

    // Pattern 5: "Command: <command>" (verbose format)
    const commandPattern2 = /^Command:\s*(.+)$/i;
    const match5 = trimmed.match(commandPattern2);
    if (match5 && match5[1]) {
      this.pendingCommand = match5[1].trim();
      this.pendingTimestamp = new Date();
      this.pendingProjectContext = this.extractProjectFromLine(trimmed);
      return null;
    }

    // Pattern 6: "Result: <result>" or "Output: <output>" (verbose format)
    const resultPattern2 = /^(?:Result|Output):\s*(.+)$/i;
    const match6 = trimmed.match(resultPattern2);
    if (match6 && match6[1] && this.pendingCommand !== null) {
      const userMsg = this.pendingCommand;
      const entry = this.createEntry(
        userMsg,
        match6[1].trim(),
        this.pendingTimestamp || new Date(),
        this.pendingProjectContext
      );
      // Reset state
      this.pendingCommand = null;
      this.pendingTimestamp = null;
      this.pendingProjectContext = null;
      return entry;
    }

    // Pattern 7: "Input: <input>" and "Response: <response>"
    const inputPattern = /^Input:\s*(.+)$/i;
    const match7 = trimmed.match(inputPattern);
    if (match7 && match7[1]) {
      this.pendingCommand = match7[1].trim();
      this.pendingTimestamp = new Date();
      this.pendingProjectContext = this.extractProjectFromLine(trimmed);
      return null;
    }

    const responsePattern = /^Response:\s*(.+)$/i;
    const match8 = trimmed.match(responsePattern);
    if (match8 && match8[1] && this.pendingCommand !== null) {
      const userMsg = this.pendingCommand;
      const entry = this.createEntry(
        userMsg,
        match8[1].trim(),
        this.pendingTimestamp || new Date(),
        this.pendingProjectContext
      );
      // Reset state
      this.pendingCommand = null;
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
      entry['input'] ||
      entry['command'] ||
      entry['query'] ||
      entry['prompt'] ||
      entry['request'] ||
      entry['user_input'];

    const hasAIResponse =
      entry['output'] ||
      entry['result'] ||
      entry['response'] ||
      entry['completion'] ||
      entry['ai_output'];

    return Boolean(hasUserMessage && hasAIResponse);
  }

  /**
   * Extract user message from various field names
   */
  private extractUserMessage(log: Record<string, unknown>): string | null {
    const fields = [
      'input',
      'command',
      'query',
      'prompt',
      'request',
      'user_input',
      'userInput',
      'user',
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
      'result',
      'response',
      'completion',
      'ai_output',
      'aiOutput',
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
    const timestampFields = ['timestamp', 'time', 'created_at', 'createdAt', 'date', 'ts', 'executed_at'];

    for (const field of timestampFields) {
      const value = log[field];
      if (value != null) {
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
      'cwd',
      'workspace',
      'workingDirectory',
      'project',
      'projectName',
      'directory',
      'folder',
      'path',
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
    // Look for patterns like [cwd:/path/to/project] or (workspace:name)
    const projectPattern = /[\[\(](?:cwd|workspace|project|dir):\s*([^\]\)]+)[\]\)]/i;
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
