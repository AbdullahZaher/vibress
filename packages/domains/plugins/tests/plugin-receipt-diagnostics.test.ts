import { describe, expect, it } from "vitest";
import { summarizePluginReceiptAges } from "../src/application/plugin-receipt-diagnostics";

const clock = Date.parse("2026-10-25T12:00:00.000Z");
const at = (ms: number) => ({ updatedAt: new Date(clock - ms) });

describe("PLUG-OPS-06 durable receipt diagnostics", () => {
  it("distinguishes retryable pending age from an ordinary dispatch lease", () => {
    expect(summarizePluginReceiptAges([at(60_001), at(59_999)], "pending", clock))
      .toEqual({ sampled: 2, staleSampled: 1, saturated: false });
    expect(summarizePluginReceiptAges([at(120_000), at(180_000)], "dispatching", clock))
      .toEqual({ sampled: 2, staleSampled: 1, saturated: false });
  });

  it("uses a capped lower bound instead of claiming exact fleet totals", () => {
    const rows = Array.from({ length: 251 }, () => at(200_000));
    expect(summarizePluginReceiptAges(rows, "dispatching", clock))
      .toEqual({ sampled: 250, staleSampled: 250, saturated: true });
    expect(summarizePluginReceiptAges([], "pending", clock))
      .toEqual({ sampled: 0, staleSampled: 0, saturated: false });
  });

  it("fails closed for invalid timestamps without exposing receipt data", () => {
    expect(() => summarizePluginReceiptAges(
      [{ updatedAt: new Date("invalid") }], "pending", clock,
    )).toThrow("PLUGIN_RECEIPT_DIAGNOSTICS_INVALID");
    expect(() => summarizePluginReceiptAges([at(1000)], "pending", Number.NaN))
      .toThrow("PLUGIN_RECEIPT_DIAGNOSTICS_INVALID");
  });
});
