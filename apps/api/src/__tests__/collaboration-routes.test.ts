import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
import { getDb, posts, users, userRoles, roles } from "@vibress/database";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { hashPassword } from "@vibress/security";

let testPostId: string;
let ownerUserId: string;

async function ensureOwnerAndTestPost(): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, "owner@example.com"))
    .limit(1);

  if (rows.length > 0) {
    ownerUserId = rows[0]!.id;
  } else {
    const hash = await hashPassword("OwnerPass123!");
    ownerUserId = crypto.randomUUID();
    await db
      .insert(users)
      .values({
        id: ownerUserId,
        email: "owner@example.com",
        name: "Owner",
        slug: "e2e-owner",
        passwordHash: hash,
        status: "active",
      })
      .onConflictDoNothing();

    const ownerRole = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, "owner"))
      .limit(1);

    if (ownerRole[0]) {
      await db
        .insert(userRoles)
        .values({
          userId: ownerUserId,
          roleId: ownerRole[0].id,
        })
        .onConflictDoNothing();
    }
  }

  testPostId = crypto.randomUUID();
  await db
    .insert(posts)
    .values({
      id: testPostId,
      title: "Collaboration Test Post",
      slug: `collab-test-${Date.now()}`,
      content: { root: { children: [] } },
      status: "draft",
      primaryAuthorId: ownerUserId,
      createdBy: ownerUserId,
      updatedBy: ownerUserId,
    })
    .onConflictDoNothing();
}

async function loginStaff(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/admin/v1/auth/login",
    payload: { email: "owner@example.com", password: "OwnerPass123!" },
  });
  expect(res.statusCode).toBe(200);
  const setCookie = (res.headers["set-cookie"] as unknown as string) || "";
  return setCookie.split(";")[0] ?? "";
}

describe("Studio Collaboration API Routes", () => {
  let app: FastifyInstance;
  let cookieHeader: string;

  beforeAll(async () => {
    await ensureOwnerAndTestPost();
    app = buildApp();
    await app.ready();
    cookieHeader = await loginStaff(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("Comments Lifecycle", () => {
    let commentId: string;

    it("POST /posts/:postId/collaboration/comments creates an editorial comment", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/admin/v1/posts/${testPostId}/collaboration/comments`,
        headers: { cookie: cookieHeader },
        payload: {
          body: "Please verify citation in paragraph 2.",
          blockId: "node-xyz-123",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.id).toBeDefined();
      expect(body.data.body).toBe("Please verify citation in paragraph 2.");
      expect(body.data.status).toBe("open");
      commentId = body.data.id;
    });

    it("GET /posts/:postId/collaboration/comments lists comments", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/admin/v1/posts/${testPostId}/collaboration/comments`,
        headers: { cookie: cookieHeader },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.some((c: { id: string }) => c.id === commentId)).toBe(true);
    });

    it("POST /posts/:postId/collaboration/comments/:id/resolve resolves comment", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/admin/v1/posts/${testPostId}/collaboration/comments/${commentId}/resolve`,
        headers: { cookie: cookieHeader },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.resolved).toBe(true);
    });

    it("POST /posts/:postId/collaboration/comments/:id/reopen reopens comment", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/admin/v1/posts/${testPostId}/collaboration/comments/${commentId}/reopen`,
        headers: { cookie: cookieHeader },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.reopened).toBe(true);
    });
  });

  describe("Suggestions / Track Changes", () => {
    let suggestionId: string;

    it("POST /posts/:postId/collaboration/suggestions creates suggestion", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/admin/v1/posts/${testPostId}/collaboration/suggestions`,
        headers: { cookie: cookieHeader },
        payload: {
          originalText: "The system is slow.",
          suggestedText: "The platform experiences elevated latency.",
          blockId: "node-p-1",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.id).toBeDefined();
      expect(body.data.status).toBe("pending");
      suggestionId = body.data.id;
    });

    it("POST /posts/:postId/collaboration/suggestions/:id/accept accepts suggestion", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/admin/v1/posts/${testPostId}/collaboration/suggestions/${suggestionId}/accept`,
        headers: { cookie: cookieHeader },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.accepted).toBe(true);
    });
  });

  describe("Editorial Assignments & Presence", () => {
    it("PUT /posts/:postId/collaboration/assignment updates assignment", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/admin/v1/posts/${testPostId}/collaboration/assignment`,
        headers: { cookie: cookieHeader },
        payload: {
          assigneeId: ownerUserId,
          reviewStatus: "in_review",
          editorialNotes: "Top priority feature article.",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.reviewStatus).toBe("in_review");
      expect(body.data.editorialNotes).toBe("Top priority feature article.");
    });

    it("POST /posts/:postId/collaboration/presence records active heartbeat", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/admin/v1/posts/${testPostId}/collaboration/presence`,
        headers: { cookie: cookieHeader },
        payload: {
          cursor: { x: 100, y: 250, blockId: "block-hero" },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.some((u: { userId: string }) => u.userId === ownerUserId)).toBe(true);
    });
  });

  describe("Workflow Transitions", () => {
    it("POST /posts/:postId/workflow/transition transitions status through state machine", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/admin/v1/posts/${testPostId}/workflow/transition`,
        headers: { cookie: cookieHeader },
        payload: {
          targetStatus: "in_review",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe("in_review");
    });
  });

  describe("Durable CRDT Document State Exchange", () => {
    it("POST and GET /posts/:postId/collaboration/crdt syncs incremental updates", async () => {
      const dummyUpdateBase64 = Buffer.from(new Uint8Array([1, 2, 3, 4])).toString("base64");

      const postRes = await app.inject({
        method: "POST",
        url: `/api/admin/v1/posts/${testPostId}/collaboration/crdt`,
        headers: { cookie: cookieHeader },
        payload: { update: dummyUpdateBase64 },
      });

      expect(postRes.statusCode).toBe(200);
      expect(postRes.json().data.applied).toBe(true);

      const getRes = await app.inject({
        method: "GET",
        url: `/api/admin/v1/posts/${testPostId}/collaboration/crdt`,
        headers: { cookie: cookieHeader },
      });

      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().data.updates).toContain(dummyUpdateBase64);
    });
  });
});

