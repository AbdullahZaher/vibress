#!/usr/bin/env tsx
/**
 * M03-S03 isolated nonproduction operator entrypoint.
 * Not imported by API, worker, plugin SDK, routes or deployment startup.
 * No default DATABASE_URL fallback, no privilege provisioning.
 */
import { createPublicKey } from "node:crypto";
import { RecoveryEpochAuthority } from "./schema-operator-experimental-recovery-epoch";
import { SchemaMigrationOperatorError } from "./platform-schema-migration-operator";
import { superviseDisposableSchemaOperation } from "./schema-operator-experimental-supervisor";
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

// Experimental-only loopback provider, configured through a trusted operator
// host. Never accept a public key or epoch from the operation request.
function testOnlyRecoveryAuthority(): RecoveryEpochAuthority {
  const endpoint = new URL(process.env.VIBRESS_SCHEMA_RECOVERY_AUTHORITY_URL ?? "");
  const publicKey = process.env.VIBRESS_SCHEMA_RECOVERY_AUTHORITY_PUBLIC_KEY;
  if (!publicKey || endpoint.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      endpoint.pathname !== "/v1/recovery-epoch") throw Error("trusted disposable recovery authority required");
  return new RecoveryEpochAuthority(createPublicKey(publicKey), async (challenge, signal) => {
    const response = await fetch(endpoint, { method: "POST", redirect: "error", signal,
      headers: {"content-type":"application/json"}, body: JSON.stringify(challenge) });
    if (!response.ok || !response.body) throw Error("recovery authority unavailable");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let count = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        count += part.value.byteLength;
        if (count > 4096) { await reader.cancel(); throw Error("recovery proof too large"); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const proof: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return proof;
  });
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
  const authority = testOnlyRecoveryAuthority();
  budget.checkpoint();
  const result = await superviseDisposableSchemaOperation(connectionString,
    {installationId,planDigest,operationId,submissionId,approvalId,envelopeVersion:1},authority,
    reconcile?"RECONCILE":"EXECUTE",budget);
  // Recheck at the CLI outcome boundary, not just inside the database method.
  const classified = budget.expired() && result.status === "APPLIED" ? {...result,status:"COMMITTED_LATE"} :
    budget.expired() && result.status === "ALREADY_APPLIED" ? {...result,status:"ALREADY_APPLIED_LATE"} : result;
  console.log(JSON.stringify(classified));
  if (classified.status === "COMMITTED_LATE" || classified.status === "ALREADY_APPLIED_LATE") process.exitCode = 2;
}

main().catch(error => {
  // Never print connection strings, SQL, credentials, schema data or stack traces.
  console.error("[M03-S03] refused:", error instanceof SchemaMigrationOperatorError ? error.code : error instanceof Error ? error.name : "Error");
  process.exitCode = 1;
});
