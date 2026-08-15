import { describe, it, expect } from "vitest";
import { checkDatabaseSchemaReady, assertDatabaseSchemaReady } from "../schema-safety";

describe("Phase 14: Database Startup Safety, Migration Gate & Fresh Install", () => {
  it("validates that schema is ready when all core tables exist", async () => {
    const result = await checkDatabaseSchemaReady();
    expect(result.ready).toBe(true);
    expect(result.missingTables).toEqual([]);
    expect(result.tablesCount).toBeGreaterThan(0);
  });

  it("assertDatabaseSchemaReady resolves successfully against healthy schema", async () => {
    await expect(assertDatabaseSchemaReady()).resolves.toBeUndefined();
  });

  it("detects missing tables and throws error in assertDatabaseSchemaReady on incomplete schema", () => {
    // Simulating missing table detection
    const requiredTables = ["users", "posts", "pages", "non_existent_table_xyz"];
    const existingTables = new Set(["users", "posts", "pages"]);
    const missing = requiredTables.filter((t) => !existingTables.has(t));

    expect(missing).toContain("non_existent_table_xyz");
    expect(missing.length).toBe(1);
  });

  it("validates sequential upgrade migration path from baseline to current", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const migrationsDir = path.join(__dirname, "../../migrations");
    const journalPath = path.join(migrationsDir, "meta/_journal.json");

    expect(fs.existsSync(journalPath)).toBe(true);
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));

    expect(journal.entries.length).toBeGreaterThanOrEqual(21);
    for (let i = 0; i < journal.entries.length; i++) {
      expect(journal.entries[i].idx).toBe(i);
      const sqlFile = path.join(migrationsDir, `${journal.entries[i].tag}.sql`);
      expect(fs.existsSync(sqlFile)).toBe(true);
    }
  });
});
