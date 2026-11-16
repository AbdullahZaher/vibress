import { describe, expect, it } from "vitest";
import { getQueueIsolationOptions } from "../index";

describe("W1-T06 queue isolation fail-closed configuration", () => {
  const base = { VIBRESS_REQUIRE_INSTALLATION_ISOLATION: "1",
                 VIBRESS_INSTALLATION_ID: "a",
                 VIBRESS_QUEUE_PREFIX: "t06:run:a:bull" };
  it("binds namespace to installation", () => {
    expect(getQueueIsolationOptions(base)).toEqual({ prefix: "t06:run:a:bull" });
  });
  it("preserves backward compatibility when optional isolation is disabled", () => {
    expect(getQueueIsolationOptions({})).toEqual({});
  });
  it("rejects missing or invalid operator identity", () => {
    for (const bad of [
      { ...base, VIBRESS_INSTALLATION_ID: "" },
      { ...base, VIBRESS_INSTALLATION_ID: "b" },
      { ...base, VIBRESS_QUEUE_PREFIX: "" },
      { ...base, VIBRESS_QUEUE_PREFIX: "bull" },
      { ...base, VIBRESS_QUEUE_PREFIX: "*:*" },
      { ...base, VIBRESS_REQUIRE_INSTALLATION_ISOLATION: "yes" },
    ]) {
      expect(() => getQueueIsolationOptions(bad)).toThrow();
    }
  });
  it("never trusts an installation name alone as an access boundary", () => {
    expect(() => getQueueIsolationOptions({
      VIBRESS_REQUIRE_INSTALLATION_ISOLATION: "1",
      VIBRESS_INSTALLATION_ID: "a",
      VIBRESS_QUEUE_PREFIX: "t06:run:b:bull",
    })).toThrow(/must be bound/);
  });
});
