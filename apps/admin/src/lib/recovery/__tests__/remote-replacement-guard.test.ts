import { describe, expect, it } from "vitest";
import { canApplyRemoteReplacement } from "../remote-replacement-guard";

const clean = {
  hadUnsavedChangesAtStart: false,
  checkpointDurable: false,
  generationAtStart: 2,
  generationNow: 2,
  hasUnsavedChangesNow: false,
};

describe("remote CRDT restoration fail-closed guard", () => {
  it("allows a restore when no local edits exist", () => {
    expect(canApplyRemoteReplacement(clean)).toBe(true);
  });
  it("rejects replacement after quota failure or unavailable IndexedDB", () => {
    expect(canApplyRemoteReplacement({
      ...clean, hadUnsavedChangesAtStart: true,
      hasUnsavedChangesNow: true, checkpointDurable: false,
    })).toBe(false);
  });
  it("allows replacement after durable checkpointing", () => {
    expect(canApplyRemoteReplacement({
      ...clean, hadUnsavedChangesAtStart: true,
      hasUnsavedChangesNow: true, checkpointDurable: true,
    })).toBe(true);
  });
  it("rejects replacement if author types during the checkpoint", () => {
    expect(canApplyRemoteReplacement({
      ...clean, hadUnsavedChangesAtStart: true,
      hasUnsavedChangesNow: true, checkpointDurable: true, generationNow: 3,
    })).toBe(false);
  });
  it("rejects replacement if typing starts during the remote fetch", () => {
    expect(canApplyRemoteReplacement({ ...clean, hasUnsavedChangesNow: true })).toBe(false);
  });
});
