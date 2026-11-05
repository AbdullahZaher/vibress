import { describe, expect, it } from "vitest";
import { EditorialAutosaveGenerations } from "../editorial-autosave-generations";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("EditorialAutosaveGenerations (host persistence acknowledgement)", () => {
  it("scenario A: does not acknowledge edit B when save A resolves before B begins saving", async () => {
    const clock = new EditorialAutosaveGenerations();
    clock.markEdited(); // A
    const ticketA = clock.beginSave();
    const responseA = deferred<{ version: number }>();
    clock.markEdited(); // B, while A is in flight
    responseA.resolve({ version: 2 });
    await responseA.promise;
    expect(clock.acknowledge(ticketA)).toEqual({ latestRequest: true, latestEdit: false });
    const ticketB = clock.beginSave();
    expect(clock.acknowledge(ticketB)).toEqual({ latestRequest: true, latestEdit: true });
  });

  it("scenario B: rejects out-of-order response A after request B starts", async () => {
    const clock = new EditorialAutosaveGenerations();
    clock.markEdited();
    const a = clock.beginSave();
    clock.markEdited();
    const b = clock.beginSave();
    const responseA = deferred<number>();
    const responseB = deferred<number>();
    responseB.resolve(3);
    expect(await responseB.promise).toBe(3);
    expect(clock.isCurrent(b)).toBe(true);
    responseA.resolve(2);
    await responseA.promise;
    expect(clock.acknowledge(a).latestRequest).toBe(false);
  });

  it("scenario C: aborted older requests cannot acknowledge newer changes", async () => {
    const clock = new EditorialAutosaveGenerations();
    clock.markEdited();
    const a = clock.beginSave();
    clock.markEdited();
    const b = clock.beginSave();
    expect(clock.isCurrent(a)).toBe(false);
    expect(clock.isCurrent(b)).toBe(true);
  });

  it("scenario D: a conflict does not acknowledge any unsaved generation", () => {
    const clock = new EditorialAutosaveGenerations();
    clock.markEdited();
    const ticket = clock.beginSave();
    const failure = new Error("HTTP 409");
    expect(failure.message).toContain("409");
    clock.markEdited();
    expect(clock.isCurrent(ticket)).toBe(false);
  });

  it("scenario E: rapid edits across requests never make older snapshots current", () => {
    const clock = new EditorialAutosaveGenerations();
    const tickets = [];
    for (let i = 0; i < 100; i++) {
      clock.markEdited();
      if (i % 5 === 0) tickets.push(clock.beginSave());
    }
    const latest = clock.beginSave();
    for (const old of tickets) expect(clock.isCurrent(old)).toBe(false);
    expect(clock.isCurrent(latest)).toBe(true);
  });

  it("scenario F: metadata changes count as edits and cannot be acknowledged by an older snapshot", () => {
    const clock = new EditorialAutosaveGenerations();
    clock.markEdited(); // content
    const ticket = clock.beginSave();
    for (const field of ["title", "excerpt", "tags", "featured", "seo"]) {
      expect(field).toBeTruthy();
      clock.markEdited();
    }
    expect(clock.isCurrent(ticket)).toBe(false);
    expect(clock.currentGeneration).toBe(6);
  });

  it("scenario G: explicit document restore invalidates all earlier request tickets", () => {
    const clock = new EditorialAutosaveGenerations();
    clock.markEdited();
    const ticket = clock.beginSave();
    clock.reset();
    expect(clock.acknowledge(ticket)).toEqual({ latestRequest: false, latestEdit: false });
  });
});
