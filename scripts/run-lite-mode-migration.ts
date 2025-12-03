#!/usr/bin/env tsx
/**
 * Lite Mode Schema Migration Runner
 * 
 * This script applies the Lite Mode schema extensions to an existing PostgreSQL database.
 * It reads the SQL migration file and executes it against the configured database.
 * 
 * Usage:
 *   npm run migrate:lite-mode
 *   # or
 *   tsx scripts/run-lite-mode-migration.ts
 * 
 * Environment Variables:
 *   POSTGRES_HOST - PostgreSQL host (default: localhost)
 *   POSTGRES_PORT - PostgreSQL port (default: 5432)
 *   POSTGRES_DB - Database name (default: context_store)
 *   POSTGRES_USER - Database user
 *   POSTGRES_PASSWORD - Database password
 * 
 * Options:
 *   --dry-run - Show what would be executed without making changes
 *   --force - Skip confirmation prompt
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface MigrationOptions {
  dryRun: boolean;
  force: boolean;
}

function parseArgs(): MigrationOptions {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
  };
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

async function checkExistingSchema(pool: Pool): Promise<void> {
  console.log('\n📋 Checking existing schema...');

  // Check if lite_mode_metadata column exists
  const columnCheck = await pool.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'memories' AND column_name = 'lite_mode_metadata'
    ) as exists
  `);

  if (columnCheck.rows[0].exists) {
    console.log('  ✓ lite_mode_metadata column already exists');
  } else {
    console.log('  ✗ lite_mode_metadata column does not exist (will be created)');
  }

  // Check if collector_state table exists
  const tableCheck = await pool.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_name = 'collector_state'
    ) as exists
  `);

  if (tableCheck.rows[0].exists) {
    console.log('  ✓ collector_state table already exists');
  } else {
    console.log('  ✗ collector_state table does not exist (will be created)');
  }

  // Check indexes
  const indexCheck = await pool.query(`
    SELECT indexname 
    FROM pg_indexes 
    WHERE tablename = 'memories' 
      AND indexname LIKE 'idx_memories_lite%'
  `);

  console.log(`  ℹ Found ${indexCheck.rows.length} Lite mode indexes`);
}

async function runMigration(options: MigrationOptions): Promise<void> {
  console.log('🚀 Lite Mode Schema Migration');
  console.log('================================\n');

  // Load environment variables
    const postgresPortEnv = process.env.POSTGRES_PORT;
    let port = 5432; // Default value

    if (postgresPortEnv !== undefined) {
      const parsedPort = parseInt(postgresPortEnv, 10);

      if (
        !Number.isFinite(parsedPort) ||
        !Number.isInteger(parsedPort) ||
        parsedPort < 1 ||
        parsedPort > 65535
      ) {
        console.error(
          `\n❌ Error: Invalid POSTGRES_PORT "${postgresPortEnv}". ` +
            'Port must be an integer between 1 and 65535.'
        );
        process.exit(1);
      }
      port = parsedPort;
    }

  const config = {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: port,
    database: process.env.POSTGRES_DB || 'context_store',
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
  };

  console.log('📊 Database Configuration:');
  console.log(`  Host: ${config.host}`);
  console.log(`  Port: ${config.port}`);
  console.log(`  Database: ${config.database}`);
  console.log(`  User: ${config.user}`);

  if (!config.user || !config.password) {
    console.error('\n❌ Error: POSTGRES_USER and POSTGRES_PASSWORD must be set');
    process.exit(1);
  }

  // Create database connection
  const pool = new Pool(config);

  try {
    // Test connection
    console.log('\n🔌 Testing database connection...');
    await pool.query('SELECT 1');
    console.log('  ✓ Connection successful');

    // Check existing schema
    await checkExistingSchema(pool);

    // Read migration SQL file
    const sqlFilePath = path.join(__dirname, 'migrate-lite-mode-schema.sql');
    console.log(`\n📄 Reading migration file: ${sqlFilePath}`);
    
    if (!fs.existsSync(sqlFilePath)) {
      throw new Error(`Migration file not found: ${sqlFilePath}`);
    }

    const migrationSQL = fs.readFileSync(sqlFilePath, 'utf-8');
    console.log(`  ✓ Loaded ${migrationSQL.split('\n').length} lines of SQL`);

    if (options.dryRun) {
      console.log('\n🔍 DRY RUN MODE - No changes will be made');
      console.log('\nMigration SQL:');
      console.log('---');
      console.log(migrationSQL);
      console.log('---');
      return;
    }

    // Confirm before proceeding
    if (!options.force) {
      console.log('\n⚠️  This will modify your database schema.');
      const proceed = await confirm('Do you want to proceed? (y/N): ');
      
      if (!proceed) {
        console.log('\n❌ Migration cancelled by user');
        return;
      }
    }

    // Execute migration
    console.log('\n⚙️  Executing migration...');
    const startTime = Date.now();
    
    await pool.query(migrationSQL);
    
    const duration = Date.now() - startTime;
    console.log(`  ✓ Migration completed in ${duration}ms`);

    // Verify migration
    console.log('\n✅ Verifying migration...');
    await checkExistingSchema(pool);

    console.log('\n🎉 Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('  1. Update your .env file with LITE_MODE=true');
    console.log('  2. Start the MCP server: npm start');
    console.log('  3. (Optional) Start collectors: npm run collector:desktop-app');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Main execution
const options = parseArgs();

runMigration(options)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
