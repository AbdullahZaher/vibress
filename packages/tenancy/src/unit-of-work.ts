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
}

export interface Queryable {
  query<TRow = unknown>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<QueryResult<TRow>>;
}

export interface PoolClientLike extends Queryable {
  release(): void;
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

interface RollbackState {
  value: boolean;
  reason: string | null;
}

interface ActiveTransaction {
  readonly scope: VerifiedScope;
  readonly client: PoolClientLike;
  readonly rollback: RollbackState;
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
 * Any detected attempt to alter or reset `vibress.*` GUCs immediately marks the
 * transaction as rollback-only so it can never be committed.
 */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ");
}

const SCOPE_MUTATION_PATTERN =
  /(?:(?:pg_catalog\.)?set_config\s*\(\s*['"]vibress\.|set\s+(?:(?:session|local)\s+)?['"]?vibress\.|reset\s+(?:all|['"]?vibress\.))/i;

function assertNoScopeMutation(sql: string): void {
  const stripped = stripSqlComments(sql);
  if (SCOPE_MUTATION_PATTERN.test(stripped)) {
    throw new TenantScopeMutationError();
  }
}

function createScopedTransaction(
  client: PoolClientLike,
  scope: VerifiedScope,
  rollback: RollbackState,
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
      if (rollback.value) {
        throw new TenantTransactionRollbackOnlyError(
          rollback.reason ?? "transaction marked rollback-only",
        );
      }
      try {
        assertNoScopeMutation(sql);
      } catch (error) {
        markRollbackOnly("scope mutation attempt detected");
        throw error;
      }
      return client.query<TRow>(sql, parameters);
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
 * - connections are always released, so pooled reuse cannot leak context.
 */
export class TenantUnitOfWork implements TenantUnitOfWorkRunner {
  readonly #pool: PoolLike;

  constructor(pool: PoolLike) {
    this.#pool = pool;
  }

  async run<T>(
    scope: VerifiedScope,
    work: (transaction: ScopedTransaction) => Promise<T>,
  ): Promise<T> {
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
      if (active.rollback.value) {
        throw new TenantTransactionRollbackOnlyError(
          active.rollback.reason ?? "parent transaction is rollback-only",
        );
      }
      const nested = createScopedTransaction(
        active.client,
        scope,
        active.rollback,
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
    let settled = false;
    try {
      await client.query("BEGIN");
      await applyTenantContext(client, scope);
      const transaction = createScopedTransaction(client, scope, rollback);
      const result = await transactionStorage.run(
        { scope, client, rollback },
        () => work(transaction),
      );

      if (rollback.value) {
        await safeRollback(client);
        settled = true;
        throw new TenantTransactionRollbackOnlyError(
          rollback.reason ?? "transaction marked rollback-only",
        );
      }

      // A callback can swallow a PostgreSQL error while the transaction is
      // already aborted. COMMIT would silently become ROLLBACK, so probe first.
      try {
        await client.query("SELECT 1");
      } catch (error) {
        rollback.value = true;
        rollback.reason =
          error instanceof Error ? error.message : "transaction is aborted";
        await safeRollback(client);
        settled = true;
        throw new TenantTransactionRollbackOnlyError(rollback.reason);
      }

      await client.query("COMMIT");
      settled = true;
      return result;
    } catch (error) {
      // Never rely on the rollback flag to decide whether ROLLBACK ran: a
      // nested scope switch or caught inner failure sets that flag without
      // touching the connection.
      if (!settled) {
        await safeRollback(client);
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

async function applyTenantContext(
  client: Queryable,
  scope: VerifiedScope,
): Promise<void> {
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
  }>(
    `SELECT
       current_setting('vibress.application_id', true) AS application_id,
       current_setting('vibress.tenant_id', true) AS tenant_id,
       current_setting('vibress.principal_id', true) AS principal_id`,
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
}

async function safeRollback(client: Queryable): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The connection may already be unusable; release still returns it.
  }
}
