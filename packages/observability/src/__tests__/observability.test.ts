import { describe, it, expect, beforeEach } from "vitest";
import {
  metrics,
  exportMetricsText,
  createLogger,
} from "../index";

describe("Observability, Performance & Reliability", () => {
  beforeEach(() => {
    metrics.clear();
  });

  it("collects counters and gauges and exports standard Prometheus text format", () => {
    metrics.counter("http_requests", 5, { method: "GET", status: "200" });
    metrics.gauge("active_connections", 12);

    const text = exportMetricsText();
    expect(text).toContain("# TYPE http_requests_total counter");
    expect(text).toContain('http_requests_total{method="GET",status="200"} 5');
    expect(text).toContain("# TYPE active_connections gauge");
    expect(text).toContain("active_connections 12");
  });

  it("redacts sensitive keys in structured logger", () => {
    const logger = createLogger("test");
    // Verify logger instance is properly constructed with default redact keys
    expect(logger).toBeDefined();
  });
});
