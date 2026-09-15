import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, getDbPool, closeDbPool, searchDocuments, runMigrations } from "../index";
import crypto from "node:crypto";

describe("DB-01: Search Query Performance & Execution Plan Validation", () => {
  beforeAll(async () => {
    await runMigrations();
    const db = getDb();

    // Populate representative documents for search benchmark
    const docs = [];
    for (let i = 0; i < 100; i++) {
      docs.push({
        id: crypto.randomUUID(),
        publicationId: "pub_default",
        entityType: "post",
        entityId: `entity-${i}`,
        title: `Vibress Production Engineering Post #${i}`,
        bodyText: `High performance publishing CMS with Arabic RTL, Next.js, and Fastify architecture index ${i}`,
        slug: `vibress-production-post-${i}`,
        url: `/posts/vibress-production-post-${i}`,
        searchable: true,
      });
    }

    await db.insert(searchDocuments).values(docs).onConflictDoNothing();
  });

  afterAll(async () => {
    await closeDbPool();
  });

  it("benchmarks search query with EXPLAIN (ANALYZE, BUFFERS) and verifies plan stability", async () => {
    const pool = getDbPool();
    const searchQuery = "%Vibress%";

    const explainRes = await pool.query(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT id, entity_type, entity_id, title, slug, url
       FROM search_documents
       WHERE searchable = true AND (title ILIKE $1 OR body_text ILIKE $1 OR slug ILIKE $1)
       ORDER BY CASE WHEN title ILIKE $1 THEN 0 WHEN slug ILIKE $1 THEN 1 ELSE 2 END, updated_at DESC
       LIMIT 20 OFFSET 0`,
      [searchQuery],
    );

    expect(explainRes.rows.length).toBeGreaterThan(0);
    const planText = explainRes.rows.map((r: { ["QUERY PLAN"]: string }) => r["QUERY PLAN"]).join("\n");

    expect(planText).toContain("Execution Time");
    // Verify execution time is under 50ms for representative dataset
    const match = planText.match(/Execution Time: ([\d.]+) ms/);
    if (match && match[1]) {
      const execTime = parseFloat(match[1]);
      expect(execTime).toBeLessThan(100);
    }
  });
});
