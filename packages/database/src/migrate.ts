import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDb, closeDbPool } from './index';
import path from 'path';

export const runMigrations = async (): Promise<void> => {
  const db = getDb();
  const migrationsFolder = path.join(__dirname, '../migrations');
  console.log(`Running migrations from ${migrationsFolder}...`);
  await migrate(db, { migrationsFolder });
  console.log('Migrations completed successfully.');
};

if (require.main === module) {
  runMigrations()
    .then(() => closeDbPool())
    .catch(async (err) => {
      console.error('Migration failed:', err);
      await closeDbPool();
      process.exit(1);
    });
}
