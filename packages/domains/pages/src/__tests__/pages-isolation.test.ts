import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { getDb, publications, users } from "@vibress/database";
import { DrizzlePageRepository } from "../infrastructure/drizzle-page-repository";
import { PagesService } from "../application/pages-service";
import { PageDomainError } from "../domain/page";

describe("Pages Multi-Publication Isolation", () => {
  let pageRepo: DrizzlePageRepository;
  let pagesService: PagesService;
  let testUserId: string;

  // Mock dependent services
  const mockRevisionService = {
    createRevision: async () => {},
  } as any;

  const mockAuthorRepo = {
    setPageAuthors: async () => {},
  } as any;

  const mockAuditRepo = {
    record: async () => {},
  } as any;

  beforeAll(async () => {
    const db = getDb();
    // Ensure pub_alpha and pub_beta exist
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

    const userRows = await db.select().from(users).limit(1);
    testUserId = userRows[0]!.id;
  });

  beforeEach(() => {
    pageRepo = new DrizzlePageRepository();
    pagesService = new PagesService(
      pageRepo,
      mockRevisionService,
      mockAuthorRepo,
      mockAuditRepo,
    );
  });

  it("permits identical slugs across distinct publications (Same-slug requirement)", async () => {
    const pubA = "pub_alpha";
    const pubB = "pub_beta";
    const commonSlug = "about-us";

    const pageA = await pagesService.createPage(
      {
        title: "About Us - Pub A",
        slug: commonSlug,
        primaryAuthorId: testUserId,
      },
      testUserId,
      pubA,
    );

    const pageB = await pagesService.createPage(
      {
        title: "About Us - Pub B",
        slug: commonSlug,
        primaryAuthorId: testUserId,
      },
      testUserId,
      pubB,
    );

    expect(pageA.publicationId).toBe(pubA);
    expect(pageB.publicationId).toBe(pubB);
    expect(pageA.slug).toBe(commonSlug);
    expect(pageB.slug).toBe(commonSlug);
    expect(pageA.id).not.toBe(pageB.id);

    // Each publication resolves its own page by slug
    const resolvedA = await pagesService.findBySlug(commonSlug, pubA);
    const resolvedB = await pagesService.findBySlug(commonSlug, pubB);

    expect(resolvedA?.id).toBe(pageA.id);
    expect(resolvedB?.id).toBe(pageB.id);
  });

  it("denies cross-publication read via non-disclosing null/404", async () => {
    const pubA = "pub_alpha";
    const pubB = "pub_beta";

    const pageA = await pagesService.createPage(
      {
        title: "Secret Page",
        primaryAuthorId: testUserId,
      },
      testUserId,
      pubA,
    );

    // Searching from pubB returns null / non-disclosing 404
    const accessedFromB = await pagesService.findById(pageA.id, pubB);
    expect(accessedFromB).toBeNull();
  });

  it("denies cross-publication mutation and deletion", async () => {
    const pubA = "pub_alpha";
    const pubB = "pub_beta";

    const pageA = await pagesService.createPage(
      {
        title: "Protected Page",
        primaryAuthorId: testUserId,
      },
      testUserId,
      pubA,
    );

    // Pub B attempts to update Pub A's page -> throws PAGE_NOT_FOUND (non-disclosing)
    await expect(
      pagesService.updatePage(
        pageA.id,
        { title: "Hacked" },
        testUserId,
        pubB,
      ),
    ).rejects.toThrow(PageDomainError);

    // Pub B attempts to delete Pub A's page -> throws PAGE_NOT_FOUND (non-disclosing)
    await expect(
      pagesService.deletePage(pageA.id, testUserId, pubB),
    ).rejects.toThrow(PageDomainError);

    // Pub A page remains intact
    const intactA = await pagesService.findById(pageA.id, pubA);
    expect(intactA?.title).toBe("Protected Page");
  });

  it("filters list queries strictly by publication", async () => {
    const pubA = "pub_alpha";
    const pubB = "pub_beta";

    await pagesService.createPage(
      { title: "List Test A", primaryAuthorId: testUserId },
      testUserId,
      pubA,
    );
    await pagesService.createPage(
      { title: "List Test B", primaryAuthorId: testUserId },
      testUserId,
      pubB,
    );

    const listA = await pagesService.listPages({ publicationId: pubA });
    const listB = await pagesService.listPages({ publicationId: pubB });

    expect(listA.pages.every((p) => p.publicationId === pubA)).toBe(true);
    expect(listB.pages.every((p) => p.publicationId === pubB)).toBe(true);
    expect(listA.pages.some((p) => p.publicationId === pubB)).toBe(false);
    expect(listB.pages.some((p) => p.publicationId === pubA)).toBe(false);
  });
});
