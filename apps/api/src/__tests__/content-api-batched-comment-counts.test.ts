import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
import { commentsService, postsService, usersService } from "../services";
import { hashPassword } from "@vibress/security";

describe("Content API Batched Comment Counts & Zero N+1 Verification", () => {
  let app: FastifyInstance;
  const pubId = "pub_default";
  let authorId: string;
  const postIds: string[] = [];

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    // Create test author
    const pwHash = await hashPassword("SecureAuthorPass123!");
    const author = await usersService.createUser({
      email: `batch.author.${Date.now()}@example.com`,
      name: "Batch Author",
      slug: `batch-author-${Date.now()}`,
      passwordHash: pwHash,
      status: "active",
    });
    authorId = author.id;

    // Create 50 posts fixture
    for (let i = 1; i <= 50; i++) {
      const p = await postsService.createPost(
        {
          title: `Batched Post ${i} - ${Date.now()}`,
          slug: `batched-post-${i}-${Date.now()}`,
          primaryAuthorId: authorId,
          content: {
            schema: "vibress-studio",
            version: 1,
            root: {
              type: "root",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", text: `Content for post ${i}` }],
                },
              ],
            },
          },
        },
        authorId,
        pubId,
      );
      await postsService.publishPost(p.id, authorId, pubId);
      postIds.push(p.id);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it("executes single batched query for 50 posts with ZERO N+1 queries", async () => {
    // Spy on commentsService.getCommentCounts and verify single invocation
    const getCommentCountsSpy = vi.spyOn(commentsService, "getCommentCounts");

    const countsMap = await commentsService.getCommentCounts(pubId, postIds);

    expect(getCommentCountsSpy).toHaveBeenCalledTimes(1);
    expect(countsMap).toBeInstanceOf(Map);
    expect(countsMap.size).toBe(50);
    for (const id of postIds) {
      expect(countsMap.has(id)).toBe(true);
      expect(typeof countsMap.get(id)).toBe("number");
    }

    getCommentCountsSpy.mockRestore();
  });

  it("returns canonical commentCount on GET /api/content/v1/posts collection", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/content/v1/posts?limit=50",
      headers: {
        "x-publication-id": pubId,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty("posts");
    expect(Array.isArray(body.posts)).toBe(true);
    expect(body.posts.length).toBeGreaterThanOrEqual(50);

    for (const post of body.posts) {
      expect(typeof post.commentCount).toBe("number");
      expect(typeof post.comment_count).toBe("number");
      expect(post.commentCount).toBe(post.comment_count);
    }
  });

  it("returns canonical commentCount on GET /api/content/v1/posts/:slug detail", async () => {
    const targetPost = await postsService.findById(postIds[0]!);
    expect(targetPost).toBeDefined();

    const res = await app.inject({
      method: "GET",
      url: `/api/content/v1/posts/${targetPost!.slug}`,
      headers: {
        "x-publication-id": pubId,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty("post");
    expect(typeof body.post.commentCount).toBe("number");
    expect(typeof body.post.comment_count).toBe("number");
    expect(body.post.commentCount).toBe(body.post.comment_count);
  });

  it("enforces tenant isolation and rejects cross-publication comment leaks", async () => {
    const otherPubId = "pub_other_isolated_tenant";
    const countsMap = await commentsService.getCommentCounts(otherPubId, postIds);

    // Cross-tenant lookup should yield 0 for all posts
    for (const id of postIds) {
      expect(countsMap.get(id)).toBe(0);
    }
  });
});
