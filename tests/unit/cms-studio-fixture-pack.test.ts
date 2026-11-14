import { describe, expect, it } from "vitest";
import {
  CMS_STUDIO_FIXTURE_PACK,
  CMS_STUDIO_FIXTURE_PACK_DIGEST,
  CmsStudioFixturePackError,
  computeCmsStudioFixturePackDigest,
  loadCmsStudioFixturePack,
  stableStringify,
  verifyCmsStudioFixturePack,
  type CmsStudioFixturePack,
} from "../fixtures/cms-studio/fixture-pack";

describe("pinned CMS/Studio fixture pack", () => {
  it("verifies the pinned digest and validates every pinned Studio document", () => {
    const pack = loadCmsStudioFixturePack();
    expect(pack).toBe(CMS_STUDIO_FIXTURE_PACK);
    expect(computeCmsStudioFixturePackDigest()).toBe(CMS_STUDIO_FIXTURE_PACK_DIGEST);
    expect(pack.publications.map((entry) => entry.key).sort()).toEqual([
      "primary",
      "secondary",
    ]);
    expect(pack.content.length).toBeGreaterThan(0);
    for (const entry of pack.content) {
      expect(entry.document.schema).toBe("vibress-studio");
      expect(entry.document.version).toBe(1);
      const serialized = JSON.stringify(entry.document);
      expect(serialized).not.toContain("react-studio-card");
    }
  });

  it("fails closed when the pack drifts from the pinned digest", () => {
    expect(() => verifyCmsStudioFixturePack(CMS_STUDIO_FIXTURE_PACK, "0".repeat(64))).toThrow(
      CmsStudioFixturePackError,
    );
    expect(() => verifyCmsStudioFixturePack(CMS_STUDIO_FIXTURE_PACK, "0".repeat(64))).toThrow(
      /digest mismatch/,
    );
  });

  it("changes the digest when any pinned content changes", () => {
    const tampered: CmsStudioFixturePack = {
      ...CMS_STUDIO_FIXTURE_PACK,
      content: CMS_STUDIO_FIXTURE_PACK.content.map((entry, index) =>
        index === 0 ? { ...entry, title: `${entry.title} (tampered)` } : entry,
      ),
    };
    expect(computeCmsStudioFixturePackDigest(tampered)).not.toBe(
      CMS_STUDIO_FIXTURE_PACK_DIGEST,
    );
  });

  it("encodes objects deterministically regardless of key order", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });
});
