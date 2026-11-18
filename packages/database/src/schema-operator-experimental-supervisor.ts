// Disposable-only one-shot physical session owner. No pool, connection handle,
// CancelRequest or broad signal privilege. Timeout closes the client and
// conservatively reports uncertainty; disconnect alone is NOT rollback proof.
import { Client } from "pg";
import { D1DeadlineExceeded, ExperimentalD1Budget, scheduleExperimentalD1Deadline } from "./schema-operator-experimental-deadline";
import { ExperimentalSessionLifecycle, registerExperimentalOwnedSession, type SessionTerminalCause } from "./schema-operator-experimental-session";
import { executeApprovedAdditiveColumn, reconcileApprovedAdditiveColumn,
  SchemaMigrationOperatorError, type SchemaOperatorRequest, type SchemaOperatorResult } from "./platform-schema-migration-operator";
import type { RecoveryEpochAuthority } from "./schema-operator-experimental-recovery-epoch";

// Isolated recovery prototype can fence the owned session. No client or SQL handle escapes.
export type OwnedOperationFacts = Readonly<{
  admissionKey:string; mode:"EXECUTE"|"RECONCILE";
  transaction: ReturnType<ExperimentalSessionLifecycle["transactionFacts"]>;
}>;
export interface ExperimentalRecoveryFence {
  attach(fence: () => void): void;
  observeSettlement?(facts:OwnedOperationFacts):void;
}
// Internal one-shot registration. This constrains supported callers, not arbitrary
// hostile JS or SQL possessing operator credentials. Vitest raw harness only.
const admissions=new WeakMap<ExperimentalRecoveryFence,string>();
const admissionKey=(request:SchemaOperatorRequest,mode:string)=>JSON.stringify([mode,request.installationId,request.operationId,request.submissionId,request.approvalId,request.planDigest,request.envelopeVersion]);
export function registerExperimentalAdmission(admission:ExperimentalRecoveryFence,request:SchemaOperatorRequest,mode:"EXECUTE"|"RECONCILE"):void{
  if(admissions.has(admission)) throw Error("admission already registered");
  admissions.set(admission,admissionKey(request,mode));
}

export async function superviseDisposableSchemaOperation(
  connectionString: string, request: SchemaOperatorRequest, authority: RecoveryEpochAuthority,
  mode: "EXECUTE" | "RECONCILE" = "EXECUTE", budget = new ExperimentalD1Budget(),
  recoveryFence?: ExperimentalRecoveryFence,
): Promise<SchemaOperatorResult> {
  budget.checkpoint();
  if(recoveryFence){
    if(admissions.get(recoveryFence)!==admissionKey(request,mode)) throw new SchemaMigrationOperatorError("UNAUTHORIZED","durable operation admission required");
    admissions.delete(recoveryFence);
  }else if(!(process.env.NODE_ENV==="test"&&process.env.VITEST==="true")){
    throw new SchemaMigrationOperatorError("UNAUTHORIZED","durable operation admission required");
  }
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
  registerExperimentalOwnedSession(db,session);
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
    if (recoveryFence) recoveryFence.attach(() => stop("OPERATION_FAILED"));
    if (session.snapshot().terminalCause) throw new SchemaMigrationOperatorError("INDETERMINATE", "recovery admission fenced");
    budget.checkpoint();
    try {
      budget.mark("CONNECT_START");
      await db.connect();
      budget.mark("CONNECT_ACK");
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
    // Synchronous immutable settlement, bound to the one-shot admission. A
    // later transport event cannot retroactively change the durable decision.
    recoveryFence?.observeSettlement?.(Object.freeze({
      admissionKey:admissionKey(request,mode),mode,transaction:session.transactionFacts(),
    }));
  }
}
