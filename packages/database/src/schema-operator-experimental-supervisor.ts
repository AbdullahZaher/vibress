// Disposable-only one-shot physical session owner. No pool, connection handle,
// CancelRequest or broad signal privilege. Timeout closes the client and
// conservatively reports uncertainty; disconnect alone is NOT rollback proof.
import { Client } from "pg";
import { ExperimentalD1Budget, scheduleExperimentalD1Deadline } from "./schema-operator-experimental-deadline";
import { executeApprovedAdditiveColumn, reconcileApprovedAdditiveColumn,
  SchemaMigrationOperatorError, type SchemaOperatorRequest, type SchemaOperatorResult } from "./platform-schema-migration-operator";
import type { RecoveryEpochAuthority } from "./schema-operator-experimental-recovery-epoch";

export async function superviseDisposableSchemaOperation(
  connectionString: string, request: SchemaOperatorRequest, authority: RecoveryEpochAuthority,
  mode: "EXECUTE" | "RECONCILE" = "EXECUTE", budget = new ExperimentalD1Budget(),
): Promise<SchemaOperatorResult> {
  budget.checkpoint();
  const url = new URL(connectionString);
  if (process.env.NODE_ENV === "production" ||
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !url.pathname.startsWith("/") || !/^vibress_s03_[a-z0-9_]+$/.test(url.pathname.slice(1)) || url.search || url.hash ||
      !url.username || !url.password) {
    throw new SchemaMigrationOperatorError("UNAUTHORIZED", "isolated dedicated connection required");
  }
  const db = new Client({connectionString,
    connectionTimeoutMillis: Math.max(1, Math.floor(budget.remainingMs())),
    statement_timeout: Math.max(1, Math.floor(budget.remainingMs()))});
  // A connection failure can emit an asynchronous error while no SQL is active.
  // Never expose its payload or let an unhandled event terminate the process.
  db.on("error", () => undefined);
  let closing: Promise<void> | undefined;
  const close = () => closing ??= db.end().then(() => undefined, () => undefined);
  let cancelDeadline: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    cancelDeadline = scheduleExperimentalD1Deadline(budget, () => {
      void close();
      reject(new SchemaMigrationOperatorError("INDETERMINATE", "D1 supervisor closed session; reconcile on fresh connection"));
    });
  });
  const operation = (async () => {
    budget.checkpoint();
    await db.connect();
    budget.checkpoint();
    const run = mode === "EXECUTE" ? executeApprovedAdditiveColumn : reconcileApprovedAdditiveColumn;
    return run(db, request, budget, authority);
  })();
  try {
    const result = await Promise.race([operation, deadline]);
    if (budget.expired()) {
      return {...result, status: result.status === "APPLIED" ? "COMMITTED_LATE" :
        result.status === "ALREADY_APPLIED" ? "ALREADY_APPLIED_LATE" : result.status};
    }
    return result;
  } finally {
    cancelDeadline?.();
    // No waiting past the outcome deadline for a socket close that might stall.
    // The physical client is never handed out or reused.
    void close();
  }
}
