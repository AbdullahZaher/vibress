import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TranslationService } from "../translation-service";
import { getDb, contentTranslations, users } from "@vibress/database";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

describe("Phase 7: Multilingual Content & Translation Management", () => {
  const service = new TranslationService();
  const testUserId = randomUUID();
  const testPostId = randomUUID();

  beforeAll(async () => {
    const db = getDb();
    await db.insert(users).values({
      id: testUserId,
      email: `translator-${Date.now()}@example.com`,
      name: "Arabic Translator",
      passwordHash: "hash123",
    });
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(contentTranslations).where(eq(contentTranslations.contentId, testPostId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  it("creates and retrieves a translated post with localized metadata and slug", async () => {
    const tr = await service.upsertTranslation({
      contentType: "post",
      contentId: testPostId,
      sourceLocale: "en",
      targetLocale: "ar",
      title: "دليل فيبرس المتقدم",
      slug: "vibress-advanced-guide-ar",
      excerpt: "مقال شامل عن منصة فيبرس",
      content: { root: { children: [{ type: "p", text: "محتوى عربي كامل" }] } },
      metaTitle: "دليل فيبرس المتقدم | سيو",
      metaDescription: "وصف تعريفي للمقال بالعربية",
      status: "translated",
      assignedTranslatorId: testUserId,
      translationDueDate: new Date(Date.now() + 86400000),
    });

    expect(tr.id).toBeDefined();
    expect(tr.title).toBe("دليل فيبرس المتقدم");
    expect(tr.slug).toBe("vibress-advanced-guide-ar");
    expect(tr.targetLocale).toBe("ar");
    expect(tr.status).toBe("translated");
    expect(tr.assignedTranslatorId).toBe(testUserId);
    expect(tr.isStale).toBe(false);
  });

  it("detects stale translation when source content was updated after translation date", async () => {
    const newerSourceUpdateDate = new Date(Date.now());

    // Mark as stale when source update happens
    await service.markStaleIfSourceUpdated("post", testPostId, newerSourceUpdateDate);

    const check = await service.getTranslation("post", testPostId, "ar", newerSourceUpdateDate);
    expect(check).not.toBeNull();
    expect(check?.isStale).toBe(true);
    expect(check?.status).toBe("stale");
  });
});
