import { describe, expect, it } from "vitest";
import { ExperimentalSessionLifecycle } from "../../packages/database/src/schema-operator-experimental-session";
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

describe("M03-S03 terminal session dispatch fence", () => {
  it("fences a losing async continuation on transport failure before D1 expires", async () => {
    const budget = new ExperimentalD1Budget(() => 0);
    const session = new ExperimentalSessionLifecycle(budget);
    session.beforeDispatch("BEGIN");
    session.acknowledge("BEGIN", "BEGIN");
    let resume: () => void = () => undefined;
    const pending = new Promise<void>(resolve => { resume = resolve; });
    const sent: string[] = [];
    const operation = (async () => {
      session.beforeDispatch("SQL");
      sent.push("refresh");
      await pending;
      session.beforeDispatch("SQL");
      sent.push("DDL");
    })();
    expect(session.fence("TRANSPORT_FAILED")).toBe(true);
    session.retire();
    resume();
    await expect(operation).rejects.toThrow("terminal session fenced");
    expect(sent).toEqual(["refresh"]);
    expect(() => session.beforeDispatch("COMMIT")).toThrow();
    expect(() => session.beforeDispatch("ROLLBACK")).toThrow();
    expect(session.snapshot()).toMatchObject({ phase: "TRANSACTION_ACTIVE",
      terminalCause: "TRANSPORT_FAILED", retired: true, cleanupPermitted: false });
  });

  it("allows rollback after budget expiry only on an unfenced transaction", () => {
    let now = 0;
    const session = new ExperimentalSessionLifecycle(new ExperimentalD1Budget(() => now));
    session.beforeDispatch("BEGIN");
    now = 2517;
    expect(() => session.beforeDispatch("SQL")).toThrow();
    expect(() => session.beforeDispatch("COMMIT")).toThrow();
    session.beforeDispatch("ROLLBACK");
    session.acknowledge("ROLLBACK", "ROLLBACK");
    expect(session.snapshot()).toMatchObject({ phase: "ROLLED_BACK", cleanupPermitted: false });
    expect(() => session.beforeDispatch("ROLLBACK")).toThrow();
  });

  it("keeps actual late commit acknowledgment separate from immutable terminal cause", () => {
    const session = new ExperimentalSessionLifecycle(new ExperimentalD1Budget(() => 0));
    session.beforeDispatch("BEGIN");
    session.acknowledge("BEGIN", "BEGIN");
    session.beforeDispatch("COMMIT");
    expect(() => session.beforeDispatch("ROLLBACK")).toThrow();
    session.fence("DEADLINE_EXCEEDED");
    session.retire();
    session.acknowledge("COMMIT", "COMMIT");
    expect(session.snapshot()).toMatchObject({beginDispatched: true, commitDispatched: true, commitAcknowledged: true});
    expect(session.fence("NORMAL_COMPLETION")).toBe(false);
    expect(session.snapshot()).toMatchObject({ phase: "COMMIT_ACKNOWLEDGED",
      terminalCause: "DEADLINE_EXCEEDED", retired: true, closed: false });
    session.markClosed();
    expect(session.snapshot().closed).toBe(true);
    expect(() => session.beforeDispatch("SQL")).toThrow();
  });

  it("cannot reopen dispatch after fencing during connect or delayed BEGIN acknowledgment", () => {
    const budget = new ExperimentalD1Budget(() => 0);
    const connecting = new ExperimentalSessionLifecycle(budget, true);
    connecting.fence("DEADLINE_EXCEEDED");
    expect(() => connecting.connected()).toThrow();
    expect(() => connecting.beforeDispatch("BEGIN")).toThrow();
    const active = new ExperimentalSessionLifecycle(budget);
    active.beforeDispatch("BEGIN");
    active.fence("TRANSPORT_FAILED");
    active.acknowledge("BEGIN", "BEGIN");
    expect(active.snapshot().phase).toBe("TRANSACTION_ACTIVE");
    expect(() => active.beforeDispatch("SQL")).toThrow();
    expect(() => active.beforeDispatch("ROLLBACK")).toThrow();
  });

  it("rejects SQL outside a live transaction and distinguishes COMMIT answered with ROLLBACK", () => {
    const session = new ExperimentalSessionLifecycle(new ExperimentalD1Budget(() => 0));
    expect(() => session.beforeDispatch("SQL")).toThrow();
    session.beforeDispatch("BEGIN");
    expect(() => session.beforeDispatch("SQL")).toThrow();
    session.acknowledge("BEGIN", "BEGIN");
    expect(() => session.beforeDispatch("BEGIN")).toThrow();
    session.beforeDispatch("COMMIT");
    session.acknowledge("COMMIT", "ROLLBACK");
    expect(session.snapshot()).toMatchObject({phase: "ROLLED_BACK", beginDispatched: true,
      commitDispatched: true, commitAcknowledged: false});
    expect(() => session.beforeDispatch("COMMIT")).toThrow();
  });
});

it("binds a lifecycle to the exact whole-operation budget instance", () => {
  const budget = new ExperimentalD1Budget(() => 0);
  const session = new ExperimentalSessionLifecycle(budget);
  expect(session.usesBudget(budget)).toBe(true);
  expect(session.usesBudget(new ExperimentalD1Budget(() => 0))).toBe(false);
});
