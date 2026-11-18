// Disposable-only one-shot physical session owner. No pool, connection handle,
// CancelRequest or broad signal privilege. Timeout closes the client and
// conservatively reports uncertainty; disconnect alone is NOT rollback proof.
import { Client } from "pg";
import { D1DeadlineExceeded, ExperimentalD1Budget, scheduleExperimentalD1Deadline } from "./schema-operator-experimental-deadline";
import { ExperimentalSessionLifecycle, type SessionTerminalCause } from "./schema-operator-experimental-session";
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
  const session = new ExperimentalSessionLifecycle(budget, true);
  let closing: Promise<void> | undefined;
  const close = () => {
    session.retire();
    try {
      return closing ??= db.end().then(() => session.markClosed(), () => undefined);
    } catch {
      // Still retired and permanently fenced; a failed close is not proof of
      // disconnection or rollback and must not prevent terminal settlement.
      return closing ??= Promise.resolve();
    }
  };
  let rejectTerminal: (error: SchemaMigrationOperatorError) => void = () => undefined;
  const terminal = new Promise<never>((_, reject) => { rejectTerminal = reject; });
  const stop = (cause: SessionTerminalCause) => {
    // Publish the fence before starting asynchronous close or settling the race.
    if (!session.fence(cause)) return;
    void close();
    rejectTerminal(new SchemaMigrationOperatorError("INDETERMINATE",
      cause === "DEADLINE_EXCEEDED" ? "D1 supervisor closed session; reconcile on fresh connection" :
        "supervisor transport failed; reconcile on fresh connection"));
  };
  db.on("error", () => stop("TRANSPORT_FAILED"));
  db.on("end", () => {
    session.markClosed();
    stop("TRANSPORT_FAILED");
  });
  const cancelDeadline = scheduleExperimentalD1Deadline(budget, () => stop("DEADLINE_EXCEEDED"));
  const operation = (async () => {
    budget.checkpoint();
    try {
      await db.connect();
    } catch {
      session.fence("CONNECTION_FAILED");
      throw new SchemaMigrationOperatorError("INDETERMINATE", "supervisor connection failed; use fresh connection");
    }
    session.connected();
    const run = mode === "EXECUTE" ? executeApprovedAdditiveColumn : reconcileApprovedAdditiveColumn;
    return run(db, request, budget, authority, session);
  })();
  try {
    const result = await Promise.race([operation, terminal]);
    session.fence("NORMAL_COMPLETION");
    if (budget.expired()) {
      return {...result, status: result.status === "APPLIED" ? "COMMITTED_LATE" :
        result.status === "ALREADY_APPLIED" ? "ALREADY_APPLIED_LATE" : result.status};
    }
    return result;
  } catch (error) {
    session.fence(error instanceof D1DeadlineExceeded ||
      (error instanceof SchemaMigrationOperatorError && error.code === "DEADLINE_EXCEEDED")
      ? "DEADLINE_EXCEEDED" : "OPERATION_FAILED");
    throw error;
  } finally {
    cancelDeadline();
    // No waiting past the outcome deadline for a socket close that might stall.
    // The physical client is never handed out or reused.
    void close();
  }
}
