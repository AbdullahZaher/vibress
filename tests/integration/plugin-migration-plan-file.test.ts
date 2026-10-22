import { describe, expect, it } from "vitest";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readBoundedOperatorMigrationPlanFile } from "../../scripts/plugins/read-verified-migration-plan";

async function withTemporaryPlan(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "vibress-plan-check-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("signed physical migration plan file admission", () => {
  it("reads bounded regular plan JSON through a pinned descriptor", async () => {
    await withTemporaryPlan(async (root) => {
      const filename = path.join(root, "plan.json");
      await writeFile(filename, '{"manifestId":"approved-plugin"}');
      expect(await readBoundedOperatorMigrationPlanFile(filename)).toEqual({
        manifestId: "approved-plugin",
      });
    });
  });
  it("fails closed on a last-component symlink", async () => {
    await withTemporaryPlan(async (root) => {
      const real = path.join(root, "real.json");
      const link = path.join(root, "alias.json");
      await writeFile(real, '{"manifestId":"approved-plugin"}');
      await symlink(real, link);
      await expect(readBoundedOperatorMigrationPlanFile(link)).rejects.toThrow();
    });
  });
  it("rejects oversized, empty, corrupt UTF-8, NUL and non-JSON files", async () => {
    await withTemporaryPlan(async (root) => {
      const filename = path.join(root, "plan.json");
      for (const content of ["", "x".repeat(65537), Buffer.from([0xff, 0xfe]),
        '{"manifestId":"bad\u0000value"}', "not json"]) {
        await writeFile(filename, content);
        await expect(readBoundedOperatorMigrationPlanFile(filename)).rejects.toThrow();
      }
    });
  });
  it("rejects relative path input before opening any file", async () => {
    await expect(readBoundedOperatorMigrationPlanFile("./plan.json")).rejects.toThrow();
  });
});
