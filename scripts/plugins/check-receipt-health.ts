import { closeDbPool } from "@vibress/database";
import { readPluginReceiptDiagnostics } from "@vibress/plugins";

/**
 * Operator-only, read-only PostgreSQL diagnosis. This is not an API route,
 * cannot mutate receipts, does not connect to Redis and never prints PII,
 * event envelopes, identities, credentials or database exception messages.
 */
async function main(): Promise<void> {
  if (process.env.VIBRESS_PLUGIN_RECEIPT_DIAGNOSTICS !== "1") {
    throw new Error("PLUGIN_RECEIPT_DIAGNOSTICS_NOT_AUTHORIZED");
  }
  const summary = await readPluginReceiptDiagnostics();
  console.info("Plugin durable receipt diagnostic (sampled lower bounds)", summary);
  // Exit nonzero so operator-run monitors can alert. A saturated sample
  // warrants investigation even when its observed subset is not yet stale.
  if (summary.pending.staleSampled > 0 ||
      summary.dispatching.staleSampled > 0 ||
      summary.pending.saturated || summary.dispatching.saturated) {
    process.exitCode = 2;
  }
}

void main().catch(() => {
  console.error("Plugin receipt diagnostic unavailable; status unknown");
  process.exitCode = 1;
}).finally(async () => {
  await closeDbPool();
});
