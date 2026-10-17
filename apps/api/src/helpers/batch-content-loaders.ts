import {
  getDb,
  posts,
  pages,
  tags,
  users,
  postAuthors,
  postTags,
  contentTranslations,
} from "@vibress/database";
import { eq, and, inArray, asc, isNull, lte } from "drizzle-orm";
import type { Post, PostStatus, PostVisibility } from "@vibress/posts";
import type { Page, PageStatus, PageVisibility } from "@vibress/pages";
import type { Author } from "@vibress/authors";
import type { Tag } from "@vibress/tags";
import type {
  ContentTranslationItem,
  TranslationStatus,
} from "@vibress/i18n";
import { slugify } from "@vibress/utils";

/**
 * Batch-loads published posts by IDs for a publication, preserving requested ID order.
 * Replaces N+1 postsService.findById calls with a single SQL query.
 */
export async function batchGetPosts(
  postIds: string[],
  publicationId: string,
): Promise<Post[]> {
  if (postIds.length === 0) return [];

  const db = getDb();
  const rows = await db
    .select()
    .from(posts)
    .where(
      and(
        inArray(posts.id, postIds),
        eq(posts.publicationId, publicationId),
        eq(posts.status, "published"),
        eq(posts.visibility, "public"),
        lte(posts.publishedAt, new Date()),
        isNull(posts.deletedAt),
      ),
    );

  const postMap = new Map<string, Post>();
  for (const row of rows) {
    postMap.set(row.id, {
      id: row.id,
      publicationId: row.publicationId,
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt,
      content: row.content as Record<string, unknown>,
      contentVersion: row.contentVersion,
      status: row.status as PostStatus,
      visibility: row.visibility as PostVisibility,
      version: row.version,
      featured: row.featured,
      featureImageId: row.featureImageId || null,
      featureImageAlt: row.featureImageAlt || null,
      featureImageCaption: row.featureImageCaption || null,
      primaryAuthorId: row.primaryAuthorId,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      publishedBy: row.publishedBy,
      publishedAt: row.publishedAt,
      scheduledAt: row.scheduledAt,
      metaTitle: row.metaTitle || null,
      metaDescription: row.metaDescription || null,
      canonicalUrl: row.canonicalUrl || null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
  }

  return postIds
    .map((id) => postMap.get(id))
    .filter((p): p is Post => p !== undefined);
}

/**
 * Batch-loads published pages by IDs for a publication, preserving requested ID order.
 */
export async function batchGetPages(
  pageIds: string[],
  publicationId: string,
): Promise<Page[]> {
  if (pageIds.length === 0) return [];

  const db = getDb();
  const rows = await db
    .select()
    .from(pages)
    .where(
      and(
        inArray(pages.id, pageIds),
        eq(pages.publicationId, publicationId),
        eq(pages.status, "published"),
        eq(pages.visibility, "public"),
        lte(pages.publishedAt, new Date()),
        isNull(pages.deletedAt),
      ),
    );

  const pageMap = new Map<string, Page>();
  for (const row of rows) {
    pageMap.set(row.id, {
      id: row.id,
      publicationId: row.publicationId,
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt,
      content: row.content as Record<string, unknown>,
      contentVersion: row.contentVersion,
      status: row.status as PageStatus,
      visibility: row.visibility as PageVisibility,
      version: row.version,
      primaryAuthorId: row.primaryAuthorId,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      publishedBy: row.publishedBy,
      publishedAt: row.publishedAt,
      scheduledAt: row.scheduledAt,
      metaTitle: row.metaTitle || null,
      metaDescription: row.metaDescription || null,
      canonicalUrl: row.canonicalUrl || null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
  }

  return pageIds
    .map((id) => pageMap.get(id))
    .filter((p): p is Page => p !== undefined);
}

/**
 * Batch-loads authors for multiple posts in a single query.
 */
export async function batchGetPostAuthors(
  postIds: string[],
): Promise<Map<string, Author[]>> {
  const map = new Map<string, Author[]>();
  for (const id of postIds) {
    map.set(id, []);
  }
  if (postIds.length === 0) return map;

  const db = getDb();
  const rows = await db
    .select({
      postId: postAuthors.postId,
      id: users.id,
      email: users.email,
      name: users.name,
      slug: users.slug,
      bio: users.bio,
      isPrimary: postAuthors.isPrimary,
      sortOrder: postAuthors.sortOrder,
    })
    .from(postAuthors)
    .innerJoin(users, eq(postAuthors.userId, users.id))
    .where(inArray(postAuthors.postId, postIds))
    .orderBy(asc(postAuthors.sortOrder));

  for (const r of rows) {
    map.get(r.postId)?.push({
      id: r.id,
      email: r.email,
      name: r.name,
      slug: r.slug || slugify(r.name) || r.id,
      bio: r.bio || null,
      isPrimary: r.isPrimary,
      sortOrder: r.sortOrder,
    });
  }

  return map;
}

/**
 * Batch-loads tags for multiple posts in a single query.
 */
export async function batchGetPostTags(
  postIds: string[],
  publicationId: string,
): Promise<Map<string, Tag[]>> {
  const map = new Map<string, Tag[]>();
  for (const id of postIds) {
    map.set(id, []);
  }
  if (postIds.length === 0) return map;

  const db = getDb();
  const rows = await db
    .select({
      postId: postTags.postId,
      id: tags.id,
      name: tags.name,
      slug: tags.slug,
      description: tags.description,
      publicationId: tags.publicationId,
      createdAt: tags.createdAt,
      updatedAt: tags.updatedAt,
      sortOrder: postTags.sortOrder,
    })
    .from(postTags)
    .innerJoin(
      tags,
      and(eq(tags.id, postTags.tagId), eq(tags.publicationId, publicationId)),
    )
    .where(inArray(postTags.postId, postIds))
    .orderBy(asc(postTags.sortOrder));

  for (const r of rows) {
    map.get(r.postId)?.push({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      publicationId: r.publicationId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  }

  return map;
}

/**
 * Batch-loads translations for multiple content IDs and a target locale.
 */
export async function batchGetTranslations(
  contentType: "post" | "page",
  contentIds: string[],
  targetLocale: string,
  publicationId: string,
): Promise<Map<string, ContentTranslationItem>> {
  const map = new Map<string, ContentTranslationItem>();
  if (contentIds.length === 0) return map;

  const db = getDb();
  const rows = await db
    .select()
    .from(contentTranslations)
    .where(
      and(
        eq(contentTranslations.contentType, contentType),
        inArray(contentTranslations.contentId, contentIds),
        eq(contentTranslations.targetLocale, targetLocale),
        eq(contentTranslations.publicationId, publicationId),
      ),
    );

  for (const r of rows) {
    map.set(r.contentId, {
      id: r.id,
      publicationId: r.publicationId,
      translationGroupId: r.translationGroupId,
      contentType: r.contentType,
      contentId: r.contentId,
      sourceLocale: r.sourceLocale,
      targetLocale: r.targetLocale,
      title: r.title,
      slug: r.slug,
      excerpt: r.excerpt,
      content: r.content as Record<string, unknown>,
      metaTitle: r.metaTitle,
      metaDescription: r.metaDescription,
      status: r.status as TranslationStatus,
      translationProvider: r.translationProvider,
      assignedTranslatorId: r.assignedTranslatorId,
      translationDueDate: r.translationDueDate,
      sourceVersionAtTranslation: r.sourceVersionAtTranslation ?? 1,
      sourceUpdatedAtTranslation: r.sourceUpdatedAtTranslation ?? r.createdAt,
      isStale: r.status === "stale",
      translatedAt: r.translatedAt,
      reviewedAt: r.reviewedAt,
      reviewedBy: r.reviewedBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  }

  return map;
}
