import { describe, expect, it } from "vitest";
import { supportsPublishedExtensionLocale } from "../extension-published-locale";

describe("plugin public content locale declarations", () => {
  it("accepts exact and regional variants of explicitly published languages", () => {
    expect(supportsPublishedExtensionLocale(["en", "ar"], "ar-SA")).toBe(true);
    expect(supportsPublishedExtensionLocale(["en", "ar"], "en-US")).toBe(true);
    expect(supportsPublishedExtensionLocale(["ar-SA"], "ar-SA")).toBe(true);
  });
  it("does not broaden region-specific or unrelated language declarations", () => {
    expect(supportsPublishedExtensionLocale(["ar-SA"], "ar-EG")).toBe(false);
    expect(supportsPublishedExtensionLocale(["ar"], "en-US")).toBe(false);
    expect(supportsPublishedExtensionLocale([], "ar-SA")).toBe(false);
  });
  it("preserves the existing unrestricted default for omitted declarations", () => {
    expect(supportsPublishedExtensionLocale(undefined, "ar-SA")).toBe(true);
  });
});
