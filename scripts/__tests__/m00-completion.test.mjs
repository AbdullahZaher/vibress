// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ARTIFACTS,
  TEST_SUITES,
  buildEvidenceIndex,
  validateEvidenceIndex,
} from "../platform/evidence/m00-evidence-index.mjs";
import { buildCompatibilityInventory, validateCompatibility } from "../platform/compatibility/compat-inventory.mjs";
import { buildCapabilityMatrix, validateCapabilityMatrix } from "../platform/capability/capability-matrix.mjs";
import { buildCmsCompatibilityManifest, validateCmsManifest } from "../platform/compatibility/cms-compatibility-manifest.mjs";
import { buildPgSecurityInventory, validateInventory as validatePg } from "../platform/security/pg-security-inventory.mjs";
import { repoRootFromModule } from "../platform/inventory/repository-inventory.mjs";

const root = repoRootFromModule();

describe("M00 completion evidence artifacts", () => {
  it("builds a cross-artifact evidence index with zero errors", () => {
    const index = buildEvidenceIndex(root);
    expect(validateEvidenceIndex(index, root)).toEqual([]);
    expect(index.artifacts).toHaveLength(ARTIFACTS.length);
    expect(index.testSuites).toHaveLength(TEST_SUITES.length);
    expect(index.testSuites.filter((suite) => suite.negativeCases).length).toBeGreaterThan(0);
  });

  it("rejects forged CI URLs and missing artifacts in the evidence index", () => {
    const index = buildEvidenceIndex(root);
    index.attribution.ciRunUrls.push("https://example.com/not-a-run");
    expect(validateEvidenceIndex(index, root)).toEqual(
      expect.arrayContaining([expect.stringContaining("bad CI run URL")]),
    );
    index.attribution.ciRunUrls.pop();
    index.artifacts[0].path = "does/not/exist.json";
    expect(validateEvidenceIndex(index, root)).toEqual(
      expect.arrayContaining([expect.stringContaining("missing artifact")]),
    );
  });

  it("records compatibility facts without publishing packages", () => {
    const inventory = buildCompatibilityInventory(root);
    expect(validateCompatibility(inventory)).toEqual([]);
    expect(inventory.packagesPublished).toBe(false);
    expect(inventory.failedChecks).toEqual([]);
    expect(inventory.policyStatus).toBe("UNCHANGED_PENDING_AUTHORIZED_OWNER_APPROVAL");
  });

  it("keeps every capability un-GA and records prohibited capabilities", () => {
    const matrix = buildCapabilityMatrix(root);
    expect(validateCapabilityMatrix(matrix)).toEqual([]);
    expect(matrix.capabilities.length).toBeGreaterThanOrEqual(18);
    expect(matrix.capabilities.every((capability) => capability.generallyAvailable === false)).toBe(true);
    expect(matrix.capabilities.some((c) => c.category === "UNSUPPORTED_PROHIBITED")).toBe(true);
  });

  it("binds twelve CMS/Studio compatibility dimensions to existing evidence", () => {
    const manifest = buildCmsCompatibilityManifest(root);
    expect(validateCmsManifest(manifest)).toEqual([]);
    expect(manifest.dimensions).toHaveLength(12);
    expect(manifest.fixturePack.pinnedDigestConstant).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a read-only PostgreSQL privilege inventory with open decisions", () => {
    const inventory = buildPgSecurityInventory(root);
    expect(validatePg(inventory)).toEqual([]);
    expect(inventory.databaseContacted).toBe(false);
    expect(inventory.grantsApplied).toBe(false);
    expect(inventory.requiredDecisions).toHaveLength(4);
    expect(inventory.roleConfigs).toHaveLength(3);
  });
});
