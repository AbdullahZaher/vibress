import { describe, expect, it } from "vitest";
import { isPlatformPluginOperator } from "../authorization";

describe("platform-wide plugin operator authorization", () => {
  const permissions = ["plugins.manage", "system.manage"];

  it("allows only an authenticated global owner or administrator with both permissions", () => {
    expect(isPlatformPluginOperator(["owner"], permissions)).toBe(true);
    expect(isPlatformPluginOperator(["administrator"], permissions)).toBe(true);
  });

  it("denies publication editors and administrators without global operator permissions", () => {
    expect(isPlatformPluginOperator(["editor"], permissions)).toBe(false);
    expect(isPlatformPluginOperator(["administrator"], ["plugins.manage"])).toBe(false);
    expect(isPlatformPluginOperator(["administrator"], ["system.manage"])).toBe(false);
    expect(isPlatformPluginOperator(["author"], ["plugins.manage", "system.manage"])).toBe(false);
    expect(isPlatformPluginOperator(undefined, permissions)).toBe(false);
    expect(isPlatformPluginOperator(["owner"], undefined)).toBe(false);
    expect(isPlatformPluginOperator([], [])).toBe(false);
  });
});
