import {
  getDb,
  posts,
  postTags,
  postAuthors,
  tags,
  users,
} from "@vibress/database";
import {
  eq,
  and,
  or,
  isNull,
  ilike,
  count,
  lte,
  desc,
  asc,
  inArray,
} from "drizzle-orm";
import { PostRepository } from "../domain/repository";
import {
  Post,
  CreatePostData,
  ListPostsFilter,
  PostStatus,
  PostVisibility,
  PostDomainError,
} from "../domain/post";
import crypto from "node:crypto";

export class DrizzlePostRepository implements PostRepository {
  async findById(id: string): Promise<Post | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(posts)
      .where(and(eq(posts.id, id), isNull(posts.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findBySlug(slug: string): Promise<Post | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(posts)
      .where(and(eq(posts.slug, slug), isNull(posts.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findPublishedBySlug(slug: string): Promise<Post | null> {
    const db = getDb();
    const now = new Date();
    const rows = await db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.slug, slug),
          eq(posts.status, "published"),
          eq(posts.visibility, "public"),
          lte(posts.publishedAt, now),
          isNull(posts.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async create(
    data: CreatePostData & { slug: string; content: Record<string, unknown> },
  ): Promise<Post> {
    const db = getDb();
    const id = data.id || crypto.randomUUID();
    const now = new Date();

    const insertPayload = {
      id,
      title: data.title,
      slug: data.slug,
      excerpt: data.excerpt || null,
      content: data.content,
      contentVersion: data.contentVersion || 1,
      status: data.status || "draft",
      visibility: data.visibility || "public",
      version: 1,
      primaryAuthorId: data.primaryAuthorId,
      createdBy: data.createdBy || data.primaryAuthorId,
      updatedBy: data.createdBy || data.primaryAuthorId,
      publishedBy: null,
      publishedAt: null,
      scheduledAt: data.scheduledAt || null,
      metaTitle: data.metaTitle || null,
      metaDescription: data.metaDescription || null,
      canonicalUrl: data.canonicalUrl || null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    const rows = await db.insert(posts).values(insertPayload).returning();
    const row = rows[0];
    if (!row) throw new Error("Failed to insert post");
    return this.mapToDomain(row);
  }

  async update(
    id: string,
    data: Partial<Post> & { version: number },
  ): Promise<Post> {
    const db = getDb();
    const current = await this.findById(id);
    if (!current) throw new Error(`Post not found: ${id}`);

    // Optimistic concurrency check
    if (current.version !== data.version) {
      throw new PostDomainError(
        "CONTENT_CONFLICT",
        "Content has been modified by another request",
      );
    }

    const nextVersion = current.version + 1;
    const now = new Date();

    const updatePayload: Record<string, unknown> = {
      version: nextVersion,
      updatedAt: now,
    };

    if (data.title !== undefined) updatePayload.title = data.title;
    if (data.slug !== undefined) updatePayload.slug = data.slug;
    if (data.excerpt !== undefined) updatePayload.excerpt = data.excerpt;
    if (data.content !== undefined) updatePayload.content = data.content;
    if (data.contentVersion !== undefined)
      updatePayload.contentVersion = data.contentVersion;
    if (data.status !== undefined) updatePayload.status = data.status;
    if (data.visibility !== undefined)
      updatePayload.visibility = data.visibility;
    if (data.primaryAuthorId !== undefined)
      updatePayload.primaryAuthorId = data.primaryAuthorId;
    if (data.updatedBy !== undefined) updatePayload.updatedBy = data.updatedBy;
    if (data.publishedBy !== undefined)
      updatePayload.publishedBy = data.publishedBy;
    if (data.publishedAt !== undefined)
      updatePayload.publishedAt = data.publishedAt;
    if (data.scheduledAt !== undefined)
      updatePayload.scheduledAt = data.scheduledAt;
    if (data.metaTitle !== undefined) updatePayload.metaTitle = data.metaTitle;
    if (data.metaDescription !== undefined)
      updatePayload.metaDescription = data.metaDescription;
    if (data.canonicalUrl !== undefined)
      updatePayload.canonicalUrl = data.canonicalUrl;
    if (data.deletedAt !== undefined) updatePayload.deletedAt = data.deletedAt;

    const [row] = await db
      .update(posts)
      .set(updatePayload)
      .where(and(eq(posts.id, id), eq(posts.version, current.version)))
      .returning();
    if (!row) {
      throw new PostDomainError(
        "CONTENT_CONFLICT",
        "Content has been modified by another request",
      );
    }
    return this.mapToDomain(row);
  }

  async delete(id: string): Promise<void> {
    const db = getDb();
    await db
      .update(posts)
      .set({ deletedAt: new Date() })
      .where(eq(posts.id, id));
  }

  async list(
    filter: ListPostsFilter = {},
  ): Promise<{ posts: Post[]; total: number }> {
    const db = getDb();
    const limit = Math.min(filter.limit || 20, 100);
    const offset = filter.offset || 0;

    const conditions = [isNull(posts.deletedAt)];
    if (filter.publishedOnly) {
      conditions.push(eq(posts.status, "published"));
      conditions.push(lte(posts.publishedAt, new Date()));
    } else if (filter.status) {
      conditions.push(eq(posts.status, filter.status));
    }

    if (filter.visibility) {
      conditions.push(eq(posts.visibility, filter.visibility));
    }

    if (filter.authorId) {
      conditions.push(eq(posts.primaryAuthorId, filter.authorId));
    }
    if (filter.search && filter.search.trim()) {
      conditions.push(ilike(posts.title, `%${filter.search.trim()}%`));
    }

    if (filter.tagSlug) {
      const tagPosts = db
        .select({ postId: postTags.postId })
        .from(postTags)
        .innerJoin(tags, eq(postTags.tagId, tags.id))
        .where(eq(tags.slug, filter.tagSlug));
      conditions.push(inArray(posts.id, tagPosts));
    }

    if (filter.authorSlug) {
      const authorPosts = db
        .select({ postId: postAuthors.postId })
        .from(postAuthors)
        .innerJoin(users, eq(postAuthors.userId, users.id))
        .where(
          or(
            eq(users.slug, filter.authorSlug),
            eq(users.id, filter.authorSlug),
            ilike(users.name, filter.authorSlug.replace(/-/g, " ")),
          ),
        );
      conditions.push(inArray(posts.id, authorPosts));
    }

    const whereClause = and(...conditions);

    const countRes = await db
      .select({ totalCount: count() })
      .from(posts)
      .where(whereClause);

    const totalCount = countRes[0]?.totalCount || 0;

    let orderDirection =
      filter.sortOrder === "asc" ? asc(posts.createdAt) : desc(posts.createdAt);
    if (filter.sortBy === "updatedAt") {
      orderDirection =
        filter.sortOrder === "asc"
          ? asc(posts.updatedAt)
          : desc(posts.updatedAt);
    } else if (filter.sortBy === "publishedAt") {
      orderDirection =
        filter.sortOrder === "asc"
          ? asc(posts.publishedAt)
          : desc(posts.publishedAt);
    } else if (filter.sortBy === "title") {
      orderDirection =
        filter.sortOrder === "asc" ? asc(posts.title) : desc(posts.title);
    }

    const rows = await db
      .select()
      .from(posts)
      .where(whereClause)
      .orderBy(orderDirection)
      .limit(limit)
      .offset(offset);

    return {
      posts: rows.map((r) => this.mapToDomain(r)),
      total: Number(totalCount),
    };
  }

  async findDueScheduledPosts(now = new Date()): Promise<Post[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.status, "scheduled"),
          lte(posts.scheduledAt, now),
          isNull(posts.deletedAt),
        ),
      );

    return rows.map((r) => this.mapToDomain(r));
  }

  async getPostTagIds(postId: string): Promise<string[]> {
    const db = getDb();
    const rows = await db
      .select({ tagId: postTags.tagId })
      .from(postTags)
      .where(eq(postTags.postId, postId))
      .orderBy(asc(postTags.sortOrder));

    return rows.map((r) => r.tagId);
  }

  async setPostTagIds(postId: string, tagIds: string[]): Promise<void> {
    const db = getDb();
    await db.delete(postTags).where(eq(postTags.postId, postId));
    const uniqueTagIds = Array.from(new Set(tagIds));
    const insertValues = uniqueTagIds.map((tagId, idx) => ({
      postId,
      tagId,
      sortOrder: idx,
      createdAt: new Date(),
    }));

    if (insertValues.length > 0) {
      await db.insert(postTags).values(insertValues);
    }
  }

  private mapToDomain(row: typeof posts.$inferSelect): Post {
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt,
      content: row.content as Record<string, unknown>,
      contentVersion: row.contentVersion,
      status: row.status as PostStatus,
      visibility: row.visibility as PostVisibility,
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
    };
  }
}
