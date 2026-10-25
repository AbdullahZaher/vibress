import { asc, eq } from "drizzle-orm";
import { getDb, pluginEventReceipts } from "@vibress/database";

/**
 * PLUG-OPS-06: bounded, aggregate-only operational view of durable receipt
 * backlog. The oldest items are sampled using the existing (status, created_at)
 * index; never select envelope, publication, plugin or event identifiers.
 *
 * Saturated samples are LOWER BOUNDS, never total counts. Do not use this
 * operational probe to authorize delivery, replay, or health of core CMS.
 */
const RECEIPT_SAMPLE_LIMIT = 250;
const STALE_AFTER_MS = {
  pending: 60_000,
  dispatching: 180_000,
} as const;

export type ActivePluginReceiptStatus = keyof typeof STALE_AFTER_MS;

export interface PluginReceiptAge {
  readonly updatedAt: Date;
}

export interface PluginReceiptStateDiagnostic {
  /** Bounded number of oldest receipt rows observed. Not a fleet-wide total. */
  readonly sampled: number;
  /** Lower bound among sampled rows, using last state-transition timestamp. */
  readonly staleSampled: number;
  /** At least one additional row was omitted; counts are not complete. */
  readonly saturated: boolean;
}

export interface PluginReceiptDiagnostics {
  readonly sampleLimit: number;
  readonly pending: PluginReceiptStateDiagnostic;
  readonly dispatching: PluginReceiptStateDiagnostic;
}

/** Pure projection: testable without disclosing any row identity. */
export function summarizePluginReceiptAges(
  rows: readonly PluginReceiptAge[],
  state: ActivePluginReceiptStatus,
  nowMs: number,
): PluginReceiptStateDiagnostic {
  if (!Number.isFinite(nowMs)) throw new Error("PLUGIN_RECEIPT_DIAGNOSTICS_INVALID");
  const sampled = Math.min(rows.length, RECEIPT_SAMPLE_LIMIT);
  let staleSampled = 0;
  for (const row of rows.slice(0, sampled)) {
    const timestamp = row.updatedAt.getTime();
    if (!Number.isFinite(timestamp)) throw new Error("PLUGIN_RECEIPT_DIAGNOSTICS_INVALID");
    if (nowMs - timestamp >= STALE_AFTER_MS[state]) staleSampled++;
  }
  return { sampled, staleSampled, saturated: rows.length > RECEIPT_SAMPLE_LIMIT };
}

/**
 * Two independent index-bounded reads; no full-table COUNT and no tenant tags.
 * Failed queries propagate to the caller, which must publish an UNKNOWN/probe
 * failed indicator, not replace previous counts with zero or mark core down.
 */
export async function readPluginReceiptDiagnostics(
  nowMs: number = Date.now(),
): Promise<PluginReceiptDiagnostics> {
  const db = getDb();
  const query = (state: ActivePluginReceiptStatus) => db.select({
    updatedAt: pluginEventReceipts.updatedAt,
  }).from(pluginEventReceipts)
    .where(eq(pluginEventReceipts.status, state))
    .orderBy(asc(pluginEventReceipts.createdAt))
    .limit(RECEIPT_SAMPLE_LIMIT + 1);
  const [pending, dispatching] = await Promise.all([
    query("pending"), query("dispatching"),
  ]);
  return {
    sampleLimit: RECEIPT_SAMPLE_LIMIT,
    pending: summarizePluginReceiptAges(pending, "pending", nowMs),
    dispatching: summarizePluginReceiptAges(dispatching, "dispatching", nowMs),
  };
}
