import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, posts, contentTranslations, users, publications } from "@vibress/database";
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { TranslationService } from "../translation-service.js";

describe("Content Translations Runtime Multi-Publication Isolation", () => {
  const db = getDb();
  const service = new TranslationService();

  const runSuffix = Math.random().toString(36).substring(2, 8);
  const sharedSlug = `adversarial-shared-tr-${runSuffix}`;
  const alphaPostId = randomUUID();
  const betaPostId = randomUUID();
  let authorId: string;
  let alphaTrId: string;
  let betaTrId: string;

  beforeAll(async () => {
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

    const [user] = await db.select().from(users).limit(1);
    authorId = user?.id || randomUUID();
    const now = new Date();

    // Create post in pub_alpha
    await db.insert(posts).values({
      id: alphaPostId,
      publicationId: "pub_alpha",
      title: `Alpha Post ${runSuffix}`,
      slug: `alpha-post-${runSuffix}`,
      excerpt: "Alpha excerpt",
      content: { root: { type: "root", children: [] } },
      status: "published",
      visibility: "public",
      primaryAuthorId: authorId,
      createdBy: authorId,
      updatedBy: authorId,
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    // Create post in pub_beta
    await db.insert(posts).values({
      id: betaPostId,
      publicationId: "pub_beta",
      title: `Beta Post ${runSuffix}`,
      slug: `beta-post-${runSuffix}`,
      excerpt: "Beta excerpt",
      content: { root: { type: "root", children: [] } },
      status: "published",
      visibility: "public",
      primaryAuthorId: authorId,
      createdBy: authorId,
      updatedBy: authorId,
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    // Create translation under pub_alpha with shared slug
    const alphaTr = await service.upsertTranslation(
      {
        contentType: "post",
        contentId: alphaPostId,
        sourceLocale: "en",
        targetLocale: "ar-SA",
        title: `ترجمة ألفا ${runSuffix}`,
        slug: sharedSlug,
        excerpt: "ملخص ألفا",
        content: { body: "محتوى ألفا" },
        status: "draft",
      },
      "pub_alpha",
    );
    alphaTrId = alphaTr.id;

    // Create translation under pub_beta with IDENTICAL shared slug & locale
    const betaTr = await service.upsertTranslation(
      {
        contentType: "post",
        contentId: betaPostId,
        sourceLocale: "en",
        targetLocale: "ar-SA",
        title: `ترجمة بيتا ${runSuffix}`,
        slug: sharedSlug,
        excerpt: "ملخص بيتا",
        content: { body: "محتوى بيتا" },
        status: "draft",
      },
      "pub_beta",
    );
    betaTrId = betaTr.id;
  });

  afterAll(async () => {
    await db
      .delete(contentTranslations)
      .where(inArray(contentTranslations.id, [alphaTrId, betaTrId]));
    await db
      .delete(posts)
      .where(inArray(posts.id, [alphaPostId, betaPostId]));
  });

  it("coexists with identical targetLocale and slug across pub_alpha and pub_beta", () => {
    expect(alphaTrId).toBeDefined();
    expect(betaTrId).toBeDefined();
    expect(alphaTrId).not.toBe(betaTrId);
  });

  it("prevents cross-publication read via getTranslationById", async () => {
    // Reading alpha with alpha publicationId succeeds
    const alphaFromAlpha = await service.getTranslationById(alphaTrId, "pub_alpha");
    expect(alphaFromAlpha).not.toBeNull();
    expect(alphaFromAlpha?.title).toBe(`ترجمة ألفا ${runSuffix}`);

    // Adversarial: reading alpha with beta publicationId returns null
    const alphaFromBeta = await service.getTranslationById(alphaTrId, "pub_beta");
    expect(alphaFromBeta).toBeNull();
  });

  it("prevents cross-publication read via getTranslation", async () => {
    // Querying alpha contentId with pub_alpha succeeds
    const foundAlpha = await service.getTranslation("post", alphaPostId, "ar-SA", undefined, "pub_alpha");
    expect(foundAlpha).not.toBeNull();
    expect(foundAlpha?.id).toBe(alphaTrId);

    // Adversarial: querying alpha contentId with pub_beta returns null
    const crossFound = await service.getTranslation("post", alphaPostId, "ar-SA", undefined, "pub_beta");
    expect(crossFound).toBeNull();
  });

  it("resolves the correct publication translation when querying identical slug", async () => {
    const alphaRes = await service.findTranslationBySlug("post", "ar-SA", sharedSlug, "pub_alpha");
    const betaRes = await service.findTranslationBySlug("post", "ar-SA", sharedSlug, "pub_beta");

    expect(alphaRes?.id).toBe(alphaTrId);
    expect(alphaRes?.title).toBe(`ترجمة ألفا ${runSuffix}`);

    expect(betaRes?.id).toBe(betaTrId);
    expect(betaRes?.title).toBe(`ترجمة بيتا ${runSuffix}`);
  });

  it("adversarially rejects cross-publication editorial mutations", async () => {
    // Adversarial: pub_beta tries to submit alpha's translation for review
    const blockedSubmit = await service.submitForReview(alphaTrId, "pub_beta");
    expect(blockedSubmit).toBeNull();

    // Verify alpha is still in draft
    const alphaCheck = await service.getTranslationById(alphaTrId, "pub_alpha");
    expect(alphaCheck?.status).toBe("draft");

    // Legitimate submit by pub_alpha succeeds
    const validSubmit = await service.submitForReview(alphaTrId, "pub_alpha");
    expect(validSubmit?.status).toBe("needs_review");

    // Adversarial: pub_beta tries to approve alpha's translation
    const blockedApprove = await service.approveTranslation(alphaTrId, authorId, "pub_beta");
    expect(blockedApprove).toBeNull();

    // Adversarial: pub_beta tries bulk delete on alpha's translation
    const bulkResult = await service.bulkUpdateTranslations({
      translationIds: [alphaTrId],
      action: "delete",
      publicationId: "pub_beta",
    });
    expect(bulkResult.failed.length).toBe(1);
    expect(bulkResult.updatedCount).toBe(0);

    // Verify alpha translation still exists
    const stillExists = await service.getTranslationById(alphaTrId, "pub_alpha");
    expect(stillExists).not.toBeNull();
  });

  it("scopes translation matrices to the requested publication", async () => {
    const alphaMatrix = await service.getTranslationMatrix({
      publicationId: "pub_alpha",
    });
    const betaMatrix = await service.getTranslationMatrix({
      publicationId: "pub_beta",
    });

    const alphaIds = alphaMatrix.items.map((i) => i.id);
    const betaIds = betaMatrix.items.map((i) => i.id);

    expect(alphaIds).toContain(alphaPostId);
    expect(alphaIds).not.toContain(betaPostId);

    expect(betaIds).toContain(betaPostId);
    expect(betaIds).not.toContain(alphaPostId);
  });
});
