import { SearchDocumentInput } from "@vibress/search";
import { DrizzlePostRepository } from "@vibress/posts";
import { DrizzlePageRepository } from "@vibress/pages";
import { DrizzleTagRepository } from "@vibress/tags";
import { renderStudioDocumentToPlainText } from "@vibress/studio-renderer";
import { getConfig } from "@vibress/config";
import { getDb, contentTranslations, eq, and } from "@vibress/database";

/**
 * Worker-side content source for full index rebuilds.
 * Only published, public posts/pages, their published translations, and tags are indexed.
 * Restricted or draft content is never searchable.
 */
export class WorkerSearchContentSource {
  private postRepo = new DrizzlePostRepository();
  private pageRepo = new DrizzlePageRepository();
  private tagRepo = new DrizzleTagRepository();

  async listIndexableContent(publicationId?: string): Promise<SearchDocumentInput[]> {
    const docs: SearchDocumentInput[] = [];
    const siteUrl = getConfig().site.url;
    const db = getDb();

    const PAGE_SIZE = 100;
    let offset = 0;
    for (;;) {
      const { posts: postRows } = await this.postRepo.list({
        publishedOnly: true,
        limit: PAGE_SIZE,
        offset,
        ...(publicationId ? { publicationId } : {}),
      });
      for (const post of postRows) {
        if (post.visibility !== "public") continue;
        docs.push({
          entityType: "post",
          entityId: post.id,
          locale: (post as any).locale || "en",
          title: post.title,
          bodyText: renderStudioDocumentToPlainText(post.content).slice(
            0,
            2000,
          ),
          slug: post.slug,
          url: `${siteUrl}/posts/${post.slug}`,
          publicationId: post.publicationId,
        });

        // Index published translations for this post
        const postTranslations = await db
          .select()
          .from(contentTranslations)
          .where(
            and(
              eq(contentTranslations.contentType, "post"),
              eq(contentTranslations.contentId, post.id),
              eq(contentTranslations.status, "published"),
              ...(publicationId ? [eq(contentTranslations.publicationId, publicationId)] : []),
            ),
          );

        for (const tr of postTranslations) {
          docs.push({
            entityType: "post",
            entityId: post.id,
            locale: tr.targetLocale,
            title: tr.title,
            bodyText: renderStudioDocumentToPlainText(tr.content as any).slice(0, 2000),
            slug: tr.slug,
            url: `${siteUrl}/${tr.targetLocale}/posts/${tr.slug}`,
            publicationId: tr.publicationId,
          });
        }
      }
      if (postRows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    offset = 0;
    for (;;) {
      const { pages: pageRows } = await this.pageRepo.list({
        publishedOnly: true,
        limit: PAGE_SIZE,
        offset,
        ...(publicationId ? { publicationId } : {}),
      });
      for (const pg of pageRows) {
        if (pg.visibility !== "public") continue;
        docs.push({
          entityType: "page",
          entityId: pg.id,
          locale: (pg as any).locale || "en",
          title: pg.title,
          bodyText: renderStudioDocumentToPlainText(pg.content).slice(0, 2000),
          slug: pg.slug,
          url: `${siteUrl}/${pg.slug}`,
          publicationId: pg.publicationId,
        });

        // Index published translations for this page
        const pageTranslations = await db
          .select()
          .from(contentTranslations)
          .where(
            and(
              eq(contentTranslations.contentType, "page"),
              eq(contentTranslations.contentId, pg.id),
              eq(contentTranslations.status, "published"),
              ...(publicationId ? [eq(contentTranslations.publicationId, publicationId)] : []),
            ),
          );

        for (const tr of pageTranslations) {
          docs.push({
            entityType: "page",
            entityId: pg.id,
            locale: tr.targetLocale,
            title: tr.title,
            bodyText: renderStudioDocumentToPlainText(tr.content as any).slice(0, 2000),
            slug: tr.slug,
            url: `${siteUrl}/${tr.targetLocale}/pages/${tr.slug}`,
            publicationId: tr.publicationId,
          });
        }
      }
      if (pageRows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    const tags = await this.tagRepo.listAll(publicationId);
    for (const tag of tags) {
      docs.push({
        entityType: "tag",
        entityId: tag.id,
        locale: "en",
        title: tag.name,
        slug: tag.slug,
        url: `${siteUrl}/tags/${tag.slug}`,
        publicationId: tag.publicationId,
      });
    }

    return docs;
  }
}
