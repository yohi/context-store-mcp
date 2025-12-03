#!/usr/bin/env tsx
/**
 * Desktop App Collector Startup Script
 * 
 * Starts collectors for AI Desktop Applications:
 * - Claude Desktop
 * - ChatGPT Desktop
 * - Other desktop AI assistants
 * 
 * Usage:
 *   npm run collector:desktop-app
 *   # or
 *   tsx scripts/start-desktop-app-collector.ts
 * 
 * Environment Variables:
 *   COLLECTOR_CLAUDE_DESKTOP_LOG_PATH - Path to Claude Desktop logs
 *   COLLECTOR_CHATGPT_DESKTOP_LOG_PATH - Path to ChatGPT Desktop logs
 *   COLLECTOR_POLL_INTERVAL - Polling interval in milliseconds (default: 1000)
 *   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
 */

import { DesktopAppCollector } from '../src/collector/desktop-app-collector.js';
import { Pool } from 'pg';
import { PostgresStorageAdapter } from '../src/storage/postgres-store-adapter.js';
import { MemoryManager } from '../src/memory/memory-manager.js';
import { getLogger } from '../src/monitoring/structured-logger.js';
import * as path from 'path';
import * as os from 'os';

const logger = getLogger();

interface CollectorInstance {
  name: string;
  collector: DesktopAppCollector;
}

async function main() {
  logger.info('Starting Desktop App Collectors...');

  // Validate required environment variables
  if (!process.env.POSTGRES_PASSWORD) {
    logger.error('POSTGRES_PASSWORD environment variable is required');
    process.exit(1);
  }

  // Parse and validate POSTGRES_PORT
  const portStr = (process.env.POSTGRES_PORT || '5432').trim();
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    logger.error(`Invalid POSTGRES_PORT: ${portStr}. Using default port 5432.`);
  }
  const validPort = isNaN(port) || port < 1 || port > 65535 ? 5432 : port;

  // Parse and validate COLLECTOR_POLL_INTERVAL
  const pollIntervalStr = (process.env.COLLECTOR_POLL_INTERVAL || '1000').trim();
  const parsedPollInterval = parseInt(pollIntervalStr, 10);
  const pollInterval = isNaN(parsedPollInterval) || parsedPollInterval <= 0 ? 1000 : parsedPollInterval;
  if (isNaN(parsedPollInterval) || parsedPollInterval <= 0) {
    logger.warn(`Invalid COLLECTOR_POLL_INTERVAL: ${pollIntervalStr}. Using default 1000ms.`);
  }

  // Initialize database connection
  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: validPort,
    database: process.env.POSTGRES_DB || 'context_store',
    user: process.env.POSTGRES_USER || 'context_store_user',
    password: process.env.POSTGRES_PASSWORD,
  });

  const storage = new PostgresStorageAdapter(pool);
  const memoryManager = new MemoryManager({ storage });

  const collectors: CollectorInstance[] = [];

  // Claude Desktop Collector
  const claudeDesktopLogPath = process.env.COLLECTOR_CLAUDE_DESKTOP_LOG_PATH;
  if (claudeDesktopLogPath) {
    const expandedPath = claudeDesktopLogPath.replace(/^~/, os.homedir());
    logger.info(`Configuring Claude Desktop collector: ${expandedPath}`);
    
    const collector = new DesktopAppCollector({
      logPath: expandedPath,
      source: 'claude-desktop',
      sourceType: 'desktop-app',
      pollInterval,
      stateFile: path.join(os.homedir(), '.context-store', 'collector-state-claude-desktop.json'),
    }, memoryManager, pool);

    collectors.push({ name: 'Claude Desktop', collector });
  }

  // ChatGPT Desktop Collector
  const chatgptDesktopLogPath = process.env.COLLECTOR_CHATGPT_DESKTOP_LOG_PATH;
  if (chatgptDesktopLogPath) {
    const expandedPath = chatgptDesktopLogPath.replace(/^~/, os.homedir());
    logger.info(`Configuring ChatGPT Desktop collector: ${expandedPath}`);
    
    const collector = new DesktopAppCollector({
      logPath: expandedPath,
      source: 'chatgpt-desktop',
      sourceType: 'desktop-app',
      pollInterval,
      stateFile: path.join(os.homedir(), '.context-store', 'collector-state-chatgpt-desktop.json'),
    }, memoryManager, pool);

    collectors.push({ name: 'ChatGPT Desktop', collector });
  }

  if (collectors.length === 0) {
    logger.error('No Desktop App collectors configured. Please set environment variables:');
    logger.error('  COLLECTOR_CLAUDE_DESKTOP_LOG_PATH');
    logger.error('  COLLECTOR_CHATGPT_DESKTOP_LOG_PATH');
    process.exit(1);
  }

  // Start all collectors
  logger.info(`Starting ${collectors.length} Desktop App collector(s)...`);
  
  for (const { name, collector } of collectors) {
    try {
      await collector.start();
      logger.info(`✓ ${name} collector started`);
    } catch (error) {
      logger.error(`✗ Failed to start ${name} collector:`, error);
    }
  }

  logger.info('All Desktop App collectors are running. Press Ctrl+C to stop.');

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down Desktop App collectors...');
    
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
  logger.error('Fatal error in Desktop App collector:', error);
  process.exit(1);
});
