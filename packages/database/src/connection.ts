import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { getTransactionDb } from './transaction/transaction-context';
import { getConfig } from '@vibress/config';

let pool: Pool | null = null;
let dbInstance: NodePgDatabase<typeof schema> | null = null;

export const getDbPool = (): Pool => {
  if (!pool) {
    const config = getConfig();
    pool = new Pool({
      connectionString: config.database.url,
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
  const tx = getTransactionDb();
  if (tx) {
    return tx;
  }
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