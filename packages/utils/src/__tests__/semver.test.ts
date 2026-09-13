import { describe, it, expect } from "vitest";
import { parseSemver, compareSemver, satisfiesSemver } from "../semver";

describe("SemVer Utilities", () => {
  describe("parseSemver", () => {
    it("parses valid semver without v prefix", () => {
      const parsed = parseSemver("1.2.3");
      expect(parsed).toEqual({ major: 1, minor: 2, patch: 3 });
    });

    it("parses valid semver with v prefix", () => {
      const parsed = parseSemver("v2.0.1");
      expect(parsed).toEqual({ major: 2, minor: 0, patch: 1 });
    });

    it("parses valid semver with prerelease and build metadata", () => {
      const parsed = parseSemver("1.0.0-beta.2+20260913");
      expect(parsed).toEqual({
        major: 1,
        minor: 0,
        patch: 0,
        prerelease: ["beta", "2"],
        build: ["20260913"],
      });
    });

    it("returns null for invalid semver strings", () => {
      expect(parseSemver("1.0")).toBeNull();
      expect(parseSemver("1.0.0.0")).toBeNull();
      expect(parseSemver("invalid")).toBeNull();
      expect(parseSemver("")).toBeNull();
      expect(parseSemver(null)).toBeNull();
      expect(parseSemver(undefined)).toBeNull();
    });
  });

  describe("compareSemver", () => {
    it("compares major versions correctly", () => {
      expect(compareSemver("2.0.0", "1.9.9")).toBe(1);
      expect(compareSemver("1.0.0", "2.0.0")).toBe(-1);
      expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    });

    it("compares minor versions correctly and non-lexicographically", () => {
      expect(compareSemver("1.10.0", "1.9.0")).toBe(1);
      expect(compareSemver("1.9.0", "1.10.0")).toBe(-1);
      expect(compareSemver("1.2.0", "1.2.0")).toBe(0);
    });

    it("compares patch versions correctly", () => {
      expect(compareSemver("1.0.10", "1.0.9")).toBe(1);
      expect(compareSemver("1.0.2", "1.0.12")).toBe(-1);
    });

    it("compares prereleases according to SemVer spec", () => {
      // Normal version has higher precedence than prerelease
      expect(compareSemver("1.0.0", "1.0.0-alpha")).toBe(1);
      expect(compareSemver("1.0.0-alpha", "1.0.0")).toBe(-1);

      // Prerelease comparison: alpha < beta
      expect(compareSemver("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
      expect(compareSemver("1.0.0-beta.1", "1.0.0-beta.2")).toBe(-1);
      expect(compareSemver("1.0.0-beta.11", "1.0.0-beta.2")).toBe(1);
    });

    it("throws on invalid version input", () => {
      expect(() => compareSemver("invalid", "1.0.0")).toThrow();
      expect(() => compareSemver("1.0.0", "invalid")).toThrow();
    });
  });

  describe("satisfiesSemver", () => {
    it("returns true when no constraints are provided", () => {
      expect(satisfiesSemver("1.0.0")).toBe(true);
      expect(satisfiesSemver("2.5.1", null, null)).toBe(true);
    });

    it("checks minVersion correctly", () => {
      expect(satisfiesSemver("1.0.0", "1.0.0")).toBe(true);
      expect(satisfiesSemver("1.5.0", "1.0.0")).toBe(true);
      expect(satisfiesSemver("0.9.0", "1.0.0")).toBe(false);
      expect(satisfiesSemver("1.9.0", "1.10.0")).toBe(false);
      expect(satisfiesSemver("1.10.0", "1.9.0")).toBe(true);
    });

    it("checks maxVersion correctly", () => {
      expect(satisfiesSemver("1.0.0", undefined, "1.0.0")).toBe(true);
      expect(satisfiesSemver("1.0.0", undefined, "2.0.0")).toBe(true);
      expect(satisfiesSemver("2.1.0", undefined, "2.0.0")).toBe(false);
    });

    it("checks range [minVersion, maxVersion] correctly", () => {
      expect(satisfiesSemver("1.5.0", "1.0.0", "2.0.0")).toBe(true);
      expect(satisfiesSemver("1.0.0", "1.0.0", "2.0.0")).toBe(true);
      expect(satisfiesSemver("2.0.0", "1.0.0", "2.0.0")).toBe(true);
      expect(satisfiesSemver("0.9.9", "1.0.0", "2.0.0")).toBe(false);
      expect(satisfiesSemver("2.0.1", "1.0.0", "2.0.0")).toBe(false);
    });

    it("returns false for invalid version strings", () => {
      expect(satisfiesSemver("bad-version", "1.0.0")).toBe(false);
      expect(satisfiesSemver("1.0.0", "bad-min")).toBe(false);
      expect(satisfiesSemver("1.0.0", "1.0.0", "bad-max")).toBe(false);
    });
  });
});
