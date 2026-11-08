import { describe, expect, it } from "vitest";
import { getSafeRedirectUrl } from "../page";

describe("getSafeRedirectUrl — private gate open redirect mitigation", () => {
  it("allows safe relative paths with query parameters and hashes", () => {
    expect(getSafeRedirectUrl("/posts/welcome")).toBe("/posts/welcome");
    expect(getSafeRedirectUrl("/tag/security?sort=desc#top")).toBe("/tag/security?sort=desc#top");
    expect(getSafeRedirectUrl("/")).toBe("/");
  });

  it("rejects protocol-relative and backslash bypass attempts", () => {
    expect(getSafeRedirectUrl("//evil.com")).toBe("/");
    expect(getSafeRedirectUrl("//attacker.org/steal")).toBe("/");
    expect(getSafeRedirectUrl("/\\evil.com")).toBe("/");
  });

  it("rejects absolute external URLs and dangerous schemes", () => {
    expect(getSafeRedirectUrl("https://evil.com")).toBe("/");
    expect(getSafeRedirectUrl("http://evil.com/path")).toBe("/");
    expect(getSafeRedirectUrl("javascript:alert(1)")).toBe("/");
    expect(getSafeRedirectUrl("data:text/html,<script>alert(1)</script>")).toBe("/");
  });

  it("rejects control characters, newlines, tabs, and malformed destinations", () => {
    expect(getSafeRedirectUrl("/\npath")).toBe("/");
    expect(getSafeRedirectUrl("/\r\nSet-Cookie: evil")).toBe("/");
    expect(getSafeRedirectUrl("/\u0000evil")).toBe("/");
    expect(getSafeRedirectUrl(null)).toBe("/");
    expect(getSafeRedirectUrl(undefined)).toBe("/");
    expect(getSafeRedirectUrl("")).toBe("/");
  });
});
