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
  memberSessions,
} from "@vibress/database";
import { eq, and } from "drizzle-orm";
import { hashPassword } from "@vibress/security";
import crypto from "node:crypto";
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
      slug: `e2e-owner-${Date.now()}`,
      passwordHash: hash,
      status: "active",
    })
    .onConflictDoNothing();
  return ownerId;
}

async function signupMemberForPub(
  app: FastifyInstance,
  email: string,
  name: string,
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
  const token =
    new URL(link).searchParams.get("token") ||
    (link.includes("token=") ? link.split("token=")[1]!.split("&")[0]! : "");
  const res = await app.inject({
    method: "POST",
    url: "/api/members/v1/auth/verify",
    payload: { token },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  const memberId = String(body.member?.id ?? "");
  const setCookie = (res.headers["set-cookie"] as unknown as string) || "";
  const cookie = setCookie.split(";")[0] ?? "";

  if (name) {
    const db = getDb();
    await db.update(members).set({ name }).where(eq(members.id, memberId));
  }

  return {
    memberId,
    cookie,
  };
}

describe("Vibress — Member Comment Identity & Display Name Matrix", () => {
  let app: FastifyInstance;
  const pubAlphaId = `pub_alpha_${Date.now()}`;
  const pubBetaId = `pub_beta_${Date.now()}`;
  let postAlphaId: string;
  let postBetaId: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const db = getDb();
    const ownerId = await ensureOwner();

    // 1. Create Publication Alpha
    await db.insert(publications).values({
      id: pubAlphaId,
      workspaceId: "ws_default",
      name: "Publication Alpha",
      slug: `pub-alpha-${Date.now()}`,
      primaryLocale: "en",
    });

    // 2. Create Publication Beta
    await db.insert(publications).values({
      id: pubBetaId,
      workspaceId: "ws_default",
      name: "Publication Beta",
      slug: `pub-beta-${Date.now()}`,
      primaryLocale: "en",
    });

    // 3. Create Posts in both pubs
    postAlphaId = crypto.randomUUID();
    await db.insert(posts).values({
      id: postAlphaId,
      publicationId: pubAlphaId,
      title: "Alpha Post",
      slug: `alpha-post-${Date.now()}`,
      content: {
        schema: "vibress-studio",
        version: 1,
        root: { type: "root", children: [] },
      },
      status: "published",
      visibility: "public",
      primaryAuthorId: ownerId,
      createdBy: ownerId,
      updatedBy: ownerId,
    });

    postBetaId = crypto.randomUUID();
    await db.insert(posts).values({
      id: postBetaId,
      publicationId: pubBetaId,
      title: "Beta Post",
      slug: `beta-post-${Date.now()}`,
      content: {
        schema: "vibress-studio",
        version: 1,
        root: { type: "root", children: [] },
      },
      status: "published",
      visibility: "public",
      primaryAuthorId: ownerId,
      createdBy: ownerId,
      updatedBy: ownerId,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("1. Authenticated member creates comment -> persists memberId and resolves member display name", async () => {
    const { memberId, cookie } = await signupMemberForPub(
      app,
      `member1_${Date.now()}@example.com`,
      "Alice Wonderland",
      pubAlphaId,
    );

    const createRes = await app.inject({
      method: "POST",
      url: "/api/members/v1/comments",
      headers: {
        cookie,
        origin: "http://localhost:7777",
      },
      payload: {
        postId: postAlphaId,
        body: "Hello from Alice!",
      },
    });

    expect(createRes.statusCode).toBe(201);
    const body = createRes.json();
    expect(body.comment).toBeDefined();
    expect(body.comment.memberId).toBe(memberId);
    expect(body.comment.author).toBeDefined();
    expect(body.comment.author.id).toBe(memberId);
    expect(body.comment.author.name).toBe("Alice Wonderland");

    // Verify DB persistence
    const db = getDb();
    const dbRows = await db
      .select()
      .from(comments)
      .where(eq(comments.id, body.comment.id));
    expect(dbRows.length).toBe(1);
    expect(dbRows[0]!.memberId).toBe(memberId);
  });

  it("2. Comment list resolves the member's current display name", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: `/api/content/v1/posts/${postAlphaId}/comments`,
    });

    expect(listRes.statusCode).toBe(200);
    const body = listRes.json();
    expect(body.comments.length).toBeGreaterThan(0);
    const aliceComment = body.comments.find(
      (c: any) => c.body === "Hello from Alice!",
    );
    expect(aliceComment).toBeDefined();
    expect(aliceComment.author.name).toBe("Alice Wonderland");
  });

  it("3. Member updates display name -> existing and new comments immediately reflect updated name", async () => {
    const email = `member_updater_${Date.now()}@example.com`;
    const { memberId, cookie } = await signupMemberForPub(
      app,
      email,
      "Initial Name",
      pubAlphaId,
    );

    const createRes = await app.inject({
      method: "POST",
      url: "/api/members/v1/comments",
      headers: {
        cookie,
        origin: "http://localhost:7777",
      },
      payload: {
        postId: postAlphaId,
        body: "Comment before name change",
      },
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().comment.author.name).toBe("Initial Name");

    // Update profile name
    const updateProfileRes = await app.inject({
      method: "PATCH",
      url: "/api/members/v1/me",
      headers: {
        cookie,
        origin: "http://localhost:7777",
      },
      payload: {
        name: "Abdullah Zaher",
      },
    });
    expect(updateProfileRes.statusCode).toBe(200);
    expect(updateProfileRes.json().member.name).toBe("Abdullah Zaher");

    // Fetch comment list -> verify author name is now "Abdullah Zaher"
    const listRes = await app.inject({
      method: "GET",
      url: `/api/content/v1/posts/${postAlphaId}/comments`,
    });
    expect(listRes.statusCode).toBe(200);
    const updatedComment = listRes.json().comments.find(
      (c: any) => c.body === "Comment before name change",
    );
    expect(updatedComment).toBeDefined();
    expect(updatedComment.author.name).toBe("Abdullah Zaher");
  });

  it("4. S2 & S3: Forged memberId and authorName in request body are completely ignored", async () => {
    const { memberId: legitMemberId, cookie } = await signupMemberForPub(
      app,
      `legit_${Date.now()}@example.com`,
      "Legit Member",
      pubAlphaId,
    );

    const forgedRes = await app.inject({
      method: "POST",
      url: "/api/members/v1/comments",
      headers: {
        cookie,
        origin: "http://localhost:7777",
      },
      payload: {
        postId: postAlphaId,
        body: "Attempting identity spoofing",
        memberId: "spoofed-member-id-12345",
        authorName: "Spoofed Impersonator",
        author: { id: "evil", name: "Evil" },
      },
    });

    expect(forgedRes.statusCode).toBe(201);
    const comment = forgedRes.json().comment;
    expect(comment.memberId).toBe(legitMemberId);
    expect(comment.author.id).toBe(legitMemberId);
    expect(comment.author.name).toBe("Legit Member");
  });

  it("5. S4: Cross-publication member cannot comment on a post in another publication", async () => {
    const { cookie: betaCookie } = await signupMemberForPub(
      app,
      `beta_member_${Date.now()}@example.com`,
      "Beta Member",
      pubBetaId,
    );

    // Member of Pub Beta tries to comment on Post in Pub Alpha
    const crossPubRes = await app.inject({
      method: "POST",
      url: "/api/members/v1/comments",
      headers: {
        cookie: betaCookie,
        origin: "http://localhost:7777",
      },
      payload: {
        postId: postAlphaId,
        body: "Cross pub attack attempt",
      },
    });

    expect(crossPubRes.statusCode).toBe(404);
  });

  it("6. S5: Disabled member cannot create comments", async () => {
    const { memberId, cookie } = await signupMemberForPub(
      app,
      `disabled_${Date.now()}@example.com`,
      "Disabled Member",
      pubAlphaId,
    );

    // Disable member in DB
    const db = getDb();
    await db
      .update(members)
      .set({ status: "disabled", disabledAt: new Date() })
      .where(eq(members.id, memberId));

    const commentRes = await app.inject({
      method: "POST",
      url: "/api/members/v1/comments",
      headers: {
        cookie,
        origin: "http://localhost:7777",
      },
      payload: {
        postId: postAlphaId,
        body: "Disabled comment attempt",
      },
    });

    expect(commentRes.statusCode).toBe(401);
  });

  it("7. S6: Revoked session cannot create comments", async () => {
    const { memberId, cookie } = await signupMemberForPub(
      app,
      `revoked_${Date.now()}@example.com`,
      "Revoked Member",
      pubAlphaId,
    );

    // Revoke all sessions for this member
    const db = getDb();
    await db
      .update(memberSessions)
      .set({ revokedAt: new Date() })
      .where(eq(memberSessions.memberId, memberId));

    const commentRes = await app.inject({
      method: "POST",
      url: "/api/members/v1/comments",
      headers: {
        cookie,
        origin: "http://localhost:7777",
      },
      payload: {
        postId: postAlphaId,
        body: "Revoked comment attempt",
      },
    });

    expect(commentRes.statusCode).toBe(401);
  });

  it("8. Arabic / RTL member display name renders correctly with Unicode preserved", async () => {
    const arabicName = "عبدالله زاهر";
    const { memberId, cookie } = await signupMemberForPub(
      app,
      `arabic_${Date.now()}@example.com`,
      arabicName,
      pubAlphaId,
    );

    const createRes = await app.inject({
      method: "POST",
      url: "/api/members/v1/comments",
      headers: {
        cookie,
        origin: "http://localhost:7777",
      },
      payload: {
        postId: postAlphaId,
        body: "تعليق باللغة العربية",
      },
    });

    expect(createRes.statusCode).toBe(201);
    const comment = createRes.json().comment;
    expect(comment.author.name).toBe(arabicName);
    expect(comment.body).toBe("تعليق باللغة العربية");

    // Verify in GET comment list
    const listRes = await app.inject({
      method: "GET",
      url: `/api/content/v1/posts/${postAlphaId}/comments`,
    });
    expect(listRes.statusCode).toBe(200);
    const found = listRes.json().comments.find((c: any) => c.id === comment.id);
    expect(found).toBeDefined();
    expect(found.author.name).toBe(arabicName);
  });

  it("9. Multiple members commenting on the same post display distinct, accurate display names", async () => {
    const { cookie: cookieA } = await signupMemberForPub(
      app,
      `user_a_${Date.now()}@example.com`,
      "User Alpha",
      pubAlphaId,
    );
    const { cookie: cookieB } = await signupMemberForPub(
      app,
      `user_b_${Date.now()}@example.com`,
      "User Beta",
      pubAlphaId,
    );

    await app.inject({
      method: "POST",
      url: "/api/members/v1/comments",
      headers: { cookie: cookieA, origin: "http://localhost:7777" },
      payload: { postId: postAlphaId, body: "Comment from Alpha" },
    });

    await app.inject({
      method: "POST",
      url: "/api/members/v1/comments",
      headers: { cookie: cookieB, origin: "http://localhost:7777" },
      payload: { postId: postAlphaId, body: "Comment from Beta" },
    });

    const listRes = await app.inject({
      method: "GET",
      url: `/api/content/v1/posts/${postAlphaId}/comments`,
    });
    expect(listRes.statusCode).toBe(200);
    const commentsList = listRes.json().comments;

    const fromAlpha = commentsList.find((c: any) => c.body === "Comment from Alpha");
    const fromBeta = commentsList.find((c: any) => c.body === "Comment from Beta");

    expect(fromAlpha?.author?.name).toBe("User Alpha");
    expect(fromBeta?.author?.name).toBe("User Beta");
    expect(fromAlpha?.author?.id).not.toBe(fromBeta?.author?.id);
  });

  it("10. Public comment read model never leaks private member fields", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: `/api/content/v1/posts/${postAlphaId}/comments`,
    });

    expect(listRes.statusCode).toBe(200);
    const commentsList = listRes.json().comments;

    for (const c of commentsList) {
      // Must not expose email
      expect(c.author.email).toBeUndefined();
      expect(c.email).toBeUndefined();
      expect(c.member?.email).toBeUndefined();
      // Must not expose tokens/hashes/sessions
      expect(c.token).toBeUndefined();
      expect(c.sessionToken).toBeUndefined();
      expect(c.password).toBeUndefined();
      expect(c.passwordHash).toBeUndefined();
      // Required public properties
      expect(typeof c.id).toBe("string");
      expect(typeof c.author.id).toBe("string");
      expect(typeof c.author.name).toBe("string");
    }
  });
});
