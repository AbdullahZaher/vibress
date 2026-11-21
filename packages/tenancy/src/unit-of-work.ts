import { AsyncLocalStorage } from "node:async_hooks";
import type { ActionTransaction } from "@vibress/platform-kernel";
import {
  assertVerifiedScope,
  isVerifiedScope,
  type VerifiedScope,
} from "./scope";

export interface QueryResult<TRow = unknown> {
  readonly rows: TRow[];
  readonly rowCount: number | null;
  readonly command?: string;
}

export interface Queryable {
  query<TRow = unknown>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<QueryResult<TRow>>;
}

export interface PoolClientLike extends Queryable {
  /**
   * Returns the connection to the pool. Pass `true` to destroy it instead,
   * which is required whenever the connection's session state is unknown.
   */
  release(destroy?: boolean): void;
}

export interface PoolLike {
  connect(): Promise<PoolClientLike>;
}

export interface ScopedTransaction extends ActionTransaction {
  readonly scope: VerifiedScope;
  markRollbackOnly(reason: string): void;
}

export interface TenantUnitOfWorkRunner {
  run<T>(
    scope: VerifiedScope,
    work: (transaction: ScopedTransaction) => Promise<T>,
  ): Promise<T>;
}

export class TenantTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantTransactionError";
  }
}

export class TenantScopeSwitchError extends TenantTransactionError {
  constructor() {
    super(
      "nested tenant unit of work cannot switch application, tenant, principal or policy scope",
    );
    this.name = "TenantScopeSwitchError";
  }
}

export class TenantTransactionRollbackOnlyError extends TenantTransactionError {
  readonly reason: string;

  constructor(reason: string) {
    super(`transaction is rollback-only: ${reason}`);
    this.name = "TenantTransactionRollbackOnlyError";
    this.reason = reason;
  }
}

export class TenantScopeMutationError extends TenantTransactionError {
  constructor() {
    super(
      "scoped transactions cannot mutate vibress tenant context (set_config/SET)",
    );
    this.name = "TenantScopeMutationError";
  }
}

export class TenantContextMismatchError extends TenantTransactionError {
  constructor(expected: string, actual: string) {
    super(
      `database tenant context mismatch (expected ${expected}, received ${actual})`,
    );
    this.name = "TenantContextMismatchError";
  }
}

export class TenantRoleSwitchError extends TenantTransactionError {
  constructor(
    message = "scoped transactions cannot switch database role (SET ROLE / SET SESSION AUTHORIZATION)",
  ) {
    super(message);
    this.name = "TenantRoleSwitchError";
  }
}

export class TenantAsyncEscapeError extends TenantTransactionError {
  constructor() {
    super(
      "database work escaped the unit of work or used a settled transaction and was rejected",
    );
    this.name = "TenantAsyncEscapeError";
  }
}

interface RollbackState {
  value: boolean;
  reason: string | null;
}

interface TransactionState {
  sealed: boolean;
  inFlight: number;
}

interface ActiveTransaction {
  readonly scope: VerifiedScope;
  readonly client: PoolClientLike;
  readonly rollback: RollbackState;
  readonly state: TransactionState;
}

interface TransactionIdentity {
  readonly currentUser: string;
  readonly sessionUser: string;
}

const transactionStorage = new AsyncLocalStorage<ActiveTransaction>();

function sameScope(left: VerifiedScope, right: VerifiedScope): boolean {
  return (
    left.applicationId === right.applicationId &&
    left.tenantId === right.tenantId &&
    left.principal.id === right.principal.id &&
    left.authorization.policyVersion === right.authorization.policyVersion
  );
}

/**
 * Application code executed via ScopedTransaction is trusted Tier-1 application
 * logic within the installation. In-process SQL pattern inspection is an
 * active defense-in-depth safeguard against accidental or subtle GUC tampering,
 * NOT a sandboxing mechanism for untrusted SQL or malicious third-party code.
 * Untrusted code must run in an isolated process/container sandbox.
 *
 * Any detected attempt to alter or reset `vibress.*` GUCs, or to assume a
 * different database role, immediately marks the transaction as rollback-only
 * so it can never be committed. The pre-commit identity probe is the authority:
 * a role change that evades inspection is still detected and destroys the
 * connection, because `SET ROLE` and `SET SESSION AUTHORIZATION` survive
 * ROLLBACK.
 */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ");
}

const SCOPE_MUTATION_PATTERN =
  /(?:(?:pg_catalog\.)?set_config\s*\(\s*['"]vibress\.|set\s+(?:(?:session|local)\s+)?['"]?vibress\.|reset\s+(?:all|['"]?vibress\.))/i;

const ROLE_SWITCH_PATTERN =
  /(?:(?:pg_catalog\.)?set_config\s*\(\s*['"](?:role|session_authorization)['"]|set\s+(?:(?:session|local)\s+)?role\b|set\s+(?:(?:session|local)\s+)?authorization\b|set\s+session_authorization\b|reset\s+(?:role|session_authorization)\b|reset\s+(?:(?:session|local)\s+)?authorization\b)/i;

function assertNoGuardedMutation(sql: string): void {
  const stripped = stripSqlComments(sql);
  if (ROLE_SWITCH_PATTERN.test(stripped)) {
    throw new TenantRoleSwitchError();
  }
  if (SCOPE_MUTATION_PATTERN.test(stripped)) {
    throw new TenantScopeMutationError();
  }
}

function createScopedTransaction(
  client: PoolClientLike,
  scope: VerifiedScope,
  rollback: RollbackState,
  state: TransactionState,
): ScopedTransaction {
  const markRollbackOnly = (reason: string): void => {
    if (!rollback.value) {
      rollback.reason = reason;
    }
    rollback.value = true;
  };
  return {
    scope,
    query: async <TRow = unknown>(
      sql: string,
      parameters?: readonly unknown[],
    ): Promise<QueryResult<TRow>> => {
      if (state.sealed) {
        throw new TenantAsyncEscapeError();
      }
      if (rollback.value) {
        throw new TenantTransactionRollbackOnlyError(
          rollback.reason ?? "transaction marked rollback-only",
        );
      }
      try {
        assertNoGuardedMutation(sql);
      } catch (error) {
        markRollbackOnly(
          error instanceof TenantRoleSwitchError
            ? "role switch attempt detected"
            : "scope mutation attempt detected",
        );
        throw error;
      }
      state.inFlight += 1;
      try {
        return await client.query<TRow>(sql, parameters);
      } finally {
        state.inFlight -= 1;
      }
    },
    markRollbackOnly,
  };
}

/**
 * Executes tenant-owned work inside one PostgreSQL transaction whose
 * transaction-local context is set on that exact connection.
 *
 * Guarantees:
 * - a verified scope is required; callers cannot pass a bare tenant id;
 * - application, tenant and principal context are applied with `set_config(...,
 *   true)` and read back before any callback work runs;
 * - nested units of work may reuse the parent only for the identical scope;
 * - a caught inner failure marks the outer unit rollback-only, even if the
 *   callback swallows the error;
 * - an aborted PostgreSQL transaction can never COMMIT successfully;
 * - work that escapes the awaited callback is rejected and cannot use the
 *   connection after settlement;
 * - role changes (`SET ROLE`, `SET SESSION AUTHORIZATION`) are rejected and
 *   re-verified before COMMIT;
 * - connections are always released, and destroyed whenever their session
 *   state is unknown, so pooled reuse cannot leak context or a raised role.
 */
export class TenantUnitOfWork implements TenantUnitOfWorkRunner {
  readonly #pool: PoolLike;

  constructor(pool: PoolLike) {
    this.#pool = pool;
  }

  /** A real outermost transaction, not a structural runner or caller flag. */
  assertOutermost(): void {
    if (!(#pool in this) || transactionStorage.getStore()) throw new TenantTransactionError("outermost recovery transaction required");
  }

  runOutermost<T>(scope: VerifiedScope,work:(transaction:ScopedTransaction)=>Promise<T>,
    onSettlement:(outcome:"COMMITTED"|"ROLLED_BACK")=>void):Promise<T>{
    TenantUnitOfWork.prototype.assertOutermost.call(this);
    return this.#run(scope,work,onSettlement);
  }

  run<T>(scope:VerifiedScope,work:(transaction:ScopedTransaction)=>Promise<T>):Promise<T>{
    return this.#run(scope,work);
  }

  async #run<T>(scope:VerifiedScope,work:(transaction:ScopedTransaction)=>Promise<T>,
    onSettlement?:(outcome:"COMMITTED"|"ROLLED_BACK")=>void):Promise<T>{
    assertVerifiedScope(scope);
    if (!isVerifiedScope(scope)) {
      throw new TenantTransactionError("invalid verified scope");
    }

    const active = transactionStorage.getStore();
    if (active) {
      if (!sameScope(active.scope, scope)) {
        // A prohibited scope switch is a security event: never let the outer
        // transaction commit after the attempt, even if the caller catches it.
        active.rollback.value = true;
        active.rollback.reason = "nested tenant scope switch rejected";
        throw new TenantScopeSwitchError();
      }
      if (active.state.sealed) {
        throw new TenantAsyncEscapeError();
      }
      if (active.rollback.value) {
        throw new TenantTransactionRollbackOnlyError(
          active.rollback.reason ?? "parent transaction is rollback-only",
        );
      }
      const nested = createScopedTransaction(
        active.client,
        scope,
        active.rollback,
        active.state,
      );
      try {
        return await work(nested);
      } catch (error) {
        active.rollback.value = true;
        active.rollback.reason =
          error instanceof Error ? error.message : "nested unit of work failed";
        throw error;
      }
    }

    const client = await this.#pool.connect();
    const rollback: RollbackState = { value: false, reason: null };
    const state: TransactionState = { sealed: false, inFlight: 0 };
    let settled = false;
    let destroy = false;
    let commitAttempted = false;
    let acknowledged:"COMMITTED"|"ROLLED_BACK"|undefined;
    try {
      const begin=await client.query("BEGIN");
      if(onSettlement&&begin.command!=="BEGIN")throw new TenantTransactionError("BEGIN acknowledgment unavailable");
      const identity = await applyTenantContext(client, scope);
      const transaction = createScopedTransaction(
        client,
        scope,
        rollback,
        state,
      );
      let result: T;
      try {
        result = await transactionStorage.run(
          { scope, client, rollback, state },
          () => work(transaction),
        );
      } finally {
        // Seal before any settlement SQL runs: work that escaped the awaited
        // callback can no longer reach the connection once the unit settles.
        state.sealed = true;
      }

      if (state.inFlight > 0) {
        rollback.value = true;
        rollback.reason = "async database work escaped the unit of work";
        settled = true;
        // Destroy instead of rolling back: ROLLBACK would queue behind the
        // escaped query, and the connection must never be reused.
        destroy = true;
        throw new TenantAsyncEscapeError();
      }

      if (rollback.value) {
        const rolledBack = await safeRollback(client,!!onSettlement);
        if(rolledBack&&!commitAttempted)acknowledged="ROLLED_BACK";
        settled = true;
        destroy = !rolledBack;
        throw new TenantTransactionRollbackOnlyError(
          rollback.reason ?? "transaction marked rollback-only",
        );
      }

      // A callback can swallow a PostgreSQL error while the transaction is
      // already aborted. COMMIT would silently become ROLLBACK, so probe first.
      // The probe also re-reads the role identity: a role change that evaded
      // SQL inspection is rejected and the connection destroyed, because role
      // changes survive ROLLBACK.
      let probe: TransactionIdentity;
      try {
        const probed = await client.query<{
          current_user: string;
          session_user: string;
        }>(
          `SELECT
             current_user AS current_user,
             session_user AS session_user`,
        );
        const row = probed.rows[0];
        if (!row) {
          throw new Error("commit probe returned no row");
        }
        probe = { currentUser: row.current_user, sessionUser: row.session_user };
      } catch (error) {
        rollback.value = true;
        rollback.reason =
          error instanceof Error ? error.message : "transaction is aborted";
        const rolledBack = await safeRollback(client,!!onSettlement);
        if(rolledBack&&!commitAttempted)acknowledged="ROLLED_BACK";
        settled = true;
        destroy = !rolledBack;
        throw new TenantTransactionRollbackOnlyError(rollback.reason);
      }

      if (
        probe.currentUser !== identity.currentUser ||
        probe.sessionUser !== identity.sessionUser
      ) {
        if(await safeRollback(client,!!onSettlement))acknowledged="ROLLED_BACK";
        settled = true;
        destroy = true;
        throw new TenantRoleSwitchError(
          `database role changed during the transaction (expected ${identity.currentUser}/${identity.sessionUser}, received ${probe.currentUser}/${probe.sessionUser})`,
        );
      }

      commitAttempted = true;
      const receipt=await client.query("COMMIT");
      if(onSettlement&&receipt.command!=="COMMIT"){
        if(receipt.command==="ROLLBACK"){acknowledged="ROLLED_BACK";settled=true;}
        throw new TenantTransactionError("COMMIT acknowledgment unavailable or rolled back");
      }
      acknowledged="COMMITTED";
      settled = true;
      return result;
    } catch (error) {
      // Never rely on the rollback flag to decide whether ROLLBACK ran: a
      // nested scope switch or caught inner failure sets that flag without
      // touching the connection.
      if (!settled) {
        if (state.inFlight > 0) {
          // An escaped query is still using the connection; ROLLBACK would
          // queue behind it, so destroy the connection instead.
          destroy = true;
        } else {
          const rolledBack = await safeRollback(client,!!onSettlement);
          if(rolledBack&&!commitAttempted)acknowledged="ROLLED_BACK";
          // Destroy when the transaction outcome is unknown (ROLLBACK failed
          // or COMMIT already failed).
          if (!rolledBack || commitAttempted) {
            destroy = true;
          }
        }
      }
      throw error;
    } finally {
      client.release(destroy);
      // Report only an acknowledged terminal result after actual pool release.
      // A failed COMMIT, escaped SQL or failed release reports no settlement.
      if(acknowledged)onSettlement?.(acknowledged);
    }
  }
}

async function applyTenantContext(
  client: Queryable,
  scope: VerifiedScope,
): Promise<TransactionIdentity> {
  await client.query(
    `SELECT
       set_config('vibress.application_id', $1, true),
       set_config('vibress.tenant_id', $2, true),
       set_config('vibress.principal_id', $3, true)`,
    [scope.applicationId, scope.tenantId, scope.principal.id],
  );

  const applied = await client.query<{
    application_id: string | null;
    tenant_id: string | null;
    principal_id: string | null;
    current_user: string;
    session_user: string;
  }>(
    `SELECT
       current_setting('vibress.application_id', true) AS application_id,
       current_setting('vibress.tenant_id', true) AS tenant_id,
       current_setting('vibress.principal_id', true) AS principal_id,
       current_user AS current_user,
       session_user AS session_user`,
  );
  const row = applied.rows[0];
  if (
    !row ||
    row.application_id !== scope.applicationId ||
    row.tenant_id !== scope.tenantId ||
    row.principal_id !== scope.principal.id
  ) {
    throw new TenantContextMismatchError(
      `${scope.applicationId}/${scope.tenantId}/${scope.principal.id}`,
      `${row?.application_id ?? "null"}/${row?.tenant_id ?? "null"}/${row?.principal_id ?? "null"}`,
    );
  }
  return { currentUser: row.current_user, sessionUser: row.session_user };
}

async function safeRollback(client: Queryable,strict=false): Promise<boolean> {
  try {
    const result=await client.query("ROLLBACK");
    return !strict||result.command==="ROLLBACK";
  } catch {
    // The connection may already be unusable; the caller destroys it.
    return false;
  }
}
