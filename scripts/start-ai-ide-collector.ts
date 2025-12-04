#!/usr/bin/env tsx
/**
 * AI IDE Collector Startup Script
 * 
 * Starts collectors for AI-powered IDEs:
 * - Cursor
 * - Windsurf
 * - GitHub Copilot
 * - Cline
 * - Other AI IDEs
 * 
 * Usage:
 *   npm run collector:ai-ide
 *   # or
 *   tsx scripts/start-ai-ide-collector.ts
 * 
 * Environment Variables:
 *   COLLECTOR_CURSOR_LOG_PATH - Path to Cursor logs
 *   COLLECTOR_WINDSURF_LOG_PATH - Path to Windsurf logs
 *   COLLECTOR_COPILOT_LOG_PATH - Path to GitHub Copilot logs
 *   COLLECTOR_CLINE_LOG_PATH - Path to Cline logs
 *   COLLECTOR_POLL_INTERVAL - Polling interval in milliseconds (default: 1000)
 *   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
 */

import { AIIDECollector } from '../src/collector/ai-ide-collector.js';
import { Pool } from 'pg';
import { PostgresStorageAdapter } from '../src/storage/postgres-store-adapter.js';
import { MemoryManager } from '../src/memory/memory-manager.js';
import { getLogger } from '../src/monitoring/structured-logger.js';
import * as path from 'path';
import * as os from 'os';

const logger = getLogger();

interface CollectorInstance {
  name: string;
  collector: AIIDECollector;
}

async function main() {
  logger.info('Starting AI IDE Collectors...');

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

  // Cursor Collector
  const cursorLogPath = process.env.COLLECTOR_CURSOR_LOG_PATH;
  if (cursorLogPath) {
    const expandedPath = cursorLogPath.replace(/^~/, os.homedir());
    logger.info(`Configuring Cursor collector: ${expandedPath}`);
    
    const collector = new AIIDECollector({
      logPath: expandedPath,
      source: 'cursor',
      sourceType: 'ide',
      pollInterval,
      stateFile: path.join(os.homedir(), '.context-store', 'collector-state-cursor.json'),
    }, memoryManager, pool);

    collectors.push({ name: 'Cursor', collector });
  }

  // Windsurf Collector
  const windsurfLogPath = process.env.COLLECTOR_WINDSURF_LOG_PATH;
  if (windsurfLogPath) {
    const expandedPath = windsurfLogPath.replace(/^~/, os.homedir());
    logger.info(`Configuring Windsurf collector: ${expandedPath}`);
    
    const collector = new AIIDECollector({
      logPath: expandedPath,
      source: 'windsurf',
      sourceType: 'ide',
      pollInterval,
      stateFile: path.join(os.homedir(), '.context-store', 'collector-state-windsurf.json'),
    }, memoryManager, pool);

    collectors.push({ name: 'Windsurf', collector });
  }

  // GitHub Copilot Collector
  const copilotLogPath = process.env.COLLECTOR_COPILOT_LOG_PATH;
  if (copilotLogPath) {
    const expandedPath = copilotLogPath.replace(/^~/, os.homedir());
    logger.info(`Configuring GitHub Copilot collector: ${expandedPath}`);
    
    const collector = new AIIDECollector({
      logPath: expandedPath,
      source: 'copilot',
      sourceType: 'ide',
      pollInterval,
      stateFile: path.join(os.homedir(), '.context-store', 'collector-state-copilot.json'),
    }, memoryManager, pool);

    collectors.push({ name: 'GitHub Copilot', collector });
  }

  // Cline Collector
  const clineLogPath = process.env.COLLECTOR_CLINE_LOG_PATH;
  if (clineLogPath) {
    const expandedPath = clineLogPath.replace(/^~/, os.homedir());
    logger.info(`Configuring Cline collector: ${expandedPath}`);
    
    const collector = new AIIDECollector({
      logPath: expandedPath,
      source: 'cline',
      sourceType: 'ide',
      pollInterval,
      stateFile: path.join(os.homedir(), '.context-store', 'collector-state-cline.json'),
    }, memoryManager, pool);

    collectors.push({ name: 'Cline', collector });
  }

  if (collectors.length === 0) {
    logger.error('No AI IDE collectors configured. Please set environment variables:');
    logger.error('  COLLECTOR_CURSOR_LOG_PATH');
    logger.error('  COLLECTOR_WINDSURF_LOG_PATH');
    logger.error('  COLLECTOR_COPILOT_LOG_PATH');
    logger.error('  COLLECTOR_CLINE_LOG_PATH');
    process.exit(1);
  }

  // Start all collectors
  logger.info(`Starting ${collectors.length} AI IDE collector(s)...`);
  
  for (const { name, collector } of collectors) {
    try {
      await collector.start();
      logger.info(`✓ ${name} collector started`);
    } catch (error) {
      logger.error(`✗ Failed to start ${name} collector:`, error);
    }
  }

  logger.info('All AI IDE collectors are running. Press Ctrl+C to stop.');

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down AI IDE collectors...');
    
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
  logger.error('Fatal error in AI IDE collector:', error);
  process.exit(1);
});
