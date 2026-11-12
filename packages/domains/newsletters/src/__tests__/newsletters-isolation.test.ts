import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import {
  getDb,
  publications,
  newsletters,
  newsletterSends,
} from "@vibress/database";
import { inArray } from "drizzle-orm";
import {
  DrizzleNewsletterRepository,
  DrizzleSendRepository,
} from "../infrastructure/drizzle-newsletter-repositories";
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
    await db
      .delete(newsletterSends)
      .where(inArray(newsletterSends.publicationId, ["pub_alpha", "pub_beta"]));
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

  it("scopes newsletter sends to their publication", async () => {
    const pubA = "pub_alpha";
    const pubB = "pub_beta";

    const nlA = await newslettersService.createNewsletter(
      {
        key: "send-scope",
        name: "Send Scope A",
        senderName: "A",
        senderEmail: "a@a.com",
      },
      "staff",
      pubA,
    );
    await newslettersService.createNewsletter(
      {
        key: "send-scope",
        name: "Send Scope B",
        senderName: "B",
        senderEmail: "b@b.com",
      },
      "staff",
      pubB,
    );

    const sendService = new NewslettersService({
      newsletterRepo,
      preferenceRepo: {} as any,
      sendRepo: new DrizzleSendRepository(),
      audienceRepo: {} as any,
      isMemberSuppressed: async () => false,
      unsubscribeSecret: "test-secret",
      portalUrl: "http://localhost:3000",
    });

    const send = await sendService.createSend(
      {
        publicationId: pubA,
        newsletterId: nlA.id,
        subject: "Alpha only",
        content: {
          schema: "vibress-studio",
          version: 1,
          root: { type: "root", children: [] },
        },
        senderName: "Alpha Editor",
        senderEmail: "news@alpha.com",
        audience: { filter: "all", productId: null, planId: null },
        status: "draft",
      },
      "staff",
    );
    expect(send.publicationId).toBe(pubA);

    // Cross-publication detail, cancellation, and listing are denied.
    expect(await sendService.getSend(send.id, pubB)).toBeNull();
    await expect(sendService.cancelSend(send.id, pubB)).rejects.toThrow(
      NewsletterDomainError,
    );
    const listB = await sendService.listSends({ publicationId: pubB });
    expect(listB.sends).toHaveLength(0);

    // The owning publication still sees and can cancel it.
    expect((await sendService.getSend(send.id, pubA))?.id).toBe(send.id);
    const cancelled = await sendService.cancelSend(send.id, pubA);
    expect(cancelled.status).toBe("cancelled");

    // A send cannot be created against another publication's newsletter.
    await expect(
      sendService.createSend(
        {
          publicationId: pubB,
          newsletterId: nlA.id,
          subject: "Cross-tenant",
          content: {
            schema: "vibress-studio",
            version: 1,
            root: { type: "root", children: [] },
          },
          senderName: "Beta Editor",
          senderEmail: "news@beta.com",
          audience: { filter: "all", productId: null, planId: null },
          status: "draft",
        },
        "staff",
      ),
    ).rejects.toThrow(NewsletterDomainError);
  });
});
