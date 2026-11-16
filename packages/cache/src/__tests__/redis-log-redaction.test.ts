import { describe, it, expect } from "vitest";
import { safeRedisErrorCode } from "../index";

describe("W1-T06 Redis log redaction", () => {
  it("retains only bounded provider codes", () => {
    expect(safeRedisErrorCode({ code: "ECONNREFUSED", message: "redis://user:secret@host" }))
      .toBe("ECONNREFUSED");
    expect(safeRedisErrorCode({ code: "WRONGPASS" })).toBe("WRONGPASS");
  });
  it("never returns messages or URLs when unrecognized", () => {
    for (const failure of [
      { message: "redis://user:secret@host:6379" },
      { code: "redis://user:secret@host", message: "password=secret" },
      null,
      "redis://user:secret@host",
      { code: "EXPLOIT\nSECRET" },
    ]) {
      expect(safeRedisErrorCode(failure)).toBe("REDIS_ERROR");
    }
  });
});
