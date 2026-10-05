import {
  getDb,
  postAuthors,
  pageAuthors,
  users,
  publicationMemberships,
  runInTransaction,
} from "@vibress/database";
import { eq, asc, and, isNull, inArray } from "drizzle-orm";
import { AuthorRepository } from "../domain/repository";
import { Author } from "../domain/author";
import { slugify } from "@vibress/utils";

export class DrizzleAuthorRepository implements AuthorRepository {
  async getPostAuthors(postId: string): Promise<Author[]> {
    const db = getDb();
    const rows = await db
      .select({
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
      .where(eq(postAuthors.postId, postId))
      .orderBy(asc(postAuthors.sortOrder));

    return rows.map((r) => ({
      ...r,
      slug: r.slug || slugify(r.name) || r.id,
      bio: r.bio || null,
    }));
  }

  async findMissingPublicationAuthorIds(
    publicationId: string,
    authorIds: string[],
  ): Promise<string[]> {
    const uniqueAuthorIds = Array.from(new Set(authorIds));
    if (uniqueAuthorIds.length === 0) return [];

    const db = getDb();
    const rows = await db
      .select({ userId: publicationMemberships.userId })
      .from(publicationMemberships)
      .where(
        and(
          eq(publicationMemberships.publicationId, publicationId),
          inArray(publicationMemberships.userId, uniqueAuthorIds),
        ),
      );

    const found = new Set(rows.map((row) => row.userId));
    return uniqueAuthorIds.filter((userId) => !found.has(userId));
  }

  async setPostAuthors(
    postId: string,
    authorIds: string[],
    primaryAuthorId: string,
    publicationId: string,
  ): Promise<void> {
    await runInTransaction(async () => {
      const db = getDb();
      await db.delete(postAuthors).where(eq(postAuthors.postId, postId));

      const uniqueAuthorIds = Array.from(
        new Set([primaryAuthorId, ...authorIds]),
      );
      const insertValues = uniqueAuthorIds.map((userId, index) => ({
        publicationId,
        postId,
        userId,
        sortOrder: index,
        isPrimary: userId === primaryAuthorId,
        createdAt: new Date(),
      }));

      if (insertValues.length > 0) {
        await db.insert(postAuthors).values(insertValues);
      }
    });
  }

  async getPageAuthors(pageId: string): Promise<Author[]> {
    const db = getDb();
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        slug: users.slug,
        bio: users.bio,
        isPrimary: pageAuthors.isPrimary,
        sortOrder: pageAuthors.sortOrder,
      })
      .from(pageAuthors)
      .innerJoin(users, eq(pageAuthors.userId, users.id))
      .where(eq(pageAuthors.pageId, pageId))
      .orderBy(asc(pageAuthors.sortOrder));

    return rows.map((r) => ({
      ...r,
      slug: r.slug || slugify(r.name) || r.id,
      bio: r.bio || null,
    }));
  }

  async setPageAuthors(
    pageId: string,
    authorIds: string[],
    primaryAuthorId: string,
    publicationId: string,
  ): Promise<void> {
    await runInTransaction(async () => {
      const db = getDb();
      await db.delete(pageAuthors).where(eq(pageAuthors.pageId, pageId));

      const uniqueAuthorIds = Array.from(
        new Set([primaryAuthorId, ...authorIds]),
      );
      const insertValues = uniqueAuthorIds.map((userId, index) => ({
        publicationId,
        pageId,
        userId,
        sortOrder: index,
        isPrimary: userId === primaryAuthorId,
        createdAt: new Date(),
      }));

      if (insertValues.length > 0) {
        await db.insert(pageAuthors).values(insertValues);
      }
    });
  }

  async findAuthorBySlug(
    slug: string,
    publicationId?: string,
  ): Promise<{
    id: string;
    name: string;
    slug: string;
    bio: string | null;
  } | null> {
    const db = getDb();
    const rows = publicationId
      ? await db
          .select({
            id: users.id,
            name: users.name,
            slug: users.slug,
            bio: users.bio,
          })
          .from(users)
          .innerJoin(
            publicationMemberships,
            eq(publicationMemberships.userId, users.id),
          )
          .where(
            and(
              eq(publicationMemberships.publicationId, publicationId),
              isNull(users.deletedAt),
              eq(users.status, "active"),
            ),
          )
      : await db
          .select({
            id: users.id,
            name: users.name,
            slug: users.slug,
            bio: users.bio,
          })
          .from(users)
          .where(and(isNull(users.deletedAt), eq(users.status, "active")));

    const matched = rows.find(
      (r) => r.slug === slug || slugify(r.name) === slug || r.id === slug,
    );

    if (!matched) return null;
    return {
      id: matched.id,
      name: matched.name,
      slug: matched.slug || slugify(matched.name) || matched.id,
      bio: matched.bio || null,
    };
  }

  async listAuthors(
    publicationId?: string,
  ): Promise<
    Array<{ id: string; name: string; slug: string; bio: string | null }>
  > {
    const db = getDb();
    const rows = publicationId
      ? await db
          .select({
            id: users.id,
            name: users.name,
            slug: users.slug,
            bio: users.bio,
          })
          .from(users)
          .innerJoin(
            publicationMemberships,
            eq(publicationMemberships.userId, users.id),
          )
          .where(
            and(
              eq(publicationMemberships.publicationId, publicationId),
              isNull(users.deletedAt),
              eq(users.status, "active"),
            ),
          )
      : await db
          .select({
            id: users.id,
            name: users.name,
            slug: users.slug,
            bio: users.bio,
          })
          .from(users)
          .where(and(isNull(users.deletedAt), eq(users.status, "active")));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug || slugify(r.name) || r.id,
      bio: r.bio || null,
    }));
  }
}
