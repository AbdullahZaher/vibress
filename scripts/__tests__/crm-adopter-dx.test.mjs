// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ADOPTION_TASKS,
  measureLocalReadiness,
  renderReadinessJson,
  validateBaseline,
} from "../platform/dx/crm-adoption-baseline.mjs";
import { repoRootFromModule } from "../platform/inventory/repository-inventory.mjs";

const repoRoot = repoRootFromModule();

describe("CRM developer-adoption baseline (M00-E13)", () => {
  it("defines at least eight measurable first-user tasks", () => {
    expect(ADOPTION_TASKS.length).toBeGreaterThanOrEqual(8);
    expect(validateBaseline(ADOPTION_TASKS).errors).toEqual([]);
  });

  it("keeps every unexecuted task explicitly unmeasured or blocked", () => {
    for (const task of ADOPTION_TASKS) {
      expect(["NOT_MEASURED", "BLOCKED"]).toContain(task.status);
      expect(task.successCriterion.length).toBeGreaterThan(10);
      expect(task.evidence.length).toBeGreaterThan(0);
    }
    expect(ADOPTION_TASKS.find((task) => task.id === "DX-08").status).toBe("BLOCKED");
  });

  it("rejects invented statuses and progress metrics", () => {
    const bad = JSON.parse(JSON.stringify(ADOPTION_TASKS));
    bad[0].status = "DONE";
    expect(validateBaseline(bad).errors).toEqual(
      expect.arrayContaining(["DX-01: illegal status DONE"]),
    );
    bad[0].status = "NOT_MEASURED";
    bad[0].percentComplete = 50;
    expect(validateBaseline(bad).errors).toEqual(
      expect.arrayContaining(["DX-01: invented metric field percentComplete"]),
    );
  });

  it("measures deterministic source readiness without timings", () => {
    const first = measureLocalReadiness(repoRoot);
    const second = measureLocalReadiness(repoRoot);
    expect(first).toEqual(second);
    expect(first.adoptionTrialsMeasured).toBe(false);
    expect(first.wallClockMeasurements).toBe("NOT_MEASURED");
    expect(first.applications).toBeGreaterThan(0);
    expect(first.packages).toBeGreaterThan(0);
    expect(first.referenceAppActions).toBeGreaterThan(0);
    expect(first.referenceAppRoutes).toBeGreaterThan(0);
  });

  it("records packaging as unavailable while packages are private", () => {
    const readiness = measureLocalReadiness(repoRoot);
    expect(readiness.publicPackages).toBe(0);
    expect(readiness.packedPublicConsumerAvailable).toBe(false);
  });

  it("renders stable JSON without absolute paths or percentages", () => {
    const text = renderReadinessJson(measureLocalReadiness(repoRoot));
    expect(text).not.toContain(repoRoot);
    expect(text).not.toMatch(/percent|burndown/i);
    expect(JSON.parse(text).schemaVersion).toBe(1);
  });
});
