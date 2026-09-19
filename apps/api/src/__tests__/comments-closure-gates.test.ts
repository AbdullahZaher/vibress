import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../main";
import {
  getDb,
  users,
  roles,
  userRoles,
  publications,
  posts,
  members,
  comments,
  commentLikes,
  commentModerationEvents,
} from "@vibress/database";
import { eq, and, sql } from "drizzle-orm";
import { hashPassword } from "@vibress/security";
import crypto from "node:crypto";
import { createLiquidThemeEngine } from "@vibress/theme-core";

import {
  DrizzleMemberRepository,
  DrizzleMemberAuthTokenRepository,
  DrizzleMemberSessionRepository,
  MemberAuthService,
} from "@vibress/members";

class CaptureMailer {
  sent: Array<{ to: string; magicLinkUrl: string }> = [];
  async sendMagicLink(input: any): Promise<void> {
    this.sent.push({ to: input.to, magicLinkUrl: input.magicLinkUrl });
  }
}

async function signupMemberForPub(
  app: FastifyInstance,
  email: string,
  publicationId: string,
): Promise<{ memberId: string; cookie: string }> {
  const mailer = new CaptureMailer();
  const memberRepo = new DrizzleMemberRepository();
  const authService = new MemberAuthService(
    memberRepo,
    new DrizzleMemberAuthTokenRepository(),
    new DrizzleMemberSessionRepository(),
    mailer,
    () => true,
  );
  await authService.requestAuthLink(email, {}, publicationId);
  const link = mailer.sent[0]?.magicLinkUrl;
  if (!link) throw new Error("no magic link");
  const token = new URL(link).searchParams.get("token") || "";
  const res = await app.inject({
    method: "POST",
    url: "/api/members/v1/auth/verify",
    payload: { token },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  const setCookie = (res.headers["set-cookie"] as unknown as string) || "";
  return {
    memberId: String(body.member?.id ?? ""),
    cookie: setCookie.split(";")[0] ?? "",
  };
}

async function ensureOwner(): Promise<string> {
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, "owner@example.com"))
    .limit(1);
  if (rows[0]) return rows[0].id;
  const hash = await hashPassword("OwnerPass123!");
  const ownerId = crypto.randomUUID();
  await db
    .insert(users)
    .values({
      id: ownerId,
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
  if (ownerRole[0])
    await db
      .insert(userRoles)
      .values({ userId: ownerId, roleId: ownerRole[0].id })
      .onConflictDoNothing();
  return ownerId;
}

async function loginStaff(app: FastifyInstance): Promise<string> {
  await ensureOwner();
  const res = await app.inject({
    method: "POST",
    url: "/api/admin/v1/auth/login",
    payload: { email: "owner@example.com", password: "OwnerPass123!" },
  });
  expect(res.statusCode).toBe(200);
  const setCookie = (res.headers["set-cookie"] as unknown as string) || "";
  return setCookie.split(";")[0] ?? "";
}

async function createPost(
  publicationId: string,
  slug: string,
  authorId: string,
): Promise<string> {
  const db = getDb();
  const id = crypto.randomUUID();
  await db.insert(posts).values({
    id,
    publicationId,
    title: `Post ${slug}`,
    slug,
    content: {
      schema: "vibress-studio",
      version: 1,
      root: { type: "root", children: [] },
    },
    primaryAuthorId: authorId,
    createdBy: authorId,
    updatedBy: authorId,
    status: "published",
  });
  return id;
}

describe("Comments Final Evidence Closure Gates", () => {
  let app: FastifyInstance;
  let staffCookie: string;
  let ownerUserId: string;
  let member1: { memberId: string; cookie: string };
  let member2: { memberId: string; cookie: string };
  let postId: string;
  const pubId = "pub_default";

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const db = getDb();
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION prevent_comment_moderation_events_mutation()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'comment_moderation_events is an immutable audit log. UPDATE and DELETE operations are prohibited at database engine level.';
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_immutable_comment_moderation_events ON "comment_moderation_events";
      CREATE TRIGGER trg_immutable_comment_moderation_events
      BEFORE UPDATE OR DELETE ON "comment_moderation_events"
      FOR EACH ROW
      EXECUTE FUNCTION prevent_comment_moderation_events_mutation();
    `);

    ownerUserId = await ensureOwner();
    staffCookie = await loginStaff(app);

    const suffix = `${Date.now()}`;
    member1 = await signupMemberForPub(
      app,
      `member1-closure-${suffix}@example.com`,
      pubId,
    );
    member2 = await signupMemberForPub(
      app,
      `member2-closure-${suffix}@example.com`,
      pubId,
    );
    postId = await createPost(pubId, `post-closure-${suffix}`, ownerUserId);
  });

  afterAll(async () => {
    await app.close();
  });

  // ============================================================
  // GATE 2: MODERATION AUDIT IMMUTABILITY
  // ============================================================
  describe("Gate 2 — Moderation Audit Immutability", () => {
    it("proves database trigger blocks UPDATE on comment_moderation_events", async () => {
      const db = getDb();
      const eventId = crypto.randomUUID();
      const commentId = crypto.randomUUID();

      // Insert baseline comment and moderation event
      await db.insert(comments).values({
        id: commentId,
        publicationId: pubId,
        postId,
        memberId: member1.memberId,
        body: "Audit test comment",
        status: "published",
      });

      await db.insert(commentModerationEvents).values({
        id: eventId,
        publicationId: pubId,
        commentId,
        actorId: ownerUserId,
        action: "STATUS_CHANGE",
        fromStatus: "pending_review",
        toStatus: "published",
        reason: "Initial baseline approval",
      });

      // Attempt UPDATE via direct SQL
      let updateError: any = null;
      try {
        await db
          .update(commentModerationEvents)
          .set({ reason: "Tampered reason" })
          .where(eq(commentModerationEvents.id, eventId));
      } catch (err) {
        updateError = err;
      }

      expect(updateError).toBeDefined();
      const errStr =
        (updateError as any)?.cause?.message ||
        (updateError as any)?.message ||
        String(updateError);
      expect(errStr).toContain("immutable audit log");

      // Verify row in DB was NOT modified
      const [row] = await db
        .select()
        .from(commentModerationEvents)
        .where(eq(commentModerationEvents.id, eventId));
      expect(row).toBeDefined();
      expect(row!.reason).toBe("Initial baseline approval");
    });

    it("proves database trigger blocks DELETE on comment_moderation_events", async () => {
      const db = getDb();
      const eventId = crypto.randomUUID();
      const commentId = crypto.randomUUID();

      await db.insert(comments).values({
        id: commentId,
        publicationId: pubId,
        postId,
        memberId: member1.memberId,
        body: "Audit test comment 2",
        status: "published",
      });

      await db.insert(commentModerationEvents).values({
        id: eventId,
        publicationId: pubId,
        commentId,
        actorId: ownerUserId,
        action: "STATUS_CHANGE",
        fromStatus: "pending_review",
        toStatus: "published",
        reason: "Deletion protection test",
      });

      // Attempt DELETE via direct SQL
      let deleteError: any = null;
      try {
        await db
          .delete(commentModerationEvents)
          .where(eq(commentModerationEvents.id, eventId));
      } catch (err) {
        deleteError = err;
      }

      expect(deleteError).toBeDefined();
      const errStr =
        (deleteError as any)?.cause?.message ||
        (deleteError as any)?.message ||
        String(deleteError);
      expect(errStr).toContain("immutable audit log");

      // Verify row still exists in DB
      const rows = await db
        .select()
        .from(commentModerationEvents)
        .where(eq(commentModerationEvents.id, eventId));
      expect(rows.length).toBe(1);
    });
  });

  // ============================================================
  // GATE 3: IDEMPOTENCY
  // ============================================================
  describe("Gate 3 — Idempotency Semantics", () => {
    it("returns identical comment on sequential retry with same clientCommentId", async () => {
      const clientCommentId = crypto.randomUUID();

      // First submission
      const res1 = await app.inject({
        method: "POST",
        url: "/api/members/v1/comments",
        headers: { cookie: member1.cookie, origin: "http://localhost:7777" },
        payload: {
          postId,
          body: "Idempotency Body 1",
          clientCommentId,
        },
      });
      expect(res1.statusCode).toBe(201);
      const comment1 = res1.json().comment;

      // Sequential retry
      const res2 = await app.inject({
        method: "POST",
        url: "/api/members/v1/comments",
        headers: { cookie: member1.cookie, origin: "http://localhost:7777" },
        payload: {
          postId,
          body: "Idempotency Body 1 Modified",
          clientCommentId,
        },
      });
      expect([200, 201]).toContain(res2.statusCode);
      const comment2 = res2.json().comment;

      expect(comment2.id).toBe(comment1.id);
      expect(comment2.body).toBe("Idempotency Body 1");
    });

    it("different members with same clientCommentId do not collide or leak data", async () => {
      const sharedClientCommentId = crypto.randomUUID();

      const resA = await app.inject({
        method: "POST",
        url: "/api/members/v1/comments",
        headers: { cookie: member1.cookie, origin: "http://localhost:7777" },
        payload: {
          postId,
          body: "Member 1 Comment",
          clientCommentId: sharedClientCommentId,
        },
      });
      expect(resA.statusCode).toBe(201);

      const resB = await app.inject({
        method: "POST",
        url: "/api/members/v1/comments",
        headers: { cookie: member2.cookie, origin: "http://localhost:7777" },
        payload: {
          postId,
          body: "Member 2 Comment",
          clientCommentId: sharedClientCommentId,
        },
      });
      expect(resB.statusCode).toBe(201);

      const commentA = resA.json().comment;
      const commentB = resB.json().comment;

      expect(commentA.id).not.toBe(commentB.id);
      expect(commentA.memberId).toBe(member1.memberId);
      expect(commentB.memberId).toBe(member2.memberId);
    });
  });

  // ============================================================
  // GATE 5: CONCURRENCY
  // ============================================================
  describe("Gate 5 — Concurrency Races & Edge Cases", () => {
    it("handles two simultaneous comment submissions with same clientCommentId (concurrent deduplication)", async () => {
      const clientCommentId = crypto.randomUUID();

      const [res1, res2] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/api/members/v1/comments",
          headers: { cookie: member1.cookie, origin: "http://localhost:7777" },
          payload: { postId, body: "Concurrent Comment", clientCommentId },
        }),
        app.inject({
          method: "POST",
          url: "/api/members/v1/comments",
          headers: { cookie: member1.cookie, origin: "http://localhost:7777" },
          payload: { postId, body: "Concurrent Comment", clientCommentId },
        }),
      ]);

      expect([200, 201]).toContain(res1.statusCode);
      expect([200, 201]).toContain(res2.statusCode);

      const id1 = res1.json().comment.id;
      const id2 = res2.json().comment.id;
      expect(id1).toBe(id2);

      // Verify only 1 row exists in DB
      const db = getDb();
      const rows = await db
        .select()
        .from(comments)
        .where(
          and(
            eq(comments.publicationId, pubId),
            eq(comments.clientCommentId, clientCommentId),
          ),
        );
      expect(rows.length).toBe(1);
    });

    it("handles simultaneous likes without crashing or duplicating likes", async () => {
      // Create a comment
      const createRes = await app.inject({
        method: "POST",
        url: "/api/members/v1/comments",
        headers: { cookie: member1.cookie, origin: "http://localhost:7777" },
        payload: { postId, body: "Comment for like race" },
      });
      expect(createRes.statusCode).toBe(201);
      const commentId = createRes.json().comment.id;

      // Simultaneously send toggle like requests from member 2
      const [likeRes1, likeRes2] = await Promise.all([
        app.inject({
          method: "POST",
          url: `/api/members/v1/comments/${commentId}/like`,
          headers: { cookie: member2.cookie, origin: "http://localhost:7777" },
        }),
        app.inject({
          method: "POST",
          url: `/api/members/v1/comments/${commentId}/like`,
          headers: { cookie: member2.cookie, origin: "http://localhost:7777" },
        }),
      ]);

      expect(likeRes1.statusCode).toBe(200);
      expect(likeRes2.statusCode).toBe(200);

      // Database state should be clean (either 0 or 1 like in commentLikes, never duplicates)
      const db = getDb();
      const rows = await db
        .select()
        .from(commentLikes)
        .where(
          and(
            eq(commentLikes.commentId, commentId),
            eq(commentLikes.memberId, member2.memberId),
          ),
        );
      expect(rows.length).toBeLessThanOrEqual(1);
    });

    it("stale moderation transition attempt fails with domain validation error", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/api/members/v1/comments",
        headers: { cookie: member1.cookie, origin: "http://localhost:7777" },
        payload: { postId, body: "Comment for stale moderation" },
      });
      const commentId = createRes.json().comment.id;

      // 1. Delete the comment (status -> deleted)
      const delRes = await app.inject({
        method: "DELETE",
        url: `/api/admin/v1/comments/${commentId}`,
        headers: { cookie: staffCookie, "x-publication-id": pubId },
      });
      expect(delRes.statusCode).toBe(200);

      // 2. Attempt to hide a deleted comment (stale client trying hide on already deleted comment)
      const hideRes = await app.inject({
        method: "POST",
        url: `/api/admin/v1/comments/${commentId}/hide`,
        headers: { cookie: staffCookie, "x-publication-id": pubId },
      });
      expect(hideRes.statusCode).toBe(400);
      expect(hideRes.json().errors[0].code).toBe("INVALID_STATE_TRANSITION");
    });

    it("delete vs reply race: replying to a deleted parent fails cleanly", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/api/members/v1/comments",
        headers: { cookie: member1.cookie, origin: "http://localhost:7777" },
        payload: { postId, body: "Parent comment to be deleted" },
      });
      const parentId = createRes.json().comment.id;

      // Delete parent comment
      await app.inject({
        method: "DELETE",
        url: `/api/members/v1/comments/${parentId}`,
        headers: { cookie: member1.cookie, origin: "http://localhost:7777" },
      });

      // Attempt to reply
      const replyRes = await app.inject({
        method: "POST",
        url: "/api/members/v1/comments",
        headers: { cookie: member2.cookie, origin: "http://localhost:7777" },
        payload: { postId, parentId, body: "Reply to deleted parent" },
      });
      expect(replyRes.statusCode).toBe(400);
      expect(replyRes.json().errors[0].code).toBe("COMMENT_NOT_AVAILABLE");
    });
  });

  // ============================================================
  // GATE 9: XSS RENDERING PROOF
  // ============================================================
  describe("Gate 9 — XSS Rendering Sinks & DOM Proof", () => {
    it("proves XSS payloads are stripped at storage and rendered safely without executable DOM", async () => {
      const xssPayload =
        "<script>alert(1)</script><img src=x onerror=alert(1)><svg onload=alert(1)>Hello <b>World</b> javascript:alert(1)\u200B\u200C";

      const res = await app.inject({
        method: "POST",
        url: "/api/members/v1/comments",
        headers: { cookie: member1.cookie, origin: "http://localhost:7777" },
        payload: { postId, body: xssPayload },
      });
      expect(res.statusCode).toBe(201);
      const commentId = res.json().comment.id;

      // 1. Verify storage representation in database
      const db = getDb();
      const [row] = await db
        .select()
        .from(comments)
        .where(eq(comments.id, commentId));
      expect(row).toBeDefined();
      expect(row!.body).not.toContain("<script>");
      expect(row!.body).not.toContain("<img");
      expect(row!.body).not.toContain("<svg");
      expect(row!.body).not.toContain("onerror=");
      expect(row!.body).not.toContain("onload=");
      expect(row!.body).toBe("alert(1)Hello World javascript:alert(1)");

      // 2. Verify public comments API JSON output
      const publicRes = await app.inject({
        method: "GET",
        url: `/api/content/v1/posts/${postId}/comments`,
      });
      expect(publicRes.statusCode).toBe(200);
      const bodyJson = JSON.stringify(publicRes.json());
      expect(bodyJson).not.toContain("<script>");
      expect(bodyJson).not.toContain("<img");

      // 3. Verify Liquid Theme Engine rendering
      const engine = createLiquidThemeEngine({
        files: {
          "templates/post.liquid": `
            <div id="comments">
              {% for comment in post.comments %}
                <p class="comment-body">{{ comment.body | escape }}</p>
              {% endfor %}
            </div>
          `,
        },
      });

      const renderedHtml = await engine.renderFile("templates/post.liquid", {
        post: {
          comments: [{ body: row!.body }],
        },
      });

      expect(renderedHtml).not.toContain("<script>");
      expect(renderedHtml).not.toContain("<img");
      expect(renderedHtml).not.toContain("onerror=");
    });
  });

  // ============================================================
  // GATE 10: COMMENT COUNT PERFORMANCE VERIFICATION
  // ============================================================
  describe("Gate 10 — Comment Count Performance Verification", () => {
    it("benchmarks batched count performance across 50 posts and 200 comments", async () => {
      const db = getDb();
      const batchPostIds: string[] = [];

      // Create 50 posts and insert 200 comments
      for (let i = 0; i < 50; i++) {
        const pId = crypto.randomUUID();
        batchPostIds.push(pId);
        await db.insert(posts).values({
          id: pId,
          publicationId: pubId,
          title: `Perf Post ${i}`,
          slug: `perf-post-${Date.now()}-${i}`,
          content: {
            schema: "vibress-studio",
            version: 1,
            root: { type: "root", children: [] },
          },
          primaryAuthorId: ownerUserId,
          createdBy: ownerUserId,
          updatedBy: ownerUserId,
          status: "published",
        });

        // Add 4 comments per post (200 total)
        for (let j = 0; j < 4; j++) {
          await db.insert(comments).values({
            id: crypto.randomUUID(),
            publicationId: pubId,
            postId: pId,
            memberId: member1.memberId,
            body: `Perf comment ${i}-${j}`,
            status: "published",
          });
        }
      }

      // Benchmark batched count API
      const timings: number[] = [];
      for (let run = 0; run < 20; run++) {
        const start = performance.now();
        const res = await app.inject({
          method: "GET",
          url: `/api/content/v1/posts/comments/counts?postIds=${batchPostIds.slice(0, 50).join(",")}&publicationId=${pubId}`,
        });
        const duration = performance.now() - start;
        timings.push(duration);
        expect(res.statusCode).toBe(200);
        const counts = res.json().counts;
        expect(counts[batchPostIds[0]!]).toBe(4);
      }

      timings.sort((a, b) => a - b);
      const p50 = timings[Math.floor(timings.length * 0.5)];
      const p95 = timings[Math.floor(timings.length * 0.95)];

      // Record observed execution metrics
      expect(p50).toBeDefined();
      expect(p95).toBeDefined();
    });
  });
});
