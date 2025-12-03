#!/usr/bin/env tsx
/**
 * CLI Agent Collector Startup Script
 * 
 * Starts collectors for CLI-based AI agents:
 * - ClaudeCode
 * - GeminiCLI
 * - CodexCLI
 * - CursorCLI
 * - Other CLI AI agents
 * 
 * Usage:
 *   npm run collector:cli-agent
 *   # or
 *   tsx scripts/start-cli-agent-collector.ts
 * 
 * Environment Variables:
 *   COLLECTOR_CLAUDE_CODE_LOG_PATH - Path to ClaudeCode logs
 *   COLLECTOR_GEMINI_CLI_LOG_PATH - Path to GeminiCLI logs
 *   COLLECTOR_CODEX_CLI_LOG_PATH - Path to CodexCLI logs
 *   COLLECTOR_CURSOR_CLI_LOG_PATH - Path to CursorCLI logs
 *   COLLECTOR_POLL_INTERVAL - Polling interval in milliseconds (default: 1000)
 *   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
 */

import { CLIAgentCollector } from '../src/collector/cli-agent-collector.js';
import { Pool } from 'pg';
import { PostgresStorageAdapter } from '../src/storage/postgres-store-adapter.js';
import { MemoryManager } from '../src/memory/memory-manager.js';
import { getLogger } from '../src/monitoring/structured-logger.js';
import * as path from 'path';
import * as os from 'os';

const logger = getLogger();

interface CollectorInstance {
  name: string;
  collector: CLIAgentCollector;
}

async function main() {
  logger.info('Starting CLI Agent Collectors...');

  // Initialize database connection
  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'context_store',
    user: process.env.POSTGRES_USER || 'context_store_user',
    password: process.env.POSTGRES_PASSWORD,
  });

  const storage = new PostgresStorageAdapter(pool);
  const memoryManager = new MemoryManager({ storage });

  const collectors: CollectorInstance[] = [];
  const pollInterval = parseInt(process.env.COLLECTOR_POLL_INTERVAL || '1000');

  // ClaudeCode Collector
  const claudeCodeLogPath = process.env.COLLECTOR_CLAUDE_CODE_LOG_PATH;
  if (claudeCodeLogPath) {
    const expandedPath = claudeCodeLogPath.replace(/^~/, os.homedir());
    logger.info(`Configuring ClaudeCode collector: ${expandedPath}`);
    
    const collector = new CLIAgentCollector({
      logPath: expandedPath,
      source: 'claude-code',
      sourceType: 'cli-agent',
      pollInterval,
      stateFile: path.join(os.homedir(), '.context-store', 'collector-state-claude-code.json'),
    }, memoryManager, pool);

    collectors.push({ name: 'ClaudeCode', collector });
  }

  // GeminiCLI Collector
  const geminiCliLogPath = process.env.COLLECTOR_GEMINI_CLI_LOG_PATH;
  if (geminiCliLogPath) {
    const expandedPath = geminiCliLogPath.replace(/^~/, os.homedir());
    logger.info(`Configuring GeminiCLI collector: ${expandedPath}`);
    
    const collector = new CLIAgentCollector({
      logPath: expandedPath,
      source: 'gemini-cli',
      sourceType: 'cli-agent',
      pollInterval,
      stateFile: path.join(os.homedir(), '.context-store', 'collector-state-gemini-cli.json'),
    }, memoryManager, pool);

    collectors.push({ name: 'GeminiCLI', collector });
  }

  // CodexCLI Collector
  const codexCliLogPath = process.env.COLLECTOR_CODEX_CLI_LOG_PATH;
  if (codexCliLogPath) {
    const expandedPath = codexCliLogPath.replace(/^~/, os.homedir());
    logger.info(`Configuring CodexCLI collector: ${expandedPath}`);
    
    const collector = new CLIAgentCollector({
      logPath: expandedPath,
      source: 'codex-cli',
      sourceType: 'cli-agent',
      pollInterval,
      stateFile: path.join(os.homedir(), '.context-store', 'collector-state-codex-cli.json'),
    }, memoryManager, pool);

    collectors.push({ name: 'CodexCLI', collector });
  }

  // CursorCLI Collector
  const cursorCliLogPath = process.env.COLLECTOR_CURSOR_CLI_LOG_PATH;
  if (cursorCliLogPath) {
    const expandedPath = cursorCliLogPath.replace(/^~/, os.homedir());
    logger.info(`Configuring CursorCLI collector: ${expandedPath}`);
    
    const collector = new CLIAgentCollector({
      logPath: expandedPath,
      source: 'cursor-cli',
      sourceType: 'cli-agent',
      pollInterval,
      stateFile: path.join(os.homedir(), '.context-store', 'collector-state-cursor-cli.json'),
    }, memoryManager, pool);

    collectors.push({ name: 'CursorCLI', collector });
  }

  if (collectors.length === 0) {
    logger.error('No CLI Agent collectors configured. Please set environment variables:');
    logger.error('  COLLECTOR_CLAUDE_CODE_LOG_PATH');
    logger.error('  COLLECTOR_GEMINI_CLI_LOG_PATH');
    logger.error('  COLLECTOR_CODEX_CLI_LOG_PATH');
    logger.error('  COLLECTOR_CURSOR_CLI_LOG_PATH');
    process.exit(1);
  }

  // Start all collectors
  logger.info(`Starting ${collectors.length} CLI Agent collector(s)...`);
  
  for (const { name, collector } of collectors) {
    try {
      await collector.start();
      logger.info(`✓ ${name} collector started`);
    } catch (error) {
      logger.error(`✗ Failed to start ${name} collector:`, error);
    }
  }

  logger.info('All CLI Agent collectors are running. Press Ctrl+C to stop.');

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down CLI Agent collectors...');
    
    for (const { name, collector } of collectors) {
      try {
        await collector.stop();
        logger.info(`✓ ${name} collector stopped`);
      } catch (error) {
        logger.error(`✗ Error stopping ${name} collector:`, error);
      }
    }

    await memoryManager.dispose();
    await pool.end();
    
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  logger.error('Fatal error in CLI Agent collector:', error);
  process.exit(1);
});
