import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

let pool: Pool | null = null;
let dbInstance: NodePgDatabase<typeof schema> | null = null;

export const getDbPool = (): Pool => {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://vibress:vibress@127.0.0.1:5433/vibress',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    
    pool.on('error', (err) => {
      console.error('Unexpected error on idle DB client', err);
    });
  }
  return pool;
};

export const getDb = (): NodePgDatabase<typeof schema> => {
  if (!dbInstance) {
    dbInstance = drizzle(getDbPool(), { schema });
  }
  return dbInstance;
};

export const closeDbPool = async (): Promise<void> => {
  if (pool) {
    await pool.end();
    pool = null;
    dbInstance = null;
  }
};

export { schema };
export * from './schema';
export { runMigrations } from './migrate';
export { seedDatabase, SYSTEM_ROLES, SYSTEM_PERMISSIONS } from './seed';
