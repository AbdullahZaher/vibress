import { runMigrations, seedDatabase } from '@vibress/database';

export async function setup() {
  console.log('Global setup: Running database migrations...');
  await runMigrations();
  console.log('Global setup: Seeding database with roles, permissions, and dev users...');
  await seedDatabase();
  console.log('Global setup: Database setup completed.');
}
