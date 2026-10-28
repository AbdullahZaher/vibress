import { beforeEach, describe, expect, it } from "vitest";
import { consumeReturnTo, sanitizeReturnTo } from "./return-to";

describe("Portal sign-in destination", () => {
  beforeEach(() => localStorage.clear());

  it("lands on the authenticated member account when no safe return was saved", () => {
    expect(consumeReturnTo()).toBe("/portal/#/account");
  });

  it("preserves an explicitly selected same-origin public path once", () => {
    localStorage.setItem("vibress_return_to", "/courses/example?mode=read#intro");
    expect(consumeReturnTo()).toBe("/courses/example?mode=read#intro");
    expect(consumeReturnTo()).toBe("/portal/#/account");
  });

  it("rejects untrusted redirect schemes, protocol-relative URLs, Admin and Portal targets", () => {
    for (const bad of [
      "//external.example", "/\\external.example", "javascript:alert(1)",
      "/admin", "/admin/users", "/portal/#/account",
      "/%0a", "/a\nb", "https://external.example/",
    ]) {
      expect(sanitizeReturnTo(bad)).toBeNull();
      localStorage.setItem("vibress_return_to", bad);
      expect(consumeReturnTo()).toBe("/portal/#/account");
    }
  });
});
