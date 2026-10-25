import { describe, expect, it, vi } from "vitest";
import type { PluginReceiptDiagnostics } from "@vibress/plugins";
import { observePluginReceiptBacklog } from "../plugin-receipt-metrics";

const report: PluginReceiptDiagnostics = {
  sampleLimit: 250,
  pending: { sampled: 250, staleSampled: 5, saturated: true },
  dispatching: { sampled: 2, staleSampled: 0, saturated: false },
};

describe("PLUG-OPS-06 aggregate-only worker backlog telemetry", () => {
  it("records only fixed status labels and honest bounded lower bounds", async () => {
    const gauge = vi.fn();
    const counter = vi.fn();
    await expect(observePluginReceiptBacklog(async () => report, { gauge, counter }))
      .resolves.toBe(true);
    expect(gauge).toHaveBeenCalledWith("plugin_events_receipt_sampled", 250,
      { state: "pending" });
    expect(gauge).toHaveBeenCalledWith("plugin_events_receipt_stale_sampled", 5,
      { state: "pending" });
    expect(gauge).toHaveBeenCalledWith("plugin_events_receipt_sample_saturated", 1,
      { state: "pending" });
    expect(gauge).toHaveBeenCalledWith("plugin_events_receipt_stale_sampled", 0,
      { state: "dispatching" });
    expect(gauge).toHaveBeenCalledWith("plugin_events_receipt_probe_ok", 1);
    expect(counter).not.toHaveBeenCalled();
    const output = JSON.stringify(gauge.mock.calls);
    expect(output).not.toContain("publicationId");
    expect(output).not.toContain("pluginId");
    expect(output).not.toContain("eventId");
    expect(output).not.toContain("envelope");
  });

  it("preserves last samples and reports unknown status after a DB error", async () => {
    const gauge = vi.fn();
    const counter = vi.fn();
    const err = new Error("secret_token=internal-db-private");
    await expect(observePluginReceiptBacklog(async () => { throw err; }, {
      gauge, counter,
    })).resolves.toBe(false);
    expect(gauge).toHaveBeenCalledTimes(1);
    expect(gauge).toHaveBeenCalledWith("plugin_events_receipt_probe_ok", 0);
    expect(counter).toHaveBeenCalledTimes(1);
    expect(counter).toHaveBeenCalledWith("plugin_events_receipt_probe_failures");
    expect(JSON.stringify([...gauge.mock.calls, ...counter.mock.calls]))
      .not.toContain("internal-db-private");
  });
});
