import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { getDb, publications, searchDocuments } from "@vibress/database";
import { inArray } from "drizzle-orm";
import { DrizzleSearchRepository } from "../infrastructure/drizzle-search-repository";
import { SearchService } from "../application/search-service";

describe("Search Multi-Publication Isolation", () => {
  let searchRepo: DrizzleSearchRepository;
  let searchService: SearchService;

  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(publications)
      .values([
        {
          id: "pub_alpha",
          workspaceId: "ws_default",
          name: "Alpha Pub",
          slug: "alpha",
          primaryLocale: "en",
        },
        {
          id: "pub_beta",
          workspaceId: "ws_default",
          name: "Beta Pub",
          slug: "beta",
          primaryLocale: "en",
        },
      ])
      .onConflictDoNothing();
  });

  beforeEach(async () => {
    const db = getDb();
    await db.delete(searchDocuments).where(inArray(searchDocuments.publicationId, ["pub_alpha", "pub_beta"]));

    searchRepo = new DrizzleSearchRepository();
    searchService = new SearchService(searchRepo);
  });

  it("proves search results are strictly isolated by publication", async () => {
    const pubA = "pub_alpha";
    const pubB = "pub_beta";

    // Index identical search term "Quantum Computing" in both publications
    await searchService.indexDocument(
      {
        entityType: "post",
        entityId: "post_a1",
        title: "Quantum Computing in Alpha",
        bodyText: "Alpha confidential quantum physics breakthroughs.",
        slug: "quantum-computing",
      },
      pubA,
    );

    await searchService.indexDocument(
      {
        entityType: "post",
        entityId: "post_b1",
        title: "Quantum Computing in Beta",
        bodyText: "Beta proprietary quantum research.",
        slug: "quantum-computing",
      },
      pubB,
    );

    // Search from pubA
    const resA = await searchService.search("Quantum", 10, 0, pubA);
    expect(resA.total).toBe(1);
    expect(resA.results[0]?.entityId).toBe("post_a1");
    expect(resA.results[0]?.title).toBe("Quantum Computing in Alpha");

    // Search from pubB
    const resB = await searchService.search("Quantum", 10, 0, pubB);
    expect(resB.total).toBe(1);
    expect(resB.results[0]?.entityId).toBe("post_b1");
    expect(resB.results[0]?.title).toBe("Quantum Computing in Beta");
  });

  it("proves search clear only clears documents of the target publication", async () => {
    const pubA = "pub_alpha";
    const pubB = "pub_beta";

    await searchService.indexDocument(
      {
        entityType: "post",
        entityId: "post_a2",
        title: "Alpha Tech Post",
        bodyText: "Alpha tech text",
      },
      pubA,
    );

    await searchService.indexDocument(
      {
        entityType: "post",
        entityId: "post_b2",
        title: "Beta Tech Post",
        bodyText: "Beta tech text",
      },
      pubB,
    );

    expect(await searchService.indexCount(pubA)).toBe(1);
    expect(await searchService.indexCount(pubB)).toBe(1);

    // Clear Pub A index
    await searchRepo.clear(pubA);

    // Pub A count is 0, but Pub B count remains intact!
    expect(await searchService.indexCount(pubA)).toBe(0);
    expect(await searchService.indexCount(pubB)).toBe(1);
  });
});
