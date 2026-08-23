import { describe, it, expect, beforeAll } from "vitest";
import {
  TranslationService,
  validateTranslationStatusTransition,
} from "../translation-service";
import {
  getDb,
  posts,
  pages,
  users,
} from "@vibress/database";
import { randomUUID } from "crypto";

describe("Translation Management & Editorial Domain Service Suite", () => {
  const service = new TranslationService();
  const db = getDb();
  let authorId: string;

  const runSuffix = randomUUID().slice(0, 8);
  const testPostId = randomUUID();
  const testPageId = randomUUID();
  const testGroupId = randomUUID();
  const postSlug = `domain-test-post-${runSuffix}`;
  const pageSlug = `domain-test-page-${runSuffix}`;
  const arabicSlug = `manshur-ikhtibar-${runSuffix}`;

  beforeAll(async () => {
    const [user] = await db.select().from(users).limit(1);
    authorId = user?.id || randomUUID();

    const now = new Date();

    // Create a published test post
    await db.insert(posts).values({
      id: testPostId,
      title: `Domain Test Post ${runSuffix}`,
      slug: postSlug,
      excerpt: "Source excerpt",
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

    // Create a published test page
    await db.insert(pages).values({
      id: testPageId,
      title: `Domain Test Page ${runSuffix}`,
      slug: pageSlug,
      excerpt: "Source page excerpt",
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
  });

  describe("Status Transition Validation", () => {
    it("allows valid forward state transitions", () => {
      expect(validateTranslationStatusTransition("draft", "in_progress").valid).toBe(true);
      expect(validateTranslationStatusTransition("in_progress", "needs_review").valid).toBe(true);
      expect(validateTranslationStatusTransition("needs_review", "approved").valid).toBe(true);
      expect(validateTranslationStatusTransition("approved", "published").valid).toBe(true);
    });

    it("rejects invalid status transitions", () => {
      expect(validateTranslationStatusTransition("untranslated", "published").valid).toBe(false);
      expect(validateTranslationStatusTransition("draft", "approved").valid).toBe(false);
    });

    it("allows transitions into stale status when source changes", () => {
      expect(validateTranslationStatusTransition("published", "stale").valid).toBe(true);
      expect(validateTranslationStatusTransition("approved", "stale").valid).toBe(true);
    });
  });

  describe("Translation Lifecycle Operations", () => {
    let arabicTrId: string;

    it("creates an initial translation draft in 'draft' status", async () => {
      const created = await service.upsertTranslation({
        contentType: "post",
        contentId: testPostId,
        translationGroupId: testGroupId,
        sourceLocale: "en",
        targetLocale: "ar-SA",
        title: `منشور اختبار النطاق ${runSuffix}`,
        slug: arabicSlug,
        excerpt: "ملخص عربي",
        content: { root: { type: "root", children: [] } },
        status: "draft",
        translationProvider: "human",
      });

      expect(created.id).toBeDefined();
      expect(created.status).toBe("draft");
      expect(created.targetLocale).toBe("ar-SA");
      arabicTrId = created.id;
    });

    it("submits translation draft for editorial review", async () => {
      const submitted = await service.submitForReview(arabicTrId);
      expect(submitted).not.toBeNull();
      expect(submitted?.status).toBe("needs_review");
    });

    it("approves translation in review", async () => {
      const approved = await service.approveTranslation(arabicTrId, authorId);
      expect(approved).not.toBeNull();
      expect(approved?.status).toBe("approved");
      expect(approved?.reviewedBy).toBe(authorId);
      expect(approved?.reviewedAt).toBeDefined();
    });

    it("publishes approved translation", async () => {
      const published = await service.publishTranslation(arabicTrId);
      expect(published).not.toBeNull();
      expect(published?.status).toBe("published");
    });

    it("marks translation stale when source post is updated afterwards", async () => {
      // Simulate source post update in future
      const futureDate = new Date(Date.now() + 60000);
      await service.markStaleIfSourceUpdated("post", testPostId, futureDate);

      const refreshed = await service.getTranslationById(arabicTrId);
      expect(refreshed?.status).toBe("stale");
      expect(refreshed?.isStale).toBe(true);
    });
  });

  describe("Translation Matrix & Editorial Queue", () => {
    it("returns translation matrix containing post with Arabic stale status and French missing status", async () => {
      const matrix = await service.getTranslationMatrix(
        { contentType: "all", limit: 50 },
        ["en", "ar-SA", "fr-FR"],
        "en",
      );

      expect(matrix.total).toBeGreaterThan(0);
      const postItem = matrix.items.find((i) => i.id === testPostId);
      expect(postItem).toBeDefined();
      expect(postItem?.locales["en"]?.status).toBe("published");
      expect(postItem?.locales["ar-SA"]?.status).toBe("stale");
      expect(postItem?.locales["fr-FR"]?.status).toBe("untranslated");
    });

    it("returns prioritized translation queue items", async () => {
      const queue = await service.getTranslationQueue(["en", "ar-SA", "fr-FR"], "en");
      expect(queue.totalCount).toBeGreaterThan(0);

      // Stale queue should contain the stale Arabic translation
      const staleItem = queue.stale.find((s) => s.contentId === testPostId && s.targetLocale === "ar-SA");
      expect(staleItem).toBeDefined();
      expect(staleItem?.reason).toBe("stale_published");

      // Missing queue should contain French translation for published post/page
      const missingItem = queue.missing.find((m) => m.contentId === testPostId && m.targetLocale === "fr-FR");
      expect(missingItem).toBeDefined();
      expect(missingItem?.reason).toBe("missing");
    });

    it("calculates publication localization health metrics accurately", async () => {
      const health = await service.getLocalizationHealth(["en", "ar-SA", "fr-FR"], "en");
      expect(health.totalSourceItems).toBeGreaterThan(0);
      expect(health.byLocale["en"]).toBeDefined();
      expect(health.byLocale["ar-SA"]).toBeDefined();
      expect(health.byLocale["fr-FR"]).toBeDefined();
      expect(health.byLocale["ar-SA"]?.stale).toBeGreaterThan(0);
      expect(health.byLocale["fr-FR"]?.missing).toBeGreaterThan(0);
    });
  });

  describe("Bulk Operations", () => {
    it("executes bulk status updates on multiple translations safely", async () => {
      const tr2 = await service.upsertTranslation({
        contentType: "page",
        contentId: testPageId,
        targetLocale: "ar-SA",
        title: `صفحة اختبار النطاق ${runSuffix}`,
        slug: `safhat-ikhtibar-${runSuffix}`,
        status: "draft",
      });

      const bulkResult = await service.bulkUpdateTranslations({
        translationIds: [tr2.id],
        action: "submit_review",
      });

      expect(bulkResult.updatedCount).toBe(1);
      expect(bulkResult.errors.length).toBe(0);

      const tr2Refreshed = await service.getTranslationById(tr2.id);
      expect(tr2Refreshed?.status).toBe("needs_review");
    });
  });
});
