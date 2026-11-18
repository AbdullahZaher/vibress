#!/usr/bin/env tsx
/**
 * M03-S03 isolated nonproduction operator entrypoint.
 * Not imported by API, worker, plugin SDK, routes or deployment startup.
 * No default DATABASE_URL fallback, no privilege provisioning.
 */
import { Client } from "pg";
import { executeApprovedAdditiveColumn, reconcileApprovedAdditiveColumn, SchemaMigrationOperatorError } from "./platform-schema-migration-operator";
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
  const args=process.argv.slice(2);
  const reconcile=args[0]==="--reconcile";
  if(reconcile) args.shift();
  const [installationId,planDigest,operationId,submissionId,approvalId,version,unexpected]=args;
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
    const run=reconcile?reconcileApprovedAdditiveColumn:executeApprovedAdditiveColumn;
    const result = await run(db, {installationId,planDigest,operationId,submissionId,approvalId,envelopeVersion:1},budget);
    // Recheck at the CLI outcome boundary, not just inside the database method.
    const classified = budget.expired() && result.status === "APPLIED" ? {...result,status:"COMMITTED_LATE"} :
      budget.expired() && result.status === "ALREADY_APPLIED" ? {...result,status:"ALREADY_APPLIED_LATE"} : result;
    console.log(JSON.stringify(classified));
    if (classified.status === "COMMITTED_LATE" || classified.status === "ALREADY_APPLIED_LATE") process.exitCode = 2;
  } finally {
    await db.end().catch(() => undefined);
  }
}

main().catch(error => {
  // Never print connection strings, SQL, credentials, schema data or stack traces.
  console.error("[M03-S03] refused:", error instanceof SchemaMigrationOperatorError ? error.code : error instanceof Error ? error.name : "Error");
  process.exitCode = 1;
});
