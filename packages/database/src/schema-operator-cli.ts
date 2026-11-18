#!/usr/bin/env tsx
/**
 * M03-S03 isolated nonproduction operator entrypoint.
 * Not imported by API, worker, plugin SDK, routes or deployment startup.
 * No default DATABASE_URL fallback, no privilege provisioning.
 */
import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { DisposableDurableRecoveryAuthority } from "./schema-operator-experimental-durable-authority";
import { FileExperimentalRecoveryAnchor } from "./schema-operator-experimental-anchor";
import { SchemaMigrationOperatorError } from "./platform-schema-migration-operator";
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

// Trusted local host only. Provision the ledger and anchor out of band;
// never create a missing authority or fall back to epoch-only proof.
function required(name:string):string {
  const value=process.env[name];if(!value)throw Error("durable authority configuration required");return value;
}
function testOnlyRecoveryAuthority(){
  const ledger=realpathSync(required("VIBRESS_SCHEMA_RECOVERY_LEDGER_DIR"));
  const anchorDir=realpathSync(required("VIBRESS_SCHEMA_RECOVERY_ANCHOR_DIR"));
  if(ledger===anchorDir)throw Error("separate anchor directory required");
  const key=createPrivateKey(readFileSync(required("VIBRESS_SCHEMA_RECOVERY_SIGNING_KEY_FILE")));
  const anchorKey=createPrivateKey(readFileSync(required("VIBRESS_SCHEMA_RECOVERY_ANCHOR_KEY_FILE")));
  const publicKey=createPublicKey(readFileSync(required("VIBRESS_SCHEMA_RECOVERY_PUBLIC_KEY_FILE")));
  const adminKey=createPublicKey(readFileSync(required("VIBRESS_SCHEMA_RECOVERY_ADMIN_PUBLIC_KEY_FILE")));
  const anchor=new FileExperimentalRecoveryAnchor(anchorDir,anchorKey);
  return {authority:DisposableDurableRecoveryAuthority.open(ledger,key,anchor,adminKey),publicKey};
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
  const {authority,publicKey}=testOnlyRecoveryAuthority();
  const request={installationId,planDigest,operationId,submissionId,approvalId,envelopeVersion:1} as const;
  let result;
  try{
    budget.checkpoint();
    result=reconcile?await authority.reconcile(connectionString,request,publicKey,budget):
      await authority.execute(connectionString,request,publicKey,budget);
  }finally{authority.close();}
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
