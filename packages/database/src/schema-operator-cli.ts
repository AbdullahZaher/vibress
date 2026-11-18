#!/usr/bin/env tsx
/**
 * M03-S03 isolated nonproduction operator entrypoint.
 * Not imported by API, worker, plugin SDK, routes or deployment startup.
 * No default DATABASE_URL fallback, no privilege provisioning.
 */
import { Client } from "pg";
import { executeApprovedAdditiveColumn, SchemaMigrationOperatorError } from "./platform-schema-migration-operator";
import { ExperimentalD1Budget } from "./schema-operator-experimental-deadline";

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
  const budget = new ExperimentalD1Budget();
  const [installationId,planDigest,operationId,submissionId,approvalId,version,unexpected]=process.argv.slice(2);
  if (!installationId||!planDigest||!operationId||!submissionId||!approvalId||version!=="1"||unexpected) {
    throw new Error("usage: tsx schema-operator-cli.ts <installationId> <planDigest> <operationId> <submissionId> <approvalId> 1");
  }
  const connectionString = testOnlyConnection();
  budget.checkpoint();
  const db = new Client({
    connectionString,
    connectionTimeoutMillis: Math.max(1, Math.floor(budget.remainingMs())),
    statement_timeout:Math.max(1,Math.floor(budget.remainingMs())),
  });
  try {
    await db.connect();
    budget.checkpoint();
    const result = await executeApprovedAdditiveColumn(db, {installationId,planDigest,operationId,submissionId,approvalId,envelopeVersion:1},budget);
    console.log(JSON.stringify(result));
    if (result.status === "COMMITTED_LATE" || result.status === "ALREADY_APPLIED_LATE") process.exitCode = 2;
  } finally {
    await db.end().catch(() => undefined);
  }
}

main().catch(error => {
  // Never print connection strings, SQL, credentials, schema data or stack traces.
  console.error("[M03-S03] refused:", error instanceof SchemaMigrationOperatorError ? error.code : error instanceof Error ? error.name : "Error");
  process.exitCode = 1;
});
