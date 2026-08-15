import { describe, it, expect } from "vitest";
import {
  metrics,
  createLogger,
  exportMetricsText,
} from "../index";

describe("Observability, Performance & Latency Benchmark Suite", () => {
  it("records 10,000 counter and gauge metrics in sub-millisecond per-op time", () => {
    metrics.clear();
    const count = 10000;
    const start = performance.now();

    for (let i = 0; i < count; i++) {
      metrics.counter("http_requests", 1, { method: "GET", status: "200" });
      metrics.gauge("db_connection_pool_active", 5);
    }

    const durationMs = performance.now() - start;
    const perOpUs = (durationMs / (count * 2)) * 1000;

    // Must process 20,000 metric operations in under 200ms
    expect(durationMs).toBeLessThan(200);
    expect(perOpUs).toBeLessThan(50); // Under 50 microseconds per metric op

    const exported = exportMetricsText();
    expect(exported).toContain("http_requests_total");
    expect(exported).toContain("db_connection_pool_active");
  });

  it("formats structured JSON logs with sensitive field redaction in under 1ms per entry", () => {
    const logger = createLogger("perf-test", { minLevel: "info" });
    const iterations = 1000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      logger.info("user.login", {
        userId: `usr_${i}`,
        password: "SecretPassword123!",
        email: "user@example.com",
      });
    }

    const totalMs = performance.now() - start;
    const avgMs = totalMs / iterations;

    expect(avgMs).toBeLessThan(1.0); // Under 1 millisecond average per log line
  });
});
