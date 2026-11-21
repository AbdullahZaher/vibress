// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  INVENTORY_RELATIVE_PATH,
  buildInventory,
  readCommittedInventory,
  repoRootFromModule,
  validateInventory,
} from "../platform/inventory/repository-inventory.mjs";

const repoRoot = repoRootFromModule();
const committed = readCommittedInventory(repoRoot);
const generated = buildInventory(repoRoot);

function countWorkspaceDirs(directory) {
  const base = `${repoRoot}/${directory}`;
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(`${base}/${entry.name}/package.json`))
    .length;
}

describe("deterministic repository inventory (M00-E01)", () => {
  it("is deterministic across independent builds", () => {
    expect(JSON.stringify(buildInventory(repoRoot))).toBe(JSON.stringify(buildInventory(repoRoot)));
  });

  it("validates the committed artifact with zero errors", () => {
    expect(validateInventory(committed).errors).toEqual([]);
    expect(JSON.stringify(committed)).toBe(JSON.stringify(generated));
  });

  it("counts every application and package from the workspace", () => {
    expect(generated.summary.applications).toBe(countWorkspaceDirs("apps"));
    expect(generated.summary.packages).toBe(
      countWorkspaceDirs("packages") + countWorkspaceDirs("packages/domains"),
    );
    expect(generated.summary.applications).toBeGreaterThan(0);
    expect(generated.summary.packages).toBeGreaterThan(0);
  });

  it("records the established dependency boundaries", () => {
    expect(generated.dependencyBoundaries.violations).toEqual([]);
    const kernel = generated.packages.find((pkg) => pkg.packageName === "@vibress/platform-kernel");
    const tenancy = generated.packages.find((pkg) => pkg.packageName === "@vibress/tenancy");
    expect(kernel.dependencies).toEqual([]);
    expect(tenancy.dependencies).toEqual(["@vibress/platform-kernel"]);
  });

  it("keeps migration journal and SQL files consistent", () => {
    expect(generated.migrations.count).toBe(generated.migrations.journalEntries);
    expect(generated.migrations.journalFileMissingTags).toEqual([]);
    expect(generated.migrations.journalFileExtraTags).toEqual([]);
    expect(generated.migrations.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("records real least-privilege roles, workers and the Epic ledger", () => {
    expect(generated.databaseRoles.length).toBeGreaterThanOrEqual(3);
    expect(generated.workers.processors.length).toBeGreaterThan(0);
    expect(generated.workers.queues.length).toBeGreaterThan(0);
    expect(generated.implementationEvidence.epicLedger.epics).toBe(140);
    expect(generated.implementationEvidence.epicLedger.formallyClosed).toBe(0);
  });

  it("contains no machine-specific paths or invented progress metrics", () => {
    const text = JSON.stringify(generated);
    expect(text).not.toContain(repoRoot);
    expect(text).not.toMatch(/percent|burndown/i);
    expect(fs.readFileSync(`${repoRoot}/${INVENTORY_RELATIVE_PATH}`, "utf8")).not.toContain(repoRoot);
  });
});
