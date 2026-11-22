/**
 * CLI script to initialize Nextdo PostgreSQL database schema.
 *
 * Runs all table/index/publication DDL against the configured DATABASE_URL.
 * Useful for one-click setup from terminal without opening SQL Editors.
 */
import { createPool } from './db.js';
import { initDatabaseSchema } from './schema-init.js';
import { initSystemSettingsTable } from './claim.js';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error('❌ Error: DATABASE_URL environment variable is not set.');
    console.error('👉 Usage: DATABASE_URL="postgresql://..." pnpm db:init');
    process.exit(1);
  }

  console.log('Connecting to PostgreSQL database...');
  const pool = createPool(databaseUrl);
  try {
    console.log('Initializing Nextdo database tables, indexes and replication publication...');
    await initDatabaseSchema(pool);
    await initSystemSettingsTable(pool);
    console.log('✅ Nextdo database initialization completed successfully! (15 tables & publication ready)');
  } catch (error) {
    console.error('❌ Failed to initialize database:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void main();
