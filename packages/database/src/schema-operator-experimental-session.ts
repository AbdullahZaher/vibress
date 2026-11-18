// Internal, per-operation SQL dispatch fence. The transaction phase and
// terminal cause are intentionally independent: fencing never proves rollback.
import type { ClientBase } from "pg";
import type { ExperimentalD1Budget } from "./schema-operator-experimental-deadline";

type Phase = "CONNECTING" | "READY" | "BEGIN_DISPATCHED" | "TRANSACTION_ACTIVE" |
  "COMMIT_DISPATCHED" | "COMMIT_ACKNOWLEDGED" | "ROLLBACK_DISPATCHED" | "ROLLED_BACK";
export type SessionTerminalCause = "DEADLINE_EXCEEDED" | "TRANSPORT_FAILED" |
  "CONNECTION_FAILED" | "OPERATION_FAILED" | "NORMAL_COMPLETION";
type Dispatch = "BEGIN" | "SQL" | "COMMIT" | "ROLLBACK";
type Control = Exclude<Dispatch, "SQL">;

export class ExperimentalSessionLifecycle {
  private phase: Phase;
  private cause: SessionTerminalCause | undefined;
  private began = false;
  private commitSent = false;
  private commitAcknowledged = false;
  private retired = false;
  private closed = false;
  private commitDigest: string | undefined;
  private journalObservation: "UNOBSERVED"|"ABSENT"|"PRESENT" = "UNOBSERVED";

  constructor(private readonly budget: ExperimentalD1Budget, connecting = false) {
    this.phase = connecting ? "CONNECTING" : "READY";
  }

  snapshot() {
    return { phase: this.phase, terminalCause: this.cause,
      beginDispatched: this.began, commitDispatched: this.commitSent,
      commitAcknowledged: this.commitAcknowledged,
      retired: this.retired, closed: this.closed,
      cleanupPermitted: this.cleanupPermitted() };
  }

  usesBudget(budget: ExperimentalD1Budget): boolean { return this.budget === budget; }

  // Record the validated content identity before COMMIT dispatch. It is not a
  // transaction fact until the server acknowledgment is received.
  bindCommitDigest(digest:string):void {
    if(this.phase!=="TRANSACTION_ACTIVE"||this.cause!==undefined||this.commitDigest!==undefined||
      !/^[0-9a-f]{64}$/.test(digest)) throw Error("invalid commit identity");
    this.commitDigest=digest;
  }
  observeJournal(present:boolean):void {
    if(this.phase!=="TRANSACTION_ACTIVE"||this.cause!==undefined||this.journalObservation!=="UNOBSERVED")throw Error("invalid journal observation");
    this.journalObservation=present?"PRESENT":"ABSENT";
  }
  transactionFacts(){
    const outcome=this.phase==="ROLLED_BACK"?"ROLLED_BACK":
      this.phase==="COMMIT_ACKNOWLEDGED"?"COMMITTED":"UNKNOWN";
    return Object.freeze({outcome,commitDigest:this.commitAcknowledged?this.commitDigest:undefined,
      journalObservation:this.journalObservation,beginDispatched:this.began,commitDispatched:this.commitSent,
      terminalCause:this.cause,retired:this.retired,closed:this.closed,deadlineExpired:this.budget.expired()});
  }

  // First terminal cause wins. A later receipt may still establish a fact
  // about the already-dispatched transaction but cannot reopen dispatch.
  fence(cause: SessionTerminalCause): boolean {
    if (this.cause !== undefined) return false;
    this.cause = cause;
    return true;
  }

  retire(): void { this.retired = true; }
  markClosed(): void { this.retired = true; this.closed = true; }

  connected(): void {
    this.assertOperational();
    if (this.phase !== "CONNECTING") throw Error("unexpected session phase");
    this.phase = "READY";
  }

  private assertOperational(): void {
    if (this.cause !== undefined || this.retired) throw Error("terminal session fenced");
    this.budget.checkpoint();
  }

  private cleanupPermitted(): boolean {
    return this.cause === undefined && !this.retired &&
      (this.phase === "BEGIN_DISPATCHED" || this.phase === "TRANSACTION_ACTIVE");
  }

  // Call immediately before the underlying query, with no await in between.
  // ROLLBACK is the only cleanup exception to D1, and never allowed after
  // the supervisor has fenced/retired the physical session or dispatched COMMIT.
  beforeDispatch(kind: Dispatch): void {
    if (kind === "ROLLBACK") {
      if (!this.cleanupPermitted()) throw Error("session cleanup not permitted");
      this.phase = "ROLLBACK_DISPATCHED";
      return;
    }
    this.assertOperational();
    if (kind === "BEGIN" && this.phase === "READY") {
      this.began = true;
      this.phase = "BEGIN_DISPATCHED";
      return;
    }
    if (this.phase !== "TRANSACTION_ACTIVE" || kind === "BEGIN") {
      throw Error("invalid transaction dispatch phase");
    }
    if (kind === "COMMIT") {
      this.commitSent = true;
      this.phase = "COMMIT_DISPATCHED";
    }
  }

  acknowledge(kind: Control, command: string): void {
    if (kind === "BEGIN" && this.phase === "BEGIN_DISPATCHED" && command === "BEGIN") {
      this.phase = "TRANSACTION_ACTIVE";
    } else if (kind === "COMMIT" && this.phase === "COMMIT_DISPATCHED") {
      if (command === "COMMIT") {
        this.commitAcknowledged = true;
        this.phase = "COMMIT_ACKNOWLEDGED";
      } else if (command === "ROLLBACK") this.phase = "ROLLED_BACK";
    } else if (kind === "ROLLBACK" && this.phase === "ROLLBACK_DISPATCHED" && command === "ROLLBACK") {
      this.phase = "ROLLED_BACK";
    }
  }
}

// Supported-path ownership marker; not a sandbox against arbitrary host JS.
const ownedSessions = new WeakMap<ClientBase, ExperimentalSessionLifecycle>();
export function registerExperimentalOwnedSession(db: ClientBase, session: ExperimentalSessionLifecycle): void {
  if (ownedSessions.has(db)) throw Error("physical session already registered");
  ownedSessions.set(db,session);
}
export function isExperimentalOwnedSession(db: ClientBase, session: ExperimentalSessionLifecycle): boolean {
  return ownedSessions.get(db)===session;
}
