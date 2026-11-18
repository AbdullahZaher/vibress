// Disposable test helper. Uses the exact migrator library used by src/migrate.ts.
// No normative migration journal, runtime role provisioning or production access.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Client } from "pg";

export async function migrateDisposableSchemaCandidate(client: Client, migrationsFolder: string): Promise<void> {
  const identity = (await client.query<{ database_name: string; version: number }>(
    "SELECT current_database() AS database_name,current_setting('server_version_num')::int AS version",
  )).rows[0];
  if (!identity || !/^vibress_s03_[a-z0-9_]+$/.test(identity.database_name) ||
      identity.version < 160000 || identity.version >= 170000) {
    throw new Error("Refusing experimental migration outside disposable PG16");
  }
  await migrate(drizzle(client), {
    migrationsFolder,
    migrationsSchema: "s03_experimental_drizzle",
    migrationsTable: "migration_log",
  });
}
