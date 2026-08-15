import { AsyncLocalStorage } from "node:async_hooks";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../schema";

export type TransactionDb = NodePgDatabase<typeof schema>;

const transactionStorage = new AsyncLocalStorage<TransactionDb | null>();

export function isInsideTransaction(): boolean {
  return transactionStorage.getStore() !== undefined;
}

export function getTransactionDb(): TransactionDb | null {
  const tx = transactionStorage.getStore();
  return tx === undefined ? null : tx;
}

export function runWithTransaction<T>(
  tx: TransactionDb,
  work: () => Promise<T>,
): Promise<T> {
  return transactionStorage.run(tx, work);
}
