import {
  getDb,
  contentTranslations,
  ContentTranslationRow,
  TranslationStatus,
} from "@vibress/database";
import { eq, and, desc } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface UpsertTranslationInput {
  contentType: "post" | "page" | "content_entry";
  contentId: string;
  sourceLocale?: string;
  targetLocale: string;
  title: string;
  slug: string;
  excerpt?: string | null;
  content?: Record<string, unknown> | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  status?: TranslationStatus;
  assignedTranslatorId?: string | null;
  translationDueDate?: Date | null;
  sourceUpdatedAt?: Date | null;
  sourceVersion?: number | null;
}

export interface ContentTranslationItem {
  id: string;
  contentType: string;
  contentId: string;
  sourceLocale: string;
  targetLocale: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: Record<string, unknown>;
  metaTitle: string | null;
  metaDescription: string | null;
  status: TranslationStatus;
  assignedTranslatorId: string | null;
  translationDueDate: Date | null;
  isStale: boolean;
  translatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class TranslationService {
  async getTranslation(
    contentType: string,
    contentId: string,
    targetLocale: string,
    currentSourceUpdatedAt?: Date,
  ): Promise<ContentTranslationItem | null> {
    const db = getDb();
    const rows = await db
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

    if (!rows[0]) return null;
    const r = rows[0];
    const isStale =
      r.status === "stale" ||
      (currentSourceUpdatedAt && r.translatedAt
        ? currentSourceUpdatedAt.getTime() > r.translatedAt.getTime()
        : false);

    return {
      id: r.id,
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
      assignedTranslatorId: r.assignedTranslatorId,
      translationDueDate: r.translationDueDate,
      isStale: Boolean(isStale),
      translatedAt: r.translatedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
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
      assignedTranslatorId: r.assignedTranslatorId,
      translationDueDate: r.translationDueDate,
      isStale: r.status === "stale",
      translatedAt: r.translatedAt,
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
          title: input.title,
          slug: input.slug,
          excerpt: input.excerpt ?? null,
          content: input.content || {},
          metaTitle: input.metaTitle ?? null,
          metaDescription: input.metaDescription ?? null,
          status,
          assignedTranslatorId: input.assignedTranslatorId ?? existing.assignedTranslatorId,
          translationDueDate: input.translationDueDate ?? existing.translationDueDate,
          sourceVersionAtTranslation: input.sourceVersion ?? 1,
          sourceUpdatedAtTranslation: input.sourceUpdatedAt ?? now,
          translatedAt: status === "translated" ? now : existing.translatedAt,
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
      assignedTranslatorId: input.assignedTranslatorId ?? null,
      translationDueDate: input.translationDueDate ?? null,
      sourceVersionAtTranslation: input.sourceVersion ?? 1,
      sourceUpdatedAtTranslation: input.sourceUpdatedAt ?? now,
      translatedAt: status === "translated" ? now : null,
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

  async markStaleIfSourceUpdated(
    contentType: string,
    contentId: string,
    sourceUpdatedAt: Date,
  ): Promise<void> {
    const translations = await this.listTranslationsForContent(contentType, contentId);
    const db = getDb();
    for (const tr of translations) {
      if (tr.translatedAt && sourceUpdatedAt.getTime() > tr.translatedAt.getTime()) {
        await db
          .update(contentTranslations)
          .set({ status: "stale", updatedAt: new Date() })
          .where(eq(contentTranslations.id, tr.id));
      }
    }
  }
}
