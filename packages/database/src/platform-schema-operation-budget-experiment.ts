/**
 * M03-S03 TEST-ONLY EXPERIMENT — NOT APPROVED OR EXPORTED BY THE DATABASE API.
 *
 * Policy A/B selection and actual numeric execution budget are NOT approved.
 * Callers MUST provide a positive numeric fixture budget; never default to one.
 *
 * This experimental decorator adds a monotonic cumulative admission deadline
 * to the EXISTING restricted PostgreSQL operator without altering its SQL,
 * locks, migrations, privilege checks, or final authorization code.
 *
 * For blocked PostgreSQL work, cancellation is mandatory out-of-band through
 * a separately authenticated, backend-identity-checked control channel.
 * A client timer ALONE cannot establish server rollback. Completion after a
 * deadline or an unknown COMMIT result is classified INDETERMINATE.
 */
import { hrtime } from "node:process";
import type { ClientBase } from "pg";
import {
  executeApprovedAdditiveColumn,
  type SchemaOperatorRequest,
  type SchemaOperatorResult,
} from "./platform-schema-migration-operator";

export class ExperimentalBudgetError extends Error {
  readonly name = "ExperimentalBudgetError";
  constructor(readonly code: "DEADLINE_EXCEEDED" | "INDETERMINATE") {
    super(code === "DEADLINE_EXCEEDED"
      ? "experiment budget exhausted; rollback acknowledged"
      : "experiment deadline uncertainty; fresh-session reconciliation required");
  }
}

export interface ExperimentalBudget {
  readonly durationMs: number;
  readonly startedAtNs: bigint;
}

export function startExperimentalBudget(durationMs: number): ExperimentalBudget {
  if (process.env.NODE_ENV === "production" ||
    !Number.isSafeInteger(durationMs) || durationMs < 1 ||
    durationMs > 2147483647) {
    throw new Error("explicit finite positive nonproduction fixture budget required");
  }
  // Called by the test BEFORE connection acquisition; never reset at BEGIN.
  return Object.freeze({ durationMs, startedAtNs: hrtime.bigint() });
}

function remainingMs(budget: ExperimentalBudget): number {
  const elapsedNs = hrtime.bigint() - budget.startedAtNs;
  return Math.max(0, budget.durationMs - Number(elapsedNs) / 1_000_000);
}

export interface ExperimentalCancel {
  /** Only cancel the exact verified dedicated backend; NEVER arbitrary PIDs. */
  readonly cancelVerifiedActiveQuery: () => Promise<boolean>;
}

type QueryOutcome = { readonly kind: "ok"; readonly value: unknown } |
  { readonly kind: "error"; readonly error: unknown };

/**
 * This experiment intentionally does not alter the production CLI, PG grants,
 * approval policy, per-phase timeout configuration, or executable SQL scope.
 * No default budget or public runtime entrypoint exists.
 */
export async function executeExperimentalBudgetedAdditiveColumn(
  rawDb: ClientBase,
  request: SchemaOperatorRequest,
  budget: ExperimentalBudget,
  control: ExperimentalCancel,
): Promise<SchemaOperatorResult> {
  if (remainingMs(budget) <= 0) {
    throw new ExperimentalBudgetError("DEADLINE_EXCEEDED");
  }
  let exhausted = false;
  let commitSent = false;
  let rollbackAcknowledged = false;
  let uncertain = false;

  const wrapped = new Proxy(rawDb, {
    get(target, property) {
      if (property !== "query") {
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
      const query = async (sql: string, params?: unknown[]): Promise<unknown> => {
        // A rollback must remain possible after the budget is exhausted.
        if (sql === "ROLLBACK") {
          const result = params ? await target.query(sql, params) : await target.query(sql);
          rollbackAcknowledged = true;
          return result;
        }
        const remaining = remainingMs(budget);
        if (remaining <= 0 || exhausted) {
          exhausted = true;
          throw new ExperimentalBudgetError("DEADLINE_EXCEEDED");
        }
        if (sql === "COMMIT") commitSent = true;
        const pending: Promise<QueryOutcome> = (
          params ? target.query(sql, params) : target.query(sql)
        ).then(value => ({ kind: "ok" as const, value }),
          error => ({ kind: "error" as const, error }));
        let timer: ReturnType<typeof setTimeout> | undefined;
        const expired = new Promise<{ readonly kind: "expired" }>(resolve => {
          timer = setTimeout(() => resolve({ kind: "expired" }), Math.ceil(remaining));
        });
        let outcome: QueryOutcome | { readonly kind: "expired" };
        try {
          outcome = await Promise.race([pending, expired]);
        } finally {
          if (timer) clearTimeout(timer);
        }
        if (outcome.kind === "expired") {
          exhausted = true;
          // Once COMMIT has been SENT, even a cancel/close/timeout cannot prove
          // rollback. Do not cancel it as though it were ordinary SQL.
          if (commitSent) {
            uncertain = true;
            throw new ExperimentalBudgetError("INDETERMINATE");
          }
          let canceled = false;
          try {
            canceled = await control.cancelVerifiedActiveQuery();
          } catch {
            uncertain = true;
            throw new ExperimentalBudgetError("INDETERMINATE");
          }
          if (!canceled) {
            uncertain = true;
            throw new ExperimentalBudgetError("INDETERMINATE");
          }
          // The watchdog requested cancellation. We MUST still observe query
          // settlement and later an acknowledged ROLLBACK; cancel alone is not
          // rollback proof. This cleanup guard is not a release deadline.
          const settled = await Promise.race([
            pending,
            new Promise<{ readonly kind: "unsettled" }>(resolve =>
              setTimeout(() => resolve({ kind: "unsettled" }), 1500)),
          ]);
          if (settled.kind === "unsettled") {
            uncertain = true;
            throw new ExperimentalBudgetError("INDETERMINATE");
          }
          throw new ExperimentalBudgetError("DEADLINE_EXCEEDED");
        }
        if (outcome.kind === "error") throw outcome.error;
        if (remainingMs(budget) <= 0) {
          exhausted = true;
          if (commitSent) {
            uncertain = true;
            throw new ExperimentalBudgetError("INDETERMINATE");
          }
          throw new ExperimentalBudgetError("DEADLINE_EXCEEDED");
        }
        return outcome.value;
      };
      return query as ClientBase["query"];
    },
  });
  try {
    const result = await executeApprovedAdditiveColumn(wrapped, request);
    if (remainingMs(budget) <= 0 || exhausted) {
      // Never claim an immediate successful APPLIED after deadline even when
      // the server might already have committed.
      throw new ExperimentalBudgetError("INDETERMINATE");
    }
    return result;
  } catch (error) {
    if (uncertain || commitSent) {
      throw new ExperimentalBudgetError("INDETERMINATE");
    }
    if (exhausted || remainingMs(budget) <= 0) {
      if (!rollbackAcknowledged) {
        try {
          await rawDb.query("ROLLBACK");
          rollbackAcknowledged = true;
        } catch {
          throw new ExperimentalBudgetError("INDETERMINATE");
        }
      }
      if (rollbackAcknowledged) throw new ExperimentalBudgetError("DEADLINE_EXCEEDED");
      throw new ExperimentalBudgetError("INDETERMINATE");
    }
    throw error;
  }
}
