import {
  getDb,
  contentTranslations,
  ContentTranslationRow,
  posts,
  pages,
} from "@vibress/database";
import { eq, and, desc, inArray, or, ilike, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  TranslationStatus,
  validateTranslationStatusTransition,
  UpsertTranslationInput,
  ContentTranslationItem,
  TranslationLocaleStatus,
  TranslationMatrixItem,
  TranslationMatrixFilter,
  TranslationQueueItem,
  LocalizationHealthMetrics,
  FieldLevelSourceDiff,
  BulkTranslationResult,
} from "./translation-types";

export * from "./translation-types";

export class TranslationService {
  async getTranslationById(id: string): Promise<ContentTranslationItem | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(contentTranslations)
      .where(eq(contentTranslations.id, id))
      .limit(1);

    if (!rows[0]) return null;
    const r = rows[0];

    let fieldDiff: FieldLevelSourceDiff | undefined;
    const sourceUpdated = r.sourceUpdatedAtTranslation ?? new Date();

    if (r.contentType === "post") {
      const srcRows = await db.select().from(posts).where(eq(posts.id, r.contentId)).limit(1);
      if (srcRows[0] && r.sourceUpdatedAtTranslation) {
        if (srcRows[0].updatedAt.getTime() > r.sourceUpdatedAtTranslation.getTime()) {
          const changed: string[] = ["title", "body"];
          if (srcRows[0].excerpt) changed.push("excerpt");
          if (srcRows[0].metaTitle) changed.push("metaTitle");
          if (srcRows[0].metaDescription) changed.push("metaDescription");
          fieldDiff = {
            hasChanges: true,
            titleChanged: true,
            slugChanged: false,
            excerptChanged: Boolean(srcRows[0].excerpt),
            contentChanged: true,
            metaTitleChanged: Boolean(srcRows[0].metaTitle),
            metaDescriptionChanged: Boolean(srcRows[0].metaDescription),
            changedFields: changed,
          };
        }
      }
    } else if (r.contentType === "page") {
      const srcRows = await db.select().from(pages).where(eq(pages.id, r.contentId)).limit(1);
      if (srcRows[0] && r.sourceUpdatedAtTranslation) {
        if (srcRows[0].updatedAt.getTime() > r.sourceUpdatedAtTranslation.getTime()) {
          const changed: string[] = ["title", "body"];
          if (srcRows[0].excerpt) changed.push("excerpt");
          fieldDiff = {
            hasChanges: true,
            titleChanged: true,
            slugChanged: false,
            excerptChanged: Boolean(srcRows[0].excerpt),
            contentChanged: true,
            metaTitleChanged: false,
            metaDescriptionChanged: false,
            changedFields: changed,
          };
        }
      }
    }

    return {
      id: r.id,
      translationGroupId: r.translationGroupId,
      contentType: r.contentType,
      contentId: r.contentId,
      sourceLocale: r.sourceLocale,
      targetLocale: r.targetLocale,
      title: r.title,
      slug: r.slug,
      excerpt: r.excerpt,
      content: (r.content as Record<string, unknown>) || {},
      metaTitle: r.metaTitle,
      metaDescription: r.metaDescription,
      status: r.status as TranslationStatus,
      translationProvider: r.translationProvider,
      assignedTranslatorId: r.assignedTranslatorId,
      translationDueDate: r.translationDueDate,
      sourceVersionAtTranslation: r.sourceVersionAtTranslation ?? 1,
      sourceUpdatedAtTranslation: sourceUpdated,
      isStale: r.status === "stale",
      fieldDiff,
      translatedAt: r.translatedAt,
      reviewedAt: r.reviewedAt,
      reviewedBy: r.reviewedBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async getTranslation(
    contentType: string,
    contentId: string,
    targetLocale: string,
    currentSourceUpdatedAt?: Date,
  ): Promise<ContentTranslationItem | null> {
    const db = getDb();
    let rows = await db
      .select()
      .from(contentTranslations)
      .where(
        and(
          eq(contentTranslations.contentType, contentType),
          eq(contentTranslations.contentId, contentId),
          eq(contentTranslations.targetLocale, targetLocale),
        ),
      )
      .limit(1);

    // Fallback: match by base language if regional variant was requested/stored (e.g. ar <-> ar-SA)
    if (!rows[0]) {
      const baseLang = targetLocale.split("-")[0] || targetLocale;
      const allRows = await db
        .select()
        .from(contentTranslations)
        .where(
          and(
            eq(contentTranslations.contentType, contentType),
            eq(contentTranslations.contentId, contentId),
          ),
        );
      const match = allRows.find(
        (r) =>
          r.targetLocale === targetLocale ||
          r.targetLocale.split("-")[0] === baseLang,
      );
      if (match) {
        rows = [match];
      }
    }

    if (!rows[0]) return null;
    const r = rows[0];
    const isStale =
      r.status === "stale" ||
      (currentSourceUpdatedAt && r.translatedAt
        ? currentSourceUpdatedAt.getTime() > r.translatedAt.getTime()
        : false);

    return {
      id: r.id,
      translationGroupId: r.translationGroupId,
      contentType: r.contentType,
      contentId: r.contentId,
      sourceLocale: r.sourceLocale,
      targetLocale: r.targetLocale,
      title: r.title,
      slug: r.slug,
      excerpt: r.excerpt,
      content: (r.content as Record<string, unknown>) || {},
      metaTitle: r.metaTitle,
      metaDescription: r.metaDescription,
      status: isStale ? "stale" : (r.status as TranslationStatus),
      translationProvider: r.translationProvider,
      assignedTranslatorId: r.assignedTranslatorId,
      translationDueDate: r.translationDueDate,
      sourceVersionAtTranslation: r.sourceVersionAtTranslation ?? 1,
      sourceUpdatedAtTranslation: r.sourceUpdatedAtTranslation ?? new Date(),
      isStale: Boolean(isStale),
      translatedAt: r.translatedAt,
      reviewedAt: r.reviewedAt,
      reviewedBy: r.reviewedBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async findTranslationBySlug(
    contentType: string,
    targetLocale: string,
    slug: string,
  ): Promise<ContentTranslationItem | null> {
    const db = getDb();
    let rows = await db
      .select()
      .from(contentTranslations)
      .where(
        and(
          eq(contentTranslations.contentType, contentType),
          eq(contentTranslations.targetLocale, targetLocale),
          eq(contentTranslations.slug, slug),
        ),
      )
      .limit(1);

    // Fallback: match by base language if regional variant was requested/stored
    if (!rows[0]) {
      const baseLang = targetLocale.split("-")[0] || targetLocale;
      const allRows = await db
        .select()
        .from(contentTranslations)
        .where(
          and(
            eq(contentTranslations.contentType, contentType),
            eq(contentTranslations.slug, slug),
          ),
        );
      const match = allRows.find(
        (r) =>
          r.targetLocale === targetLocale ||
          r.targetLocale.split("-")[0] === baseLang,
      );
      if (match) {
        rows = [match];
      }
    }

    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      translationGroupId: r.translationGroupId,
      contentType: r.contentType,
      contentId: r.contentId,
      sourceLocale: r.sourceLocale,
      targetLocale: r.targetLocale,
      title: r.title,
      slug: r.slug,
      excerpt: r.excerpt,
      content: (r.content as Record<string, unknown>) || {},
      metaTitle: r.metaTitle,
      metaDescription: r.metaDescription,
      status: r.status as TranslationStatus,
      translationProvider: r.translationProvider,
      assignedTranslatorId: r.assignedTranslatorId,
      translationDueDate: r.translationDueDate,
      sourceVersionAtTranslation: r.sourceVersionAtTranslation ?? 1,
      sourceUpdatedAtTranslation: r.sourceUpdatedAtTranslation ?? new Date(),
      isStale: r.status === "stale",
      translatedAt: r.translatedAt,
      reviewedAt: r.reviewedAt,
      reviewedBy: r.reviewedBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async findTranslationBySlugAny(
    contentType: string,
    slug: string,
  ): Promise<ContentTranslationItem | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(contentTranslations)
      .where(
        and(
          eq(contentTranslations.contentType, contentType),
          eq(contentTranslations.slug, slug),
        ),
      )
      .limit(1);

    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      translationGroupId: r.translationGroupId,
      contentType: r.contentType,
      contentId: r.contentId,
      sourceLocale: r.sourceLocale,
      targetLocale: r.targetLocale,
      title: r.title,
      slug: r.slug,
      excerpt: r.excerpt,
      content: (r.content as Record<string, unknown>) || {},
      metaTitle: r.metaTitle,
      metaDescription: r.metaDescription,
      status: r.status as TranslationStatus,
      translationProvider: r.translationProvider,
      assignedTranslatorId: r.assignedTranslatorId,
      translationDueDate: r.translationDueDate,
      sourceVersionAtTranslation: r.sourceVersionAtTranslation ?? 1,
      sourceUpdatedAtTranslation: r.sourceUpdatedAtTranslation ?? new Date(),
      isStale: r.status === "stale",
      translatedAt: r.translatedAt,
      reviewedAt: r.reviewedAt,
      reviewedBy: r.reviewedBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async getContentTranslationStats(contentType = "post"): Promise<{
    totalTranslated: number;
    published: number;
    stale: number;
    draft: number;
    needsReview: number;
    byLocale: Record<string, { count: number; stale: number; published: number }>;
  }> {
    const db = getDb();
    const rows = await db
      .select()
      .from(contentTranslations)
      .where(eq(contentTranslations.contentType, contentType));

    let published = 0;
    let stale = 0;
    let draft = 0;
    let needsReview = 0;
    const byLocale: Record<string, { count: number; stale: number; published: number }> = {};

    for (const r of rows) {
      if (r.status === "published") published++;
      if (r.status === "stale") stale++;
      if (r.status === "draft") draft++;
      if (r.status === "needs_review") needsReview++;

      if (!byLocale[r.targetLocale]) {
        byLocale[r.targetLocale] = { count: 0, stale: 0, published: 0 };
      }
      byLocale[r.targetLocale]!.count++;
      if (r.status === "stale") byLocale[r.targetLocale]!.stale++;
      if (r.status === "published") byLocale[r.targetLocale]!.published++;
    }

    return {
      totalTranslated: rows.length,
      published,
      stale,
      draft,
      needsReview,
      byLocale,
    };
  }

  async listTranslationsForContent(
    contentType: string,
    contentId: string,
  ): Promise<ContentTranslationItem[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(contentTranslations)
      .where(
        and(
          eq(contentTranslations.contentType, contentType),
          eq(contentTranslations.contentId, contentId),
        ),
      )
      .orderBy(desc(contentTranslations.updatedAt));

    return rows.map((r: ContentTranslationRow) => ({
      id: r.id,
      translationGroupId: r.translationGroupId,
      contentType: r.contentType,
      contentId: r.contentId,
      sourceLocale: r.sourceLocale,
      targetLocale: r.targetLocale,
      title: r.title,
      slug: r.slug,
      excerpt: r.excerpt,
      content: (r.content as Record<string, unknown>) || {},
      metaTitle: r.metaTitle,
      metaDescription: r.metaDescription,
      status: r.status as TranslationStatus,
      translationProvider: r.translationProvider,
      assignedTranslatorId: r.assignedTranslatorId,
      translationDueDate: r.translationDueDate,
      sourceVersionAtTranslation: r.sourceVersionAtTranslation ?? 1,
      sourceUpdatedAtTranslation: r.sourceUpdatedAtTranslation ?? new Date(),
      isStale: r.status === "stale",
      translatedAt: r.translatedAt,
      reviewedAt: r.reviewedAt,
      reviewedBy: r.reviewedBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async listTranslationsByGroup(
    translationGroupId: string,
  ): Promise<ContentTranslationItem[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(contentTranslations)
      .where(eq(contentTranslations.translationGroupId, translationGroupId))
      .orderBy(desc(contentTranslations.updatedAt));

    return rows.map((r: ContentTranslationRow) => ({
      id: r.id,
      translationGroupId: r.translationGroupId,
      contentType: r.contentType,
      contentId: r.contentId,
      sourceLocale: r.sourceLocale,
      targetLocale: r.targetLocale,
      title: r.title,
      slug: r.slug,
      excerpt: r.excerpt,
      content: (r.content as Record<string, unknown>) || {},
      metaTitle: r.metaTitle,
      metaDescription: r.metaDescription,
      status: r.status as TranslationStatus,
      translationProvider: r.translationProvider,
      assignedTranslatorId: r.assignedTranslatorId,
      translationDueDate: r.translationDueDate,
      sourceVersionAtTranslation: r.sourceVersionAtTranslation ?? 1,
      sourceUpdatedAtTranslation: r.sourceUpdatedAtTranslation ?? new Date(),
      isStale: r.status === "stale",
      translatedAt: r.translatedAt,
      reviewedAt: r.reviewedAt,
      reviewedBy: r.reviewedBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async upsertTranslation(
    input: UpsertTranslationInput,
  ): Promise<ContentTranslationItem> {
    const db = getDb();
    const existing = await this.getTranslation(
      input.contentType,
      input.contentId,
      input.targetLocale,
    );

    const now = new Date();
    const status = input.status || (input.content ? "translated" : "in_progress");

    if (existing) {
      await db
        .update(contentTranslations)
        .set({
          translationGroupId: input.translationGroupId ?? existing.translationGroupId,
          title: input.title,
          slug: input.slug,
          excerpt: input.excerpt ?? null,
          content: input.content || {},
          metaTitle: input.metaTitle ?? null,
          metaDescription: input.metaDescription ?? null,
          status,
          translationProvider: input.translationProvider ?? existing.translationProvider,
          assignedTranslatorId: input.assignedTranslatorId ?? existing.assignedTranslatorId,
          translationDueDate: input.translationDueDate ?? existing.translationDueDate,
          sourceVersionAtTranslation: input.sourceVersion ?? 1,
          sourceUpdatedAtTranslation: input.sourceUpdatedAt ?? now,
          translatedAt:
            status === "translated" || status === "published" || status === "approved" || status === "needs_review"
              ? (existing.translatedAt || now)
              : existing.translatedAt,
          updatedAt: now,
        })
        .where(eq(contentTranslations.id, existing.id));

      const updated = await this.getTranslation(
        input.contentType,
        input.contentId,
        input.targetLocale,
      );
      return updated!;
    }

    const id = randomUUID();
    await db.insert(contentTranslations).values({
      id,
      translationGroupId: input.translationGroupId ?? null,
      contentType: input.contentType,
      contentId: input.contentId,
      sourceLocale: input.sourceLocale || "en",
      targetLocale: input.targetLocale,
      title: input.title,
      slug: input.slug,
      excerpt: input.excerpt ?? null,
      content: input.content || {},
      metaTitle: input.metaTitle ?? null,
      metaDescription: input.metaDescription ?? null,
      status,
      translationProvider: input.translationProvider ?? "human",
      assignedTranslatorId: input.assignedTranslatorId ?? null,
      translationDueDate: input.translationDueDate ?? null,
      sourceVersionAtTranslation: input.sourceVersion ?? 1,
      sourceUpdatedAtTranslation: input.sourceUpdatedAt ?? now,
      translatedAt:
        status === "translated" || status === "published" || status === "approved" || status === "needs_review"
          ? now
          : null,
      reviewedAt: status === "approved" || status === "published" ? now : null,
      reviewedBy: null,
      createdAt: now,
      updatedAt: now,
    });

    const created = await this.getTranslation(
      input.contentType,
      input.contentId,
      input.targetLocale,
    );
    return created!;
  }

  async submitForReview(id: string): Promise<ContentTranslationItem | null> {
    const db = getDb();
    const existing = await this.getTranslationById(id);
    if (!existing) return null;

    const transition = validateTranslationStatusTransition(existing.status, "needs_review");
    if (!transition.valid) {
      throw new Error(transition.reason);
    }

    const now = new Date();
    await db
      .update(contentTranslations)
      .set({
        status: "needs_review",
        translatedAt: existing.translatedAt || now,
        updatedAt: now,
      })
      .where(eq(contentTranslations.id, id));

    return await this.getTranslationById(id);
  }

  async approveTranslation(
    id: string,
    reviewerId: string,
  ): Promise<ContentTranslationItem | null> {
    const db = getDb();
    const existing = await this.getTranslationById(id);
    if (!existing) return null;

    const transition = validateTranslationStatusTransition(existing.status, "approved");
    if (!transition.valid) {
      throw new Error(transition.reason);
    }

    const now = new Date();
    await db
      .update(contentTranslations)
      .set({
        status: "approved",
        translatedAt: existing.translatedAt || now,
        reviewedAt: now,
        reviewedBy: reviewerId,
        updatedAt: now,
      })
      .where(eq(contentTranslations.id, id));

    return await this.getTranslationById(id);
  }

  async publishTranslation(id: string): Promise<ContentTranslationItem | null> {
    const db = getDb();
    const existing = await this.getTranslationById(id);
    if (!existing) return null;

    const transition = validateTranslationStatusTransition(existing.status, "published");
    if (!transition.valid) {
      throw new Error(transition.reason);
    }

    const now = new Date();
    await db
      .update(contentTranslations)
      .set({
        status: "published",
        translatedAt: existing.translatedAt || now,
        updatedAt: now,
      })
      .where(eq(contentTranslations.id, id));

    return await this.getTranslationById(id);
  }

  async markStaleIfSourceUpdated(
    contentType: string,
    contentId: string,
    sourceUpdatedAt: Date,
  ): Promise<void> {
    const translations = await this.listTranslationsForContent(contentType, contentId);
    const db = getDb();
    for (const tr of translations) {
      const translationReferenceTime = tr.translatedAt || tr.updatedAt || tr.createdAt;
      if (translationReferenceTime && sourceUpdatedAt.getTime() > translationReferenceTime.getTime()) {
        await db
          .update(contentTranslations)
          .set({ status: "stale", updatedAt: new Date() })
          .where(eq(contentTranslations.id, tr.id));
      }
    }
  }

  /**
   * High-performance batched translation matrix query.
   */
  async getTranslationMatrix(
    filter: TranslationMatrixFilter = {},
    enabledLocales: string[] = ["en", "ar-SA"],
    defaultLocale = "en",
  ): Promise<{ items: TranslationMatrixItem[]; total: number }> {
    const db = getDb();
    const limit = filter.limit ?? 20;
    const offset = filter.offset ?? 0;

    type RawContentItem = {
      id: string;
      title: string;
      slug: string;
      contentType: "post" | "page";
      status: string;
      updatedAt: Date;
    };

    const contentItems: RawContentItem[] = [];

    // Query posts if applicable
    if (!filter.contentType || filter.contentType === "all" || filter.contentType === "post") {
      const postConditions = [isNull(posts.deletedAt)];
      if (filter.search) {
        const searchCond = or(
          ilike(posts.title, `%${filter.search}%`),
          ilike(posts.slug, `%${filter.search}%`),
        );
        if (searchCond) postConditions.push(searchCond);
      }

      const postRows = await db
        .select({
          id: posts.id,
          title: posts.title,
          slug: posts.slug,
          status: posts.status,
          updatedAt: posts.updatedAt,
        })
        .from(posts)
        .where(and(...postConditions))
        .orderBy(desc(posts.updatedAt))
        .limit(limit * 2);

      for (const p of postRows) {
        contentItems.push({
          id: p.id,
          title: p.title,
          slug: p.slug,
          contentType: "post",
          status: p.status,
          updatedAt: p.updatedAt,
        });
      }
    }

    // Query pages if applicable
    if (!filter.contentType || filter.contentType === "all" || filter.contentType === "page") {
      const pageConditions = [];
      if (filter.search) {
        const searchCond = or(
          ilike(pages.title, `%${filter.search}%`),
          ilike(pages.slug, `%${filter.search}%`),
        );
        if (searchCond) pageConditions.push(searchCond);
      }

      let pageQuery = db
        .select({
          id: pages.id,
          title: pages.title,
          slug: pages.slug,
          status: pages.status,
          updatedAt: pages.updatedAt,
        })
        .from(pages);

      if (pageConditions.length > 0) {
        pageQuery = pageQuery.where(and(...pageConditions)) as any;
      }

      const pageRows = await pageQuery.orderBy(desc(pages.updatedAt)).limit(limit * 2);
      for (const pg of pageRows) {
        contentItems.push({
          id: pg.id,
          title: pg.title,
          slug: pg.slug,
          contentType: "page",
          status: pg.status,
          updatedAt: pg.updatedAt,
        });
      }
    }

    if (contentItems.length === 0) {
      return { items: [], total: 0 };
    }

    const contentIds = contentItems.map((c) => c.id);
    const trRows = await db
      .select()
      .from(contentTranslations)
      .where(inArray(contentTranslations.contentId, contentIds));

    const trMap = new Map<string, Map<string, ContentTranslationRow>>();
    for (const tr of trRows) {
      if (!trMap.has(tr.contentId)) {
        trMap.set(tr.contentId, new Map());
      }
      trMap.get(tr.contentId)!.set(tr.targetLocale, tr);
    }

    const matrixItems: TranslationMatrixItem[] = [];
    const baseDefault = defaultLocale.split("-")[0] || defaultLocale;

    for (const item of contentItems) {
      const localeStatusMap: Record<string, TranslationLocaleStatus> = {};
      const itemTranslations = trMap.get(item.id);

      for (const loc of enabledLocales) {
        const baseLoc = loc.split("-")[0] || loc;
        const isSourceLocale =
          loc === defaultLocale || baseLoc === defaultLocale || baseLoc === baseDefault;

        if (isSourceLocale) {
          localeStatusMap[loc] = {
            status: item.status === "published" ? "published" : "draft",
            translationId: null,
            slug: item.slug,
            title: item.title,
            translatedAt: item.updatedAt,
            updatedAt: item.updatedAt,
            translationProvider: "source",
            assignedTranslatorId: null,
            isStale: false,
          };
          continue;
        }

        const tr = itemTranslations?.get(loc) || itemTranslations?.get(baseLoc);
        if (!tr) {
          localeStatusMap[loc] = {
            status: "untranslated",
            translationId: null,
            slug: null,
            title: null,
            translatedAt: null,
            updatedAt: null,
            translationProvider: null,
            assignedTranslatorId: null,
            isStale: false,
          };
        } else {
          const isStale =
            tr.status === "stale" ||
            (tr.translatedAt && item.updatedAt.getTime() > tr.translatedAt.getTime());

          localeStatusMap[loc] = {
            status: isStale ? "stale" : (tr.status as TranslationStatus),
            translationId: tr.id,
            slug: tr.slug,
            title: tr.title,
            translatedAt: tr.translatedAt,
            updatedAt: tr.updatedAt,
            translationProvider: tr.translationProvider,
            assignedTranslatorId: tr.assignedTranslatorId,
            isStale: Boolean(isStale),
          };
        }
      }

      // Filter checks
      if (filter.locale && filter.status) {
        const locEntry = localeStatusMap[filter.locale];
        if (!locEntry || locEntry.status !== filter.status) {
          continue;
        }
      }

      if (filter.onlyStale) {
        const hasStale = Object.values(localeStatusMap).some((l) => l.isStale);
        if (!hasStale) continue;
      }

      matrixItems.push({
        id: item.id,
        title: item.title,
        slug: item.slug,
        contentType: item.contentType,
        sourceLocale: defaultLocale,
        sourceStatus: item.status,
        sourceUpdatedAt: item.updatedAt,
        locales: localeStatusMap,
      });
    }

    const total = matrixItems.length;
    const paginated = matrixItems.slice(offset, offset + limit);

    return { items: paginated, total };
  }

  /**
   * Aggregates prioritized translation editorial review queue.
   */
  async getTranslationQueue(
    enabledLocales: string[] = ["en", "ar-SA"],
    defaultLocale = "en",
  ): Promise<{
    stale: TranslationQueueItem[];
    needsReview: TranslationQueueItem[];
    missing: TranslationQueueItem[];
    totalCount: number;
  }> {
    const { items } = await this.getTranslationMatrix(
      { limit: 500 },
      enabledLocales,
      defaultLocale,
    );

    const stale: TranslationQueueItem[] = [];
    const needsReview: TranslationQueueItem[] = [];
    const missing: TranslationQueueItem[] = [];
    const baseDefault = defaultLocale.split("-")[0] || defaultLocale;

    for (const item of items) {
      for (const [loc, status] of Object.entries(item.locales)) {
        const baseLoc = loc.split("-")[0] || loc;
        const isSource =
          loc === defaultLocale || baseLoc === defaultLocale || baseLoc === baseDefault;
        if (isSource) continue;

        if (status.status === "stale" || status.isStale) {
          stale.push({
            id: `${item.id}-${loc}`,
            translationId: status.translationId,
            contentType: item.contentType,
            contentId: item.id,
            contentTitle: item.title,
            sourceLocale: defaultLocale,
            targetLocale: loc,
            status: "stale",
            reason: "stale_published",
            sourceUpdatedAt: item.sourceUpdatedAt,
            translatedAt: status.translatedAt,
            translationProvider: status.translationProvider,
          });
        } else if (status.status === "needs_review") {
          needsReview.push({
            id: `${item.id}-${loc}`,
            translationId: status.translationId,
            contentType: item.contentType,
            contentId: item.id,
            contentTitle: item.title,
            sourceLocale: defaultLocale,
            targetLocale: loc,
            status: "needs_review",
            reason: "needs_review",
            sourceUpdatedAt: item.sourceUpdatedAt,
            translatedAt: status.translatedAt,
            translationProvider: status.translationProvider,
          });
        } else if (status.status === "untranslated" && item.sourceStatus === "published") {
          missing.push({
            id: `${item.id}-${loc}`,
            translationId: null,
            contentType: item.contentType,
            contentId: item.id,
            contentTitle: item.title,
            sourceLocale: defaultLocale,
            targetLocale: loc,
            status: "untranslated",
            reason: "missing",
            sourceUpdatedAt: item.sourceUpdatedAt,
            translatedAt: null,
            translationProvider: null,
          });
        }
      }
    }

    return {
      stale,
      needsReview,
      missing,
      totalCount: stale.length + needsReview.length + missing.length,
    };
  }

  /**
   * Calculates overall publication translation health metrics based on canonical definitions:
   * - Translation Coverage = translations existing / eligible non-default source items
   * - Published Coverage = published translations / eligible non-default source items
   * - Review Coverage = (needs_review + approved) / existing translations
   * - Stale Rate = stale translations / (published + stale translations)
   */
  async getLocalizationHealth(
    enabledLocales: string[] = ["en", "ar-SA"],
    defaultLocale = "en",
  ): Promise<LocalizationHealthMetrics> {
    const { items, total } = await this.getTranslationMatrix(
      { limit: 1000 },
      enabledLocales,
      defaultLocale,
    );

    let totalTranslations = 0;
    let publishedCount = 0;
    let staleCount = 0;
    let needsReviewCount = 0;
    let approvedCount = 0;
    let missingCount = 0;

    const byLocale: LocalizationHealthMetrics["byLocale"] = {};
    const baseDefault = defaultLocale.split("-")[0] || defaultLocale;

    for (const loc of enabledLocales) {
      byLocale[loc] = {
        locale: loc,
        totalSource: total,
        translated: 0,
        published: 0,
        stale: 0,
        needsReview: 0,
        missing: 0,
        coveragePercentage: 0,
        publishedCoveragePercentage: 0,
        staleRatePercentage: 0,
      };
    }

    for (const item of items) {
      for (const loc of enabledLocales) {
        const stat = item.locales[loc];
        const locRec = byLocale[loc]!;
        const baseLoc = loc.split("-")[0] || loc;
        const isSource =
          loc === defaultLocale || baseLoc === defaultLocale || baseLoc === baseDefault;

        if (isSource) {
          locRec.translated++;
          locRec.published++;
          continue;
        }

        if (!stat || stat.status === "untranslated") {
          locRec.missing++;
          missingCount++;
        } else {
          locRec.translated++;
          totalTranslations++;

          if (stat.status === "published") {
            locRec.published++;
            publishedCount++;
          } else if (stat.status === "stale") {
            locRec.stale++;
            staleCount++;
          } else if (stat.status === "needs_review") {
            locRec.needsReview++;
            needsReviewCount++;
          } else if (stat.status === "approved") {
            approvedCount++;
          }
        }
      }
    }

    const nonDefaultLocales = enabledLocales.filter((l) => {
      const baseLoc = l.split("-")[0] || l;
      return l !== defaultLocale && baseLoc !== defaultLocale && baseLoc !== baseDefault;
    });
    const nonDefaultPotential = total * (nonDefaultLocales.length || 1);

    for (const loc of enabledLocales) {
      const locRec = byLocale[loc]!;
      locRec.coveragePercentage =
        total > 0 ? Math.round((locRec.published / total) * 100) : 100;
      locRec.publishedCoveragePercentage = locRec.coveragePercentage;
      const locTotalLive = locRec.published + locRec.stale;
      locRec.staleRatePercentage =
        locTotalLive > 0 ? Math.round((locRec.stale / locTotalLive) * 100) : 0;
    }

    const translationCoveragePercentage =
      nonDefaultPotential > 0
        ? Math.round((totalTranslations / nonDefaultPotential) * 100)
        : 100;

    const publishedCoveragePercentage =
      nonDefaultPotential > 0
        ? Math.round((publishedCount / nonDefaultPotential) * 100)
        : 100;

    const reviewCoveragePercentage =
      totalTranslations > 0
        ? Math.round(((needsReviewCount + approvedCount) / totalTranslations) * 100)
        : 0;

    const totalLiveTranslations = publishedCount + staleCount;
    const staleRatePercentage =
      totalLiveTranslations > 0
        ? Math.round((staleCount / totalLiveTranslations) * 100)
        : 0;

    return {
      totalSourceItems: total,
      totalTranslations,
      publishedCount,
      staleCount,
      needsReviewCount,
      missingCount,
      translationCoveragePercentage,
      publishedCoveragePercentage,
      reviewCoveragePercentage,
      staleRatePercentage,
      overallCoveragePercentage: publishedCoveragePercentage,
      byLocale,
    };
  }

  /**
   * Granular, hardened bulk action handler for translations.
   * Validates individual item existence and status transitions.
   */
  async bulkUpdateTranslations(input: {
    translationIds: string[];
    action: "submit_review" | "approve" | "publish" | "mark_stale" | "delete";
    reviewerId?: string | undefined;
  }): Promise<BulkTranslationResult> {
    const db = getDb();
    const errors: string[] = [];
    const succeededIds: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    const now = new Date();

    for (const id of input.translationIds) {
      try {
        const rows = await db
          .select()
          .from(contentTranslations)
          .where(eq(contentTranslations.id, id))
          .limit(1);

        if (!rows[0]) {
          failed.push({ id, reason: "Translation not found" });
          errors.push(`Translation ${id}: Translation not found`);
          continue;
        }

        const currentStatus = rows[0].status as TranslationStatus;

        if (input.action === "submit_review") {
          const check = validateTranslationStatusTransition(currentStatus, "needs_review");
          if (!check.valid) {
            failed.push({ id, reason: check.reason || "Invalid status transition" });
            errors.push(`Translation ${id}: ${check.reason}`);
            continue;
          }
          await this.submitForReview(id);
          succeededIds.push(id);
        } else if (input.action === "approve") {
          const check = validateTranslationStatusTransition(currentStatus, "approved");
          if (!check.valid) {
            failed.push({ id, reason: check.reason || "Invalid status transition" });
            errors.push(`Translation ${id}: ${check.reason}`);
            continue;
          }
          await this.approveTranslation(id, input.reviewerId || "system");
          succeededIds.push(id);
        } else if (input.action === "publish") {
          const check = validateTranslationStatusTransition(currentStatus, "published");
          if (!check.valid) {
            failed.push({ id, reason: check.reason || "Invalid status transition" });
            errors.push(`Translation ${id}: ${check.reason}`);
            continue;
          }
          await this.publishTranslation(id);
          succeededIds.push(id);
        } else if (input.action === "mark_stale") {
          const check = validateTranslationStatusTransition(currentStatus, "stale");
          if (!check.valid) {
            failed.push({ id, reason: check.reason || "Invalid status transition" });
            errors.push(`Translation ${id}: ${check.reason}`);
            continue;
          }
          await db
            .update(contentTranslations)
            .set({ status: "stale", updatedAt: now })
            .where(eq(contentTranslations.id, id));
          succeededIds.push(id);
        } else if (input.action === "delete") {
          await db.delete(contentTranslations).where(eq(contentTranslations.id, id));
          succeededIds.push(id);
        }
      } catch (err: any) {
        failed.push({ id, reason: err.message || "Execution error" });
        errors.push(`Translation ${id}: ${err.message}`);
      }
    }

    return {
      updatedCount: succeededIds.length,
      succeededIds,
      failed,
      errors,
    };
  }
}
