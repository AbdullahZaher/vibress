import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Automated repo contract guard for the optional Prometheus rule pack.
 * For actual PromQL and fixture evaluation use promtool, per OPS-06 runbook.
 */
const rules = readFileSync(
  new URL("../../../ops/monitoring/prometheus/plugin-alerts.yml", import.meta.url),
  "utf8",
);
const fixture = readFileSync(
  new URL("../../../ops/monitoring/prometheus/plugin-alerts.test.yml", import.meta.url),
  "utf8",
);

const alerts = [
  "VibressPluginWorkerScrapeDown",
  "VibressPluginWorkerTargetMissing",
  "VibressPluginConsumerUnavailable",
  "VibressPluginReceiptProbeMissing",
  "VibressPluginReceiptProbeFailed",
  "VibressPluginReceiptProbeStalled",
  "VibressPluginReceiptBacklogStale",
  "VibressPluginReceiptSampleSaturated",
] as const;

describe("PLUG-OPS-06 optional Prometheus alert contract", () => {
  it("contains one bounded-duration rule per failure class and fixed labels only", () => {
    for (const name of alerts) {
      expect(rules.match(new RegExp(`- alert: ${name}\\b`, "g"))).toHaveLength(1);
    }
    const expressions = rules.split("\n").filter(line => line.trimStart().startsWith("expr: "));
    expect(expressions).toHaveLength(alerts.length);
    expect(rules.match(/^[ ]{8}for: [2-9]m$/gm)).toHaveLength(alerts.length);
    expect(rules).not.toMatch(/publication_id|publicationId|pluginId|eventId|requestId|credential|secret=|token=/);
    expect(rules).not.toMatch(/\{\{.*\}\}/);
  });

  it("gates backlog decisions on successful, recent probes and live scrapes", () => {
    const forAlert = (name: string) => {
      const start = rules.indexOf(`- alert: ${name}`);
      if (start < 0) throw new Error("Missing alert");
      return rules.slice(start, rules.indexOf("\n        for: ", start));
    };
    for (const name of ["VibressPluginReceiptBacklogStale",
      "VibressPluginReceiptSampleSaturated"]) {
      const expression = forAlert(name);
      expect(expression).toContain("plugin_events_receipt_probe_ok");
      expect(expression).toContain("plugin_events_receipt_probe_timestamp_seconds");
      expect(expression).toContain("time()");
      expect(expression).toContain('up{job="vibress-worker"} == 1');
      expect(expression).toContain("on (job, instance)");
      expect(expression).not.toMatch(/sum\(|avg\(/);
    }
    expect(forAlert("VibressPluginReceiptProbeStalled")).toContain(
      "plugin_events_receipt_probe_timestamp_seconds",
    );
    expect(forAlert("VibressPluginReceiptProbeMissing")).toContain("unless on");
  });

  it("ships promtool scenarios for healthy, stalled and failing probes", () => {
    expect(fixture).toContain("rule_files:");
    expect(fixture).toContain("plugin-alerts.yml");
    expect(fixture).toContain("alertname: VibressPluginReceiptProbeFailed");
    expect(fixture).toContain("alertname: VibressPluginReceiptProbeStalled");
    expect(fixture).toContain("alertname: VibressPluginReceiptBacklogStale");
    expect(fixture).toContain("exp_alerts:");
  });
});
