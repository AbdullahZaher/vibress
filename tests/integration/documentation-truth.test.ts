import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Documentation Truth & Product Claims Consistency Guard", () => {
  const rootDir = path.resolve(__dirname, "../../");

  it("verifies apps/web/package.json pins Next.js 15", () => {
    const webPkgPath = path.join(rootDir, "apps/web/package.json");
    const webPkg = JSON.parse(fs.readFileSync(webPkgPath, "utf-8"));
    expect(webPkg.dependencies.next).toMatch(/^\^?15\./);
  });

  it("verifies README.md reflects Next.js 15 SSR and no stale Next.js 14 references", () => {
    const readmePath = path.join(rootDir, "README.md");
    const readme = fs.readFileSync(readmePath, "utf-8");
    expect(readme).toContain("Next.js 15 SSR");
    expect(readme).not.toContain("Next.js 14 SSR");
  });

  it("verifies README.md declares trusted plugin architecture instead of disavowed VM sandboxing", () => {
    const readmePath = path.join(rootDir, "README.md");
    const readme = fs.readFileSync(readmePath, "utf-8");
    expect(readme).toContain("Trusted plugin architecture");
    expect(readme).not.toContain("Sandboxed plugin architecture");
  });

  it("verifies CONTRIBUTING.md does not claim microservices architecture", () => {
    const contribPath = path.join(rootDir, "CONTRIBUTING.md");
    const contrib = fs.readFileSync(contribPath, "utf-8");
    expect(contrib).not.toContain("Production Dockerfiles for all microservices");
    expect(contrib).toContain("Production Dockerfiles for all containerized application services");
  });

  it("verifies release notes and release report declare Next.js 15 SSR", () => {
    const relNotesPath = path.join(rootDir, "docs/release/V1.0.0_RELEASE_NOTES.md");
    const relNotes = fs.readFileSync(relNotesPath, "utf-8");
    expect(relNotes).toContain("Next.js 15 Server-Side Rendered (SSR)");
    expect(relNotes).not.toContain("Next.js 14 Server-Side Rendered (SSR)");

    const relReportPath = path.join(rootDir, "VIBRESS_V1.0.0_RELEASE_REPORT.md");
    const relReport = fs.readFileSync(relReportPath, "utf-8");
    expect(relReport).toContain("Next.js 15 SSR");
    expect(relReport).not.toContain("Next.js 14 SSR");
  });

  it("validates .github/whats-new.json schema and active announcements", () => {
    const whatsNewPath = path.join(rootDir, ".github/whats-new.json");
    const content = fs.readFileSync(whatsNewPath, "utf-8");
    const data = JSON.parse(content);

    expect(data).toHaveProperty("version");
    expect(typeof data.version).toBe("number");
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items.length).toBeGreaterThan(0);

    for (const item of data.items) {
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("description");
      expect(item).toHaveProperty("publishedAt");
      expect(item).toHaveProperty("minVersion");
      expect(typeof item.id).toBe("string");
      expect(typeof item.title).toBe("string");
      expect(typeof item.description).toBe("string");
      expect(typeof item.minVersion).toBe("string");
    }
  });

  it("verifies database migrations end at authoritative migration 0026", () => {
    const journalPath = path.join(
      rootDir,
      "packages/database/migrations/meta/_journal.json",
    );
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
    const lastEntry = journal.entries[journal.entries.length - 1];

    expect(lastEntry.idx).toBe(26);
    expect(lastEntry.tag).toBe("0026_multi_publication_tenant_isolation");

    // Assert no migration files beyond 0026 exist
    const migrationsDir = path.join(rootDir, "packages/database/migrations");
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
    for (const f of files) {
      const match = f.match(/^(\d{4})_/);
      if (match) {
        const num = parseInt(match[1], 10);
        expect(num).toBeLessThanOrEqual(26);
      }
    }
  });
});
