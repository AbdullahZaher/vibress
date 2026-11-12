import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { buildApp } from "../main";
import { setEmailServiceForTests } from "../services";
import { FastifyInstance } from "fastify";
import {
  DrizzleMemberRepository,
  DrizzleMemberAuthTokenRepository,
  DrizzleMemberSessionRepository,
  MemberAuthService,
} from "@vibress/members";
import {
  getDb,
  publicationMemberships,
  publications,
  seedDatabase,
  users,
  workspaces,
} from "@vibress/database";
import { eq, inArray } from "drizzle-orm";
import {
  EmailService,
  DrizzleEmailRecipientRepository,
  DrizzleEmailEventRepository,
  DrizzleEmailSuppressionRepository,
  DrizzleProviderEventRepository,
  SmtpEmailProvider,
} from "@vibress/email";

class CaptureMailer {
  sent: Array<{ to: string; magicLinkUrl: string }> = [];
  async sendMagicLink(input: any): Promise<void> {
    this.sent.push({ to: input.to, magicLinkUrl: input.magicLinkUrl });
  }
}

async function signupMember(
  app: FastifyInstance,
  email: string,
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
  await authService.requestAuthLink(email);
  const link = mailer.sent[0]?.magicLinkUrl;
  if (!link) throw new Error("no magic link captured");
  const token = new URL(link).searchParams.get("token") || "";
  const res = await app.inject({
    method: "POST",
    url: "/api/members/v1/auth/verify",
    payload: { token },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  const setCookie = (res.headers["set-cookie"] as unknown as string) || "";
  const cookie: string = setCookie.split(";")[0] ?? "";
  const memberId: string = body.member?.id ?? "";
  return { memberId, cookie };
}

async function loginStaff(
  app: FastifyInstance,
  email: string,
  password: string,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/admin/v1/auth/login",
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  const setCookie = (res.headers["set-cookie"] as unknown as string) || "";
  return setCookie.split(";")[0] ?? "";
}

async function ensureOwner(): Promise<void> {
  // Integration tests elsewhere TRUNCATE users; ensure the owner exists so
  // staff-login scenarios are deterministic regardless of test order.
  const db = getDb();
  const { users, userRoles, roles } = await import("@vibress/database");
  const { hashPassword } = await import("@vibress/security");
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, "owner@example.com"))
    .limit(1);
  if (rows.length > 0) return;
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
  if (ownerRole[0]) {
    await db
      .insert(userRoles)
      .values({ userId: ownerId, roleId: ownerRole[0].id });
  }
}

const WEBHOOK_SECRET = "whsec_email_int_test";

function signEmailEvent(payload: string): string {
  return `sha256=${crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex")}`;
}

function makeEmailEvent(payload: object): string {
  return JSON.stringify({
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    type: "delivered",
    messageId: "msg_int_1",
    email: "a@example.com",
    timestamp: Math.floor(Date.now() / 1000),
    ...payload,
  });
}

describe("Batch 10 — Newsletters & Email Integration & Security", () => {
  let app: FastifyInstance;
  let staffCookie: string;
  let memberCookie: string;
  let newsletterId: string;
  let sendId: string;

  beforeAll(async () => {
    // Inject a provider with a known webhook secret (module env read happens at import time)
    setEmailServiceForTests(
      new EmailService({
        provider: new SmtpEmailProvider({
          host: "127.0.0.1",
          port: 1025,
          webhookSecret: WEBHOOK_SECRET,
        }),
        recipientRepo: new DrizzleEmailRecipientRepository(),
        eventRepo: new DrizzleEmailEventRepository(),
        suppressionRepo: new DrizzleEmailSuppressionRepository(),
        providerEventRepo: new DrizzleProviderEventRepository(),
      }),
    );
    app = buildApp();
    await app.ready();

    await ensureOwner();
    staffCookie = await loginStaff(app, "owner@example.com", "OwnerPass123!");

    const member = await signupMember(app, `nl-a-${Date.now()}@example.com`);
    memberCookie = member.cookie;
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------- Newsletters ----------------
  it("admin can create a newsletter", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/newsletters",
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      payload: {
        key: `weekly${Date.now()}`,
        name: "Weekly Digest",
        senderName: "Vibress",
        senderEmail: "news@vibress.test",
      },
    });
    expect(res.statusCode).toBe(201);
    newsletterId = res.json().newsletter.id;
  });

  it("admin newsletter creation requires newsletters.manage (401 without staff)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/newsletters",
    });
    expect(res.statusCode).toBe(401);
  });

  it("member cookie cannot access admin newsletter routes", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/newsletters",
      headers: { cookie: memberCookie },
    });
    expect(res.statusCode).toBe(401);
  });

  it("admin rejects invalid sender email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/newsletters",
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      payload: {
        key: `bad${Date.now()}`,
        name: "Bad",
        senderName: "V",
        senderEmail: "not-an-email",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe("VALIDATION_ERROR");
  });

  it("admin can create a scheduled send", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/newsletter-sends",
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      payload: {
        newsletterId,
        subject: "Test Newsletter",
        content: {
          schema: "vibress-studio",
          version: 1,
          root: {
            type: "root",
            children: [
              {
                type: "paragraph",
                children: [
                  {
                    type: "text",
                    text: "Hello",
                    format: 0,
                    mode: "normal",
                    version: 1,
                  },
                ],
                direction: null,
                format: "",
                indent: 0,
                version: 1,
              },
            ],
          },
        },
        audience: { filter: "all" },
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().send.status).toBe("scheduled");
    sendId = res.json().send.id;
  });

  it("admin can cancel a scheduled send", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/admin/v1/newsletter-sends/${sendId}/cancel`,
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().send.status).toBe("cancelled");
  });

  it("send-now requires newsletters.send permission (owner has it)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/newsletter-sends",
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      payload: {
        newsletterId,
        subject: "Send Now Test",
        content: {
          schema: "vibress-studio",
          version: 1,
          root: { type: "root", children: [] },
        },
        audience: { filter: "all" },
        sendNow: true,
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("denies cross-publication access to newsletter sends", async () => {
    const db = getDb();
    const { users, publicationMemberships } = await import("@vibress/database");
    const ownerRows = await db
      .select()
      .from(users)
      .where(eq(users.email, "owner@example.com"))
      .limit(1);
    const ownerId = ownerRows[0]!.id;
    const membershipId = crypto.randomUUID();

    await db
      .insert(publicationMemberships)
      .values({
        id: membershipId,
        publicationId: "pub_alpha",
        userId: ownerId,
        role: "owner",
      })
      .onConflictDoNothing();

    try {
      const alphaHeaders = {
        cookie: staffCookie,
        origin: "http://localhost:7777",
        "x-publication-id": "pub_alpha",
      };

      const nlRes = await app.inject({
        method: "POST",
        url: "/api/admin/v1/newsletters",
        headers: alphaHeaders,
        payload: {
          key: `alpha-send-${Date.now()}`,
          name: "Alpha Send",
          senderName: "Alpha",
          senderEmail: "alpha@vibress.test",
        },
      });
      expect(nlRes.statusCode).toBe(201);

      const sendRes = await app.inject({
        method: "POST",
        url: "/api/admin/v1/newsletter-sends",
        headers: alphaHeaders,
        payload: {
          newsletterId: nlRes.json().newsletter.id,
          subject: "Alpha only",
          content: { schema: "vibress-studio", version: 1, root: { type: "root", children: [] } },
          audience: { filter: "all" },
          scheduledAt: new Date(Date.now() + 3600000).toISOString(),
        },
      });
      expect(sendRes.statusCode).toBe(201);
      const alphaSendId = sendRes.json().send.id;

      const defaultHeaders = {
        cookie: staffCookie,
        origin: "http://localhost:7777",
        "x-publication-id": "pub_default",
      };

      const crossRead = await app.inject({
        method: "GET",
        url: `/api/admin/v1/newsletter-sends/${alphaSendId}`,
        headers: defaultHeaders,
      });
      expect(crossRead.statusCode).toBe(404);

      const crossCancel = await app.inject({
        method: "POST",
        url: `/api/admin/v1/newsletter-sends/${alphaSendId}/cancel`,
        headers: defaultHeaders,
      });
      expect(crossCancel.statusCode).toBe(400);
      expect(crossCancel.json().errors[0].code).toBe("SEND_NOT_FOUND");

      const listRes = await app.inject({
        method: "GET",
        url: "/api/admin/v1/newsletter-sends",
        headers: defaultHeaders,
      });
      expect(listRes.statusCode).toBe(200);
      expect(
        listRes
          .json()
          .sends.some((s: { id: string }) => s.id === alphaSendId),
      ).toBe(false);
    } finally {
      await db
        .delete(publicationMemberships)
        .where(eq(publicationMemberships.id, membershipId));
    }
  });

  it("RBAC 403: staff without newsletter permission cannot create sends", async () => {
    // Create a restricted staff user with the author role (no newsletter perms)
    const db = getDb();
    const { hashPassword } = await import("@vibress/security");
    const suffix = `${Date.now()}`;
    const email = `restricted-nl-${suffix}@example.com`;
    const hash = await hashPassword("RestrictedPass123!");
    const { users, userRoles, roles, publicationMemberships } = await import(
      "@vibress/database"
    );
    await db.insert(users).values({
      id: `u-nl-${suffix}`,
      email,
      name: "Restricted",
      slug: `restricted-nl-${suffix}`,
      passwordHash: hash,
      status: "active",
    });
    const authorRole = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, "author"))
      .limit(1);
    if (authorRole[0]) {
      await db
        .insert(userRoles)
        .values({ userId: `u-nl-${suffix}`, roleId: authorRole[0].id });
    }
    // Tenant access requires an explicit publication membership; without one
    // the request is denied before RBAC is evaluated.
    await db.insert(publicationMemberships).values({
      id: `pm-nl-${suffix}`,
      publicationId: "pub_default",
      userId: `u-nl-${suffix}`,
      role: "author",
    });
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      payload: { email, password: "RestrictedPass123!" },
    });
    expect(loginRes.statusCode).toBe(200);
    const restrictedCookie =
      String(loginRes.headers["set-cookie"] as unknown as string).split(
        ";",
      )[0] ?? "";

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/newsletter-sends",
      headers: { cookie: restrictedCookie, origin: "http://localhost:7777" },
      payload: {
        newsletterId,
        subject: "Nope",
        content: {},
        audience: { filter: "all" },
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().errors[0].code).toBe("PERMISSION_DENIED");
  });

  // ---------------- Member preferences ----------------
  it("member can subscribe to a newsletter", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/members/v1/newsletter-preferences",
      headers: { cookie: memberCookie, origin: "http://localhost:7777" },
      payload: { newsletterId, subscribed: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().preference.subscribed).toBe(true);
  });

  it("member preferences require member auth (401)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/members/v1/newsletter-preferences",
    });
    expect(res.statusCode).toBe(401);
  });

  it("CSRF: preference update without origin is rejected", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/members/v1/newsletter-preferences",
      headers: { cookie: memberCookie },
      payload: { newsletterId, subscribed: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it("member can unsubscribe", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/members/v1/newsletter-preferences",
      headers: { cookie: memberCookie, origin: "http://localhost:7777" },
      payload: { newsletterId, subscribed: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().preference.subscribed).toBe(false);
  });

  // ---------------- Email webhooks ----------------
  it("webhook rejects invalid signature", async () => {
    const payload = makeEmailEvent({});
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/v1/email/smtp",
      headers: {
        "content-type": "application/json",
        "x-email-signature": "sha256=bogus",
      },
      payload,
    });
    expect(res.statusCode).toBe(400);
  });

  it("webhook accepts a valid signed event and deduplicates replay", async () => {
    const payload = makeEmailEvent({
      id: "evt_dup_int",
      type: "delivered",
      messageId: "msg_int_dup",
    });
    const header = signEmailEvent(payload);
    const res1 = await app.inject({
      method: "POST",
      url: "/api/webhooks/v1/email/smtp",
      headers: {
        "content-type": "application/json",
        "x-email-signature": header,
      },
      payload,
    });
    expect(res1.statusCode).toBe(200);
    const res2 = await app.inject({
      method: "POST",
      url: "/api/webhooks/v1/email/smtp",
      headers: {
        "content-type": "application/json",
        "x-email-signature": header,
      },
      payload,
    });
    expect(res2.statusCode).toBe(200);
    // Durable dedupe: exactly one provider_events row
    const db = getDb();
    const { providerEvents } = await import("@vibress/database");
    const rows = await db
      .select()
      .from(providerEvents)
      .where(eq(providerEvents.providerEventId, "evt_dup_int"));
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("processed");
  });

  // ---------------- Test email (Mailpit) ----------------
  it("test email is delivered to Mailpit", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/newsletter-test-email",
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      payload: {
        newsletterId,
        subject: `Test ${Date.now()}`,
        content: {
          schema: "vibress-studio",
          version: 1,
          root: {
            type: "root",
            children: [
              {
                type: "paragraph",
                children: [
                  {
                    type: "text",
                    text: "Test body",
                    format: 0,
                    mode: "normal",
                    version: 1,
                  },
                ],
                direction: null,
                format: "",
                indent: 0,
                version: 1,
              },
            ],
          },
        },
        recipients: ["test-int@example.com"],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sent).toBe(1);
  });

  // ---------------- Unsubscribe ----------------
  it("public unsubscribe endpoint rejects a forged token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/public/v1/unsubscribe",
      payload: { token: "forged" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe("INVALID_UNSUBSCRIBE_TOKEN");
  });

  it("public unsubscribe endpoint rejects a missing token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/public/v1/unsubscribe",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  // ---------------- Suppressions ----------------
  it("admin can list suppressions (email.read)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/email-suppressions",
      headers: { cookie: staffCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().suppressions)).toBe(true);
  });

  it("suppression list requires staff auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/email-suppressions",
    });
    expect(res.statusCode).toBe(401);
  });

  describe("F-005: suppressions are publication-scoped", () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const workspaceId = `ws_f005_${suffix}`;
    const pubA = `pub_f005_a_${suffix}`;
    const pubB = `pub_f005_b_${suffix}`;
    const emailA = `scoped-a-${suffix}@example.com`;
    const emailB = `scoped-b-${suffix}@example.com`;
    const emailGlobal = `scoped-global-${suffix}@example.com`;
    let editorCookie: string;
    let suppressionBId: string;
    let globalSuppressionId: string;
    let ownSuppressionId: string;

    const suppressionRepo = new DrizzleEmailSuppressionRepository();

    beforeAll(async () => {
      await seedDatabase();
      const db = getDb();
      await db
        .insert(workspaces)
        .values({ id: workspaceId, name: "F-005 WS", slug: `f005-ws-${suffix}` });
      await db.insert(publications).values([
        {
          id: pubA,
          workspaceId,
          name: "F-005 Publication A",
          slug: `f005-a-${suffix}`,
        },
        {
          id: pubB,
          workspaceId,
          name: "F-005 Publication B",
          slug: `f005-b-${suffix}`,
        },
      ]);

      const editorRow = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, "editor@vibress.local"))
        .limit(1);
      const ownerRow = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, "owner@example.com"))
        .limit(1);
      const editorId = editorRow[0]!.id;
      const ownerId = ownerRow[0]!.id;

      await db.insert(publicationMemberships).values([
        { id: crypto.randomUUID(), publicationId: pubA, userId: editorId, role: "editor" },
        { id: crypto.randomUUID(), publicationId: pubA, userId: ownerId, role: "owner" },
        { id: crypto.randomUUID(), publicationId: pubB, userId: ownerId, role: "owner" },
      ]);

      await suppressionRepo.add({
        email: emailA,
        reason: "manual",
        source: "test",
        publicationId: pubA,
      });
      await suppressionRepo.add({
        email: emailB,
        reason: "manual",
        source: "test",
        publicationId: pubB,
      });
      await suppressionRepo.add({
        email: emailGlobal,
        reason: "provider_suppression",
        source: "test",
      });

      const listed = await suppressionRepo.list(100, 0, { publicationId: pubB });
      suppressionBId = (listed.suppressions as Array<{ id: string }>)[0]!.id;
      const own = await suppressionRepo.list(100, 0, { publicationId: pubA });
      ownSuppressionId = (own.suppressions as Array<{ id: string }>)[0]!.id;
      const global = await suppressionRepo.list(100, 0, {
        publicationId: pubA,
        includeGlobal: true,
      });
      globalSuppressionId = (
        global.suppressions as Array<{ id: string; email: string }>
      ).find((s) => s.email === emailGlobal)!.id;

      editorCookie = await loginStaff(
        app,
        "editor@vibress.local",
        "DevPassword123!",
      );
    });

    it("applies a global suppression but ignores other publications' rows", async () => {
      expect(await suppressionRepo.isSuppressed(emailGlobal, pubA)).toBe(true);
      expect(await suppressionRepo.isSuppressed(emailA, pubA)).toBe(true);
      expect(await suppressionRepo.isSuppressed(emailB, pubA)).toBe(false);
    });

    it("lists only the caller's publication suppressions for non-owner staff", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/admin/v1/email-suppressions",
        headers: { cookie: editorCookie, "x-publication-id": pubA },
      });
      expect(res.statusCode).toBe(200);
      const emails = (res.json().suppressions as Array<{ email: string }>).map(
        (s) => s.email,
      );
      expect(emails).toContain(emailA);
      expect(emails).not.toContain(emailB);
      expect(emails).not.toContain(emailGlobal);
    });

    it("includes global suppressions in an owner's selected publication", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/admin/v1/email-suppressions",
        headers: { cookie: staffCookie, "x-publication-id": pubA },
      });
      expect(res.statusCode).toBe(200);
      const emails = (res.json().suppressions as Array<{ email: string }>).map(
        (s) => s.email,
      );
      expect(emails).toContain(emailA);
      expect(emails).toContain(emailGlobal);
      expect(emails).not.toContain(emailB);
    });

    it("does not let staff delete another publication's suppression", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/admin/v1/email-suppressions/${suppressionBId}`,
        headers: {
          cookie: editorCookie,
          origin: "http://localhost:7777",
          "x-publication-id": pubA,
        },
      });
      expect(res.statusCode).toBe(404);
      expect(await suppressionRepo.isSuppressed(emailB, pubB)).toBe(true);
    });

    it("does not let non-owner staff lift a global suppression", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/admin/v1/email-suppressions/${globalSuppressionId}`,
        headers: {
          cookie: editorCookie,
          origin: "http://localhost:7777",
          "x-publication-id": pubA,
        },
      });
      expect(res.statusCode).toBe(404);
      expect(await suppressionRepo.isSuppressed(emailGlobal, pubA)).toBe(true);
    });

    it("lets staff delete a suppression owned by their publication", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/admin/v1/email-suppressions/${ownSuppressionId}`,
        headers: {
          cookie: editorCookie,
          origin: "http://localhost:7777",
          "x-publication-id": pubA,
        },
      });
      expect(res.statusCode).toBe(200);
      expect(await suppressionRepo.isSuppressed(emailA, pubA)).toBe(false);
    });

    afterAll(async () => {
      const db = getDb();
      await db
        .delete(publications)
        .where(inArray(publications.id, [pubA, pubB]));
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await suppressionRepo.removeById(globalSuppressionId);
    });
  });
});
