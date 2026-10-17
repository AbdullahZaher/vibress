import { randomUUID } from "node:crypto";
import {
  getDb,
  publications,
  publicationLocales,
  posts,
  pages,
  tags,
  contentEntries,
  contentTranslations,
  installation,
} from "@vibress/database";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  canonicalPublicationLocale,
  type PublicationLocaleRepository,
  type PublicationLocaleSnapshot,
} from "../application/publication-locale-service";

export class DrizzlePublicationLocaleRepository implements PublicationLocaleRepository {
  async load(
    publicationId: string,
    forUpdate = false,
  ): Promise<PublicationLocaleSnapshot | null> {
    const db = getDb();
    const query = db
      .select({ primaryLocale: publications.primaryLocale })
      .from(publications)
      .where(eq(publications.id, publicationId))
      .limit(1);
    const results = forUpdate ? await query.for("update") : await query;
    const publication = results[0];
    if (!publication) return null;

    const rows = await db
      .select({
        locale: publicationLocales.locale,
        status: publicationLocales.status,
        isDefault: publicationLocales.isDefault,
      })
      .from(publicationLocales)
      .where(eq(publicationLocales.publicationId, publicationId));
    return { primaryLocale: publication.primaryLocale, locales: rows };
  }

  async hasAuthoredContent(publicationId: string): Promise<boolean> {
    const db = getDb();
    const existingPost = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.publicationId, publicationId), isNull(posts.deletedAt)))
      .limit(1);
    if (existingPost.length) return true;
    const existingPage = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.publicationId, publicationId), isNull(pages.deletedAt)))
      .limit(1);
    if (existingPage.length) return true;

    // Primary-language changes can also relabel taxonomy terms and
    // localizable custom-model data entries. Metadata-only schemas (contentModels)
    // and newsletters do not count as authored content.
    const existingTag = await db
      .select({ id: tags.id })
      .from(tags)
      .where(eq(tags.publicationId, publicationId))
      .limit(1);
    if (existingTag.length) return true;
    const existingEntry = await db
      .select({ id: contentEntries.id })
      .from(contentEntries)
      .where(eq(contentEntries.publicationId, publicationId))
      .limit(1);
    return existingEntry.length > 0;
  }

  async isInstallationCompleted(): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .select({ installed: installation.installed })
      .from(installation)
      .where(eq(installation.id, "singleton"))
      .limit(1);
    return rows[0]?.installed === true;
  }

  async listPublicTranslationLocales(publicationId: string): Promise<string[]> {
    const rows = await getDb()
      .selectDistinct({ locale: contentTranslations.targetLocale })
      .from(contentTranslations)
      .where(
        and(
          eq(contentTranslations.publicationId, publicationId),
          // Earlier releases exposed approved and translated states publicly.
          // Preserve their old URL inventory for retirement review on upgrades.
          inArray(contentTranslations.status, ["published", "approved", "translated"]),
        ),
      );
    return rows.map((row) => row.locale);
  }

  /**
   * Called inside PublicationLocaleService's transaction, with the parent
   * publication row locked. Keep inactive rows for safe later reactivation.
   */
  async save(
    publicationId: string,
    primaryLocale: string,
    enabledLocales: string[],
  ): Promise<void> {
    const db = getDb();
    const now = new Date();
    const existing = await db
      .select({ id: publicationLocales.id, locale: publicationLocales.locale })
      .from(publicationLocales)
      .where(eq(publicationLocales.publicationId, publicationId));

    for (const row of existing) {
      const canonical = canonicalPublicationLocale(row.locale);
      const active = enabledLocales.includes(canonical);
      await db
        .update(publicationLocales)
        .set({
          locale: canonical,
          status: active ? "active" : "inactive",
          isDefault: active && canonical === primaryLocale,
          updatedAt: now,
        })
        .where(eq(publicationLocales.id, row.id));
    }

    const existingCodes = new Set(
      existing.map((row) => canonicalPublicationLocale(row.locale)),
    );
    for (const locale of enabledLocales) {
      if (existingCodes.has(locale)) continue;
      await db.insert(publicationLocales).values({
        id: randomUUID(),
        publicationId,
        locale,
        status: "active",
        isDefault: locale === primaryLocale,
        createdAt: now,
        updatedAt: now,
      });
    }
    await db
      .update(publications)
      .set({ primaryLocale, updatedAt: now })
      .where(eq(publications.id, publicationId));
  }
}
