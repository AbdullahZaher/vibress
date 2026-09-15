import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { getDb, publications, newsletters } from "@vibress/database";
import { inArray } from "drizzle-orm";
import { DrizzleNewsletterRepository } from "../infrastructure/drizzle-newsletter-repositories";
import { NewslettersService, NewsletterDomainError } from "../application/newsletters-service";

describe("Newsletters Multi-Publication Isolation", () => {
  let newsletterRepo: DrizzleNewsletterRepository;
  let newslettersService: NewslettersService;

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
    await db.delete(newsletters).where(inArray(newsletters.publicationId, ["pub_alpha", "pub_beta"]));

    newsletterRepo = new DrizzleNewsletterRepository();
    newslettersService = new NewslettersService({
      newsletterRepo,
      preferenceRepo: {} as any,
      sendRepo: {} as any,
      audienceRepo: {} as any,
      isMemberSuppressed: async () => false,
      unsubscribeSecret: "test-secret",
      portalUrl: "http://localhost:3000",
    });
  });

  it("permits identical newsletter keys across distinct publications (Same-key requirement)", async () => {
    const pubA = "pub_alpha";
    const pubB = "pub_beta";
    const commonKey = "weekly-digest";

    const nlA = await newslettersService.createNewsletter(
      {
        key: commonKey,
        name: "Weekly Digest Alpha",
        senderName: "Alpha Editor",
        senderEmail: "news@alpha.com",
      },
      "staff_1",
      pubA,
    );

    const nlB = await newslettersService.createNewsletter(
      {
        key: commonKey,
        name: "Weekly Digest Beta",
        senderName: "Beta Editor",
        senderEmail: "news@beta.com",
      },
      "staff_2",
      pubB,
    );

    expect(nlA.publicationId).toBe(pubA);
    expect(nlB.publicationId).toBe(pubB);
    expect(nlA.key).toBe(commonKey);
    expect(nlB.key).toBe(commonKey);
    expect(nlA.id).not.toBe(nlB.id);

    const foundA = await newsletterRepo.findByKey(commonKey, pubA);
    const foundB = await newsletterRepo.findByKey(commonKey, pubB);

    expect(foundA?.id).toBe(nlA.id);
    expect(foundB?.id).toBe(nlB.id);
  });

  it("denies cross-publication newsletter read and update via non-disclosing 404", async () => {
    const pubA = "pub_alpha";
    const pubB = "pub_beta";

    const nlA = await newslettersService.createNewsletter(
      {
        key: "secret-bulletin",
        name: "Secret Bulletin",
        senderName: "Alpha Editor",
        senderEmail: "secret@alpha.com",
      },
      "staff_1",
      pubA,
    );

    // Read from B
    const readFromB = await newslettersService.getNewsletter(nlA.id, pubB);
    expect(readFromB).toBeNull();

    // Update from B -> 404
    await expect(
      newslettersService.updateNewsletter(nlA.id, { name: "Tampered" }, "attacker", pubB),
    ).rejects.toThrow(NewsletterDomainError);

    // Archive from B -> 404
    await expect(
      newslettersService.archiveNewsletter(nlA.id, "attacker", pubB),
    ).rejects.toThrow(NewsletterDomainError);

    const intactA = await newslettersService.getNewsletter(nlA.id, pubA);
    expect(intactA?.name).toBe("Secret Bulletin");
  });

  it("filters newsletter listings strictly by publication", async () => {
    const pubA = "pub_alpha";
    const pubB = "pub_beta";

    await newslettersService.createNewsletter(
      { key: "list-nl-a", name: "List A", senderName: "A", senderEmail: "a@a.com" },
      "staff",
      pubA,
    );
    await newslettersService.createNewsletter(
      { key: "list-nl-b", name: "List B", senderName: "B", senderEmail: "b@b.com" },
      "staff",
      pubB,
    );

    const listA = await newslettersService.listNewsletters({ publicationId: pubA });
    const listB = await newslettersService.listNewsletters({ publicationId: pubB });

    expect(listA.every((nl) => nl.publicationId === pubA)).toBe(true);
    expect(listB.every((nl) => nl.publicationId === pubB)).toBe(true);
  });
});
