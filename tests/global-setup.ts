import { runMigrations } from '@vibress/database';

export async function setup() {
  console.log('Global setup: Running database migrations...');
  await runMigrations();
  console.log('Global setup: Database migrations completed.');
}
