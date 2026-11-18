import { describe, expect, it } from "vitest";
import { ExperimentalD1Budget, scheduleExperimentalD1Deadline } from "../../packages/database/src/schema-operator-experimental-deadline";

function harness() {
  let now = 0;
  let expirations = 0;
  const scheduled: { callback: () => void; delayMs: number; canceled: boolean }[] = [];
  const budget = new ExperimentalD1Budget(() => now);
  const cancel = scheduleExperimentalD1Deadline(budget, () => { expirations++; }, (callback, delayMs) => {
    const entry = { callback, delayMs, canceled: false };
    scheduled.push(entry);
    return () => { entry.canceled = true; };
  });
  return { scheduled, budget, cancel, setNow: (value: number) => { now = value; }, expirations: () => expirations };
}

describe("M03-S03 D1 monotonic deadline scheduler", () => {
  it("reschedules early callbacks and transitions exactly once at expiry", () => {
    const h = harness();
    expect(h.scheduled[0]!.delayMs).toBe(2517);
    h.setNow(2516.2);
    h.scheduled[0]!.callback();
    expect(h.expirations()).toBe(0);
    expect(h.scheduled[1]!.delayMs).toBe(1);
    h.setNow(2516.9);
    h.scheduled[1]!.callback();
    expect(h.expirations()).toBe(0);
    h.setNow(2517);
    h.scheduled[2]!.callback();
    h.scheduled[2]!.callback();
    expect(h.expirations()).toBe(1);
  });
  it("does not reset the budget after late delivery", () => {
    const h = harness();
    h.setNow(2600);
    h.scheduled[0]!.callback();
    expect(h.expirations()).toBe(1);
    expect(h.budget.remainingMs()).toBe(-83);
  });
  it("cancels the deadline callback when the operation settles", () => {
    const h = harness();
    h.cancel();
    expect(h.scheduled[0]!.canceled).toBe(true);
    h.setNow(3000);
    h.scheduled[0]!.callback();
    expect(h.expirations()).toBe(0);
  });
  it("immediately reports an already expired budget without scheduling", () => {
    let now = 0;
    const budget = new ExperimentalD1Budget(() => now);
    now = 2517;
    let calls = 0;
    scheduleExperimentalD1Deadline(budget, () => { calls++; }, () => {
      throw new Error("unexpected schedule");
    });
    expect(calls).toBe(1);
  });
});
