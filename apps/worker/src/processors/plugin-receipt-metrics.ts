import type { PluginReceiptDiagnostics } from "@vibress/plugins";

/** Only fixed enum labels; never label tenant, plugin, event, or error text. */
interface PluginReceiptMeter {
  gauge(name: string, value: number, tags?: Record<string, string>): void;
  counter(name: string, value?: number, tags?: Record<string, string>): void;
}

/**
 * A failed database probe is UNKNOWN, not a healthy zero backlog and not
 * evidence that core CMS health is down. Preserve prior backlog values and
 * emit only a fixed-cardinality probe-failure signal.
 */
export async function observePluginReceiptBacklog(
  collect: () => Promise<PluginReceiptDiagnostics>,
  meter: PluginReceiptMeter,
): Promise<boolean> {
  let result: PluginReceiptDiagnostics;
  try {
    result = await collect();
  } catch {
    meter.gauge("plugin_events_receipt_probe_ok", 0);
    meter.counter("plugin_events_receipt_probe_failures");
    return false;
  }
  for (const state of ["pending", "dispatching"] as const) {
    const sample = result[state];
    const tags = { state };
    meter.gauge("plugin_events_receipt_sampled", sample.sampled, tags);
    meter.gauge("plugin_events_receipt_stale_sampled", sample.staleSampled, tags);
    meter.gauge("plugin_events_receipt_sample_saturated", sample.saturated ? 1 : 0, tags);
  }
  meter.gauge("plugin_events_receipt_probe_ok", 1);
  return true;
}
