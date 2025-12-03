/**
 * Memory Viewer Example
 * 
 * Web Viewerの使用例
 */

import { Pool } from 'pg';
import { MemoryViewer } from './memory-viewer.js';
import type { ViewerConfig } from './types.js';

async function main() {
  // PostgreSQL接続プールの作成
  const pool = new Pool({
    host: process.env['POSTGRES_HOST'] || 'localhost',
    port: parseInt(process.env['POSTGRES_PORT'] || '5432'),
    user: process.env['POSTGRES_USER'] || 'postgres',
    password: process.env['POSTGRES_PASSWORD'] || 'postgres',
    database: process.env['POSTGRES_DB'] || 'context_store',
  });

  // Viewer設定
  const authEnabled = process.env['VIEWER_AUTH_ENABLED'] === 'true';
  const config: ViewerConfig = {
    port: parseInt(process.env['VIEWER_PORT'] || '3001'),
    authEnabled,
    authToken: authEnabled ? process.env['VIEWER_AUTH_TOKEN'] : undefined,
    pool,
  };

  // Viewerの起動
  const viewer = new MemoryViewer(config);
  await viewer.start();

  console.log(`Memory Viewer is running on http://localhost:${config.port}`);
  if (config.authEnabled) {
    console.log('Authentication is enabled.');
    if (process.env['NODE_ENV'] !== 'production') {
      console.log('Use the following token:');
      console.log(`Authorization: Bearer ${config.authToken}`);
    } else {
      console.log('Token hidden in production. Check your environment variables or configuration to retrieve the token.');
    }
  }

  // グレースフルシャットダウン
  process.on('SIGINT', async () => {
    console.log('\nShutting down Memory Viewer...');
    await viewer.stop();
    await pool.end();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nShutting down Memory Viewer...');
    await viewer.stop();
    await pool.end();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Failed to start Memory Viewer:', error);
  process.exit(1);
});
