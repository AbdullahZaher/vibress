import { sql } from "drizzle-orm";
import { getDb } from "./connection";

export interface SchemaValidationResult {
  ready: boolean;
  missingTables: string[];
  tablesCount: number;
}

const CRITICAL_SYSTEM_TABLES = [
  "users",
  "settings",
  "posts",
  "roles",
  "permissions",
];

export async function checkDatabaseSchemaReady(): Promise<SchemaValidationResult> {
  const db = getDb();
  try {
    // Query PostgreSQL information_schema for existing public tables
    const result = await db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );

    const existingTables = new Set(
      ((result as unknown as { rows: Array<{ table_name: string }> }).rows || []).map(
        (r) => r.table_name,
      ),
    );

    const missingTables = CRITICAL_SYSTEM_TABLES.filter(
      (t) => !existingTables.has(t),
    );

    return {
      ready: missingTables.length === 0,
      missingTables,
      tablesCount: existingTables.size,
    };
  } catch (err) {
    throw new Error(
      `Database connectivity/schema inspection failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

export async function assertDatabaseSchemaReady(): Promise<void> {
  const validation = await checkDatabaseSchemaReady();
  if (!validation.ready) {
    throw new Error(
      `Database startup safety check failed: Missing required schema tables [${validation.missingTables.join(
        ", ",
      )}]. Please execute migrations prior to starting the application (e.g. 'pnpm run db:migrate' or 'pnpm run prod:migrate').`,
    );
  }
}
