#!/usr/bin/env tsx
/**
 * M03-S03 isolated nonproduction operator entrypoint.
 * Not imported by API, worker, plugin SDK, routes or deployment startup.
 * No default DATABASE_URL fallback, no privilege provisioning.
 */
import { Client } from "pg";
import { executeApprovedAdditiveColumn } from "./platform-schema-migration-operator";

function testOnlyConnection(): string {
  if (process.env.NODE_ENV === "production" ||
    process.env.VIBRESS_SCHEMA_EXECUTOR_DISPOSABLE_CONFIRM !== "I_CONFIRM_DISPOSABLE") {
    throw new Error("M03-S03 execution requires explicit disposable nonproduction approval");
  }
  const raw = process.env.SCHEMA_MIGRATION_OPERATOR_DATABASE_URL;
  if (!raw) throw new Error("SCHEMA_MIGRATION_OPERATOR_DATABASE_URL is required");
  const parsed = new URL(raw);
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("Only a PostgreSQL connection is supported");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) ||
    !/^\/vibress_s03_[a-z0-9_]+$/.test(parsed.pathname)) {
    throw new Error("Only an explicitly isolated local vibress_s03_* database is permitted");
  }
  if (!parsed.username || !parsed.password) {
    throw new Error("A separate operator username/password is required");
  }
  return raw;
}

async function main(): Promise<void> {
  const [installationId, planDigest, unexpected] = process.argv.slice(2);
  if (!installationId || !planDigest || unexpected) {
    throw new Error("usage: tsx schema-operator-cli.ts <installationId> <planDigest>");
  }
  const connectionString = testOnlyConnection();
  const db = new Client({
    connectionString,
    connectionTimeoutMillis: 4000,
    statement_timeout: 10000,
    query_timeout: 12000,
  });
  await db.connect();
  try {
    const result = await executeApprovedAdditiveColumn(db, { installationId, planDigest });
    console.log(JSON.stringify(result));
  } finally {
    await db.end().catch(() => undefined);
  }
}

main().catch(error => {
  // Never print connection strings, SQL, credentials, schema data or stack traces.
  console.error("[M03-S03] refused:", error instanceof Error ? error.name : "Error");
  process.exitCode = 1;
});
