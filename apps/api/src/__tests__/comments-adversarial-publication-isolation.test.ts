import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
import {
  DrizzleMemberRepository,
  DrizzleMemberAuthTokenRepository,
  DrizzleMemberSessionRepository,
  MemberAuthService,
} from "@vibress/members";
import { getDb, posts, users, userRoles, roles, publications } from "@vibress/database";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { hashPassword } from "@vibress/security";

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

async function createStaffUserForPub(
  app: FastifyInstance,
  email: string,
  publicationId: string,
  roleKey: "owner" | "administrator",
): Promise<{ userId: string; cookie: string }> {
  const db = getDb();
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  let userId: string;
  if (existing[0]) {
    userId = existing[0].id;
  } else {
    userId = crypto.randomUUID();
    const hash = await hashPassword("StaffPass123!");
    await db.insert(users).values({
      id: userId,
      email,
      name: `Staff ${publicationId}`,
      slug: `staff-${publicationId}-${Date.now()}`,
      passwordHash: hash,
      status: "active",
    });

    const roleRow = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, roleKey))
      .limit(1);
    if (roleRow[0]) {
      await db.insert(userRoles).values({
        userId,
        roleId: roleRow[0].id,
      });
    }
  }

  const res = await app.inject({
    method: "POST",
    url: "/api/admin/v1/auth/login",
    payload: { email, password: "StaffPass123!" },
  });
  expect(res.statusCode).toBe(200);
  const setCookie = (res.headers["set-cookie"] as unknown as string) || "";
  return {
    userId,
    cookie: setCookie.split(";")[0] ?? "",
  };
}

async function createPostForPub(
  publicationId: string,
  slug: string,
  authorId: string,
): Promise<string> {
  const db = getDb();
  const id = `post-${publicationId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  await db.insert(posts).values({
    id,
    title: `Post for ${publicationId}`,
    slug,
    publicationId,
    content: {
      schema: "vibress-studio",
      version: 1,
      root: { type: "root", children: [] },
    },
    status: "published",
    visibility: "public",
    primaryAuthorId: authorId,
    createdBy: authorId,
    updatedBy: authorId,
  });
  return id;
}

describe("Phase 14 — Adversarial Comments Multi-Tenant & Publication Isolation", () => {
  let app: FastifyInstance;
  let memberPubAlpha: { memberId: string; cookie: string };
  let memberPubBeta: { memberId: string; cookie: string };
  let staffPubAlphaCookie: string;
  let staffPubBetaCookie: string;
  let postPubAlphaId: string;
  let postPubBetaId: string;
  let commentPubAlphaId: string;
  let commentPubBetaId: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const db = getDb();
    await db
      .insert(publications)
      .values([
        {
          id: "pub_alpha",
          workspaceId: "ws_default",
          name: "Alpha Pub",
          slug: "alpha",
          primaryLocale: "en",
        },
        {
          id: "pub_beta",
          workspaceId: "ws_default",
          name: "Beta Pub",
          slug: "beta",
          primaryLocale: "en",
        },
      ])
      .onConflictDoNothing();

    const suffix = `${Date.now()}`;
    memberPubAlpha = await signupMemberForPub(
      app,
      `member-alpha-${suffix}@example.com`,
      "pub_alpha",
    );
    memberPubBeta = await signupMemberForPub(
      app,
      `member-beta-${suffix}@example.com`,
      "pub_beta",
    );

    const staffAlpha = await createStaffUserForPub(
      app,
      `staff-alpha-${suffix}@example.com`,
      "pub_alpha",
      "administrator",
    );
    staffPubAlphaCookie = staffAlpha.cookie;

    const staffBeta = await createStaffUserForPub(
      app,
      `staff-beta-${suffix}@example.com`,
      "pub_beta",
      "administrator",
    );
    staffPubBetaCookie = staffBeta.cookie;

    postPubAlphaId = await createPostForPub(
      "pub_alpha",
      `post-alpha-${suffix}`,
      staffAlpha.userId,
    );
    postPubBetaId = await createPostForPub(
      "pub_beta",
      `post-beta-${suffix}`,
      staffBeta.userId,
    );

    // Create valid comment in Pub Alpha by Member Alpha
    const resA = await app.inject({
      method: "POST",
      url: "/api/members/v1/comments",
      headers: { cookie: memberPubAlpha.cookie, origin: "http://localhost:7777" },
      payload: { postId: postPubAlphaId, body: "Alpha Comment 1" },
    });
    expect(resA.statusCode).toBe(201);
    commentPubAlphaId = resA.json().comment.id;

    // Create valid comment in Pub Beta by Member Beta
    const resB = await app.inject({
      method: "POST",
      url: "/api/members/v1/comments",
      headers: { cookie: memberPubBeta.cookie, origin: "http://localhost:7777" },
      payload: { postId: postPubBetaId, body: "Beta Comment 1" },
    });
    expect(resB.statusCode).toBe(201);
    commentPubBetaId = resB.json().comment.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("ADVERSARIAL: Member of Pub Alpha cannot create a comment on a Post in Pub Beta", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/members/v1/comments",
      headers: { cookie: memberPubAlpha.cookie, origin: "http://localhost:7777" },
      payload: { postId: postPubBetaId, body: "Cross-Tenant Infiltration" },
    });
    // Expected contract: 404 POST_NOT_FOUND (not HTTP 500)
    expect(res.statusCode).toBe(404);
    expect(res.json().errors[0].code).toBe("POST_NOT_FOUND");
  });

  it("ADVERSARIAL: Member of Pub Beta cannot reply to a comment in Pub Alpha", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/members/v1/comments",
      headers: { cookie: memberPubBeta.cookie, origin: "http://localhost:7777" },
      payload: {
        postId: postPubBetaId,
        parentId: commentPubAlphaId,
        body: "Cross-Tenant Reply",
      },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("ADVERSARIAL: Member of Pub Alpha cannot edit a comment in Pub Beta", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/members/v1/comments/${commentPubBetaId}`,
      headers: { cookie: memberPubAlpha.cookie, origin: "http://localhost:7777" },
      payload: { body: "Tampered comment" },
    });
    expect([403, 404]).toContain(res.statusCode);
  });

  it("ADVERSARIAL: Member of Pub Alpha cannot delete a comment in Pub Beta", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/members/v1/comments/${commentPubBetaId}`,
      headers: { cookie: memberPubAlpha.cookie, origin: "http://localhost:7777" },
    });
    expect([403, 404]).toContain(res.statusCode);
  });

  it("ADVERSARIAL: Member of Pub Alpha cannot like a comment in Pub Beta", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/members/v1/comments/${commentPubBetaId}/like`,
      headers: { cookie: memberPubAlpha.cookie, origin: "http://localhost:7777" },
    });
    expect([400, 403, 404]).toContain(res.statusCode);
  });

  it("ADVERSARIAL: Member of Pub Alpha cannot report a comment in Pub Beta", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/members/v1/comments/${commentPubBetaId}/report`,
      headers: { cookie: memberPubAlpha.cookie, origin: "http://localhost:7777" },
      payload: { reason: "cross-pub report" },
    });
    expect([400, 403, 404]).toContain(res.statusCode);
  });

  it("ADVERSARIAL: Public API for Post in Pub Alpha only returns Alpha comments", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/content/v1/posts/${postPubAlphaId}/comments`,
    });
    expect(res.statusCode).toBe(200);
    const comments = res.json().comments;
    expect(comments.length).toBeGreaterThan(0);
    for (const c of comments) {
      expect(c.publicationId).toBe("pub_alpha");
      expect(c.id).not.toBe(commentPubBetaId);
    }
  });

  it("ADVERSARIAL: Batched count for Pub Alpha only aggregates Pub Alpha posts", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/content/v1/posts/comments/counts?publicationId=pub_alpha&postIds=${postPubAlphaId},${postPubBetaId}`,
    });
    expect(res.statusCode).toBe(200);
    const counts = res.json().counts;
    expect(counts[postPubAlphaId]).toBe(1);
    expect(counts[postPubBetaId] ?? 0).toBe(0);
  });

  it("ADVERSARIAL: Staff Admin of Pub Alpha cannot hide comment in Pub Beta", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/admin/v1/comments/${commentPubBetaId}/hide?publicationId=pub_alpha`,
      headers: { cookie: staffPubAlphaCookie, origin: "http://localhost:7777" },
      payload: { reason: "unauthorized hide" },
    });
    expect([400, 404]).toContain(res.statusCode);
  });

  it("ADVERSARIAL: Staff Admin of Pub Alpha cannot view reports belonging to Pub Beta", async () => {
    // Member Beta reports Beta comment
    await app.inject({
      method: "POST",
      url: `/api/members/v1/comments/${commentPubBetaId}/report`,
      headers: { cookie: memberPubBeta.cookie, origin: "http://localhost:7777" },
      payload: { reason: "Spam in Beta" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/comment-reports?publicationId=pub_alpha",
      headers: { cookie: staffPubAlphaCookie },
    });
    expect(res.statusCode).toBe(200);
    for (const r of res.json().reports) {
      expect(r.publicationId).toBe("pub_alpha");
      expect(r.commentId).not.toBe(commentPubBetaId);
    }
  });
});
