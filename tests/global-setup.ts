import { runMigrations, seedDatabase, closeDbPool, getDb, publications } from "@vibress/database";

export async function setup() {
  console.log("Global setup: Running database migrations...");
  await runMigrations();
  console.log(
    "Global setup: Seeding database with roles, permissions, and dev users...",
  );
  await seedDatabase();
  const db = getDb();
  await db
    .insert(publications)
    .values([
      {
        id: "pub_alpha",
        workspaceId: "ws_default",
        name: "Alpha Pub",
        slug: "alpha",
        primaryLocale: "en",
      },
      {
        id: "pub_beta",
        workspaceId: "ws_default",
        name: "Beta Pub",
        slug: "beta",
        primaryLocale: "en",
      },
    ])
    .onConflictDoNothing();
  console.log("Global setup: Database setup completed.");
}

export async function teardown() {
  await closeDbPool();
}

