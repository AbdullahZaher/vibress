import { getDb } from "../connection";
import {
  isInsideTransaction,
  runWithTransaction,
  type TransactionDb,
} from "./transaction-context";
import { withSpan } from "@vibress/observability";

export interface TransactionRunner {
  run<T>(work: () => Promise<T>): Promise<T>;
}

/**
 * Runs `work` inside a single database transaction.
 *
 * Nesting policy: a nested `runInTransaction` call inside an active
 * transaction reuses the current transaction. No savepoints are created.
 * The transaction commits when `work` resolves and rolls back when it
 * rejects.
 *
 * All repositories that access the database through `getDb()` automatically
 * participate in the active transaction while `work` is executing.
 */
export async function runInTransaction<T>(work: () => Promise<T>): Promise<T> {
  if (isInsideTransaction()) {
    return work();
  }
  const db = getDb();
  return withSpan("db.transaction", () =>
    db.transaction((tx) => runWithTransaction(tx as TransactionDb, work)),
  );
}

export class DrizzleTransactionRunner implements TransactionRunner {
  async run<T>(work: () => Promise<T>): Promise<T> {
    return runInTransaction(work);
  }
}

export const defaultTransactionRunner: TransactionRunner =
  new DrizzleTransactionRunner();
