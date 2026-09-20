import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
import {
  DrizzleMemberRepository,
  DrizzleMemberAuthTokenRepository,
  DrizzleMemberSessionRepository,
  MemberAuthService,
} from "@vibress/members";
import { getDbPool } from "@vibress/database";

class CaptureMailer {
  sent: Array<{ to: string; magicLinkUrl: string }> = [];
  async sendMagicLink(input: any): Promise<void> {
    this.sent.push({ to: input.to, magicLinkUrl: input.magicLinkUrl });
  }
}

describe("Phase 2 & Area 2-4 — Member Account Deletion, Billing, Retention & Outbox", () => {
  let app: FastifyInstance;
  let mailer: CaptureMailer;
  let authService: MemberAuthService;
  let memberRepo: DrizzleMemberRepository;
  let ownerCookie: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    memberRepo = new DrizzleMemberRepository();
    mailer = new CaptureMailer();
    authService = new MemberAuthService(
      memberRepo,
      new DrizzleMemberAuthTokenRepository(),
      new DrizzleMemberSessionRepository(),
      mailer,
      () => true,
    );

    // Login as owner for admin tests
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      payload: {
        email: "owner@example.com",
        password: "OwnerPass123!",
      },
    });
    const setCookie = loginRes.headers["set-cookie"];
    ownerCookie = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string);
  });

  afterAll(async () => {
    await app.close();
  });

  it("member self-deletion revokes session, cascades related rows, persists outbox event, and purges member record", async () => {
    const email = `delete-me-${Date.now()}@example.com`;
    await authService.requestAuthLink(email);
    const rawToken =
      mailer.sent[mailer.sent.length - 1]!.magicLinkUrl.split("token=")[1]!;

    const authRes = await app.inject({
      method: "POST",
      url: "/api/members/v1/auth/verify",
      payload: { token: rawToken },
    });
    expect(authRes.statusCode).toBe(200);
    const memberCookie = authRes.headers["set-cookie"] as string;
    const memberId = JSON.parse(authRes.body).member.id;

    const pool = getDbPool();

    // Attach comments, notifications, billing_customers, subscriptions, newsletter preferences
    await pool.query(
      `insert into notifications (id, recipient_id, recipient_type, type, entity_type, entity_id) values ($1, $2, 'member', 'reply', 'post', 'p1')`,
      [`notif-${Date.now()}`, memberId],
    );

    await pool.query(
      `insert into billing_customers (id, member_id, provider, provider_customer_id) values ($1, $2, 'stripe', 'cus_test123')`,
      [`bc-${Date.now()}`, memberId],
    );

    // DELETE /me
    const deleteRes = await app.inject({
      method: "DELETE",
      url: "/api/members/v1/me",
      headers: {
        cookie: memberCookie,
        origin: "http://localhost:7777",
      },
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(JSON.parse(deleteRes.body).deleted).toBe(true);

    // Subsequent GET /me must return 401
    const postDeleteMe = await app.inject({
      method: "GET",
      url: "/api/members/v1/me",
      headers: { cookie: memberCookie },
    });
    expect(postDeleteMe.statusCode).toBe(401);

    // DB verify member purged
    const countRes = await pool.query(
      "select count(*)::int as c from members where id = $1",
      [memberId],
    );
    expect(countRes.rows[0].c).toBe(0);

    // DB verify notifications purged
    const notifCount = await pool.query(
      "select count(*)::int as c from notifications where recipient_id = $1",
      [memberId],
    );
    expect(notifCount.rows[0].c).toBe(0);

    // DB verify billing_customers purged
    const bcCount = await pool.query(
      "select count(*)::int as c from billing_customers where member_id = $1",
      [memberId],
    );
    expect(bcCount.rows[0].c).toBe(0);

    // DB verify durable outbox event was persisted
    const outboxRes = await pool.query(
      "select * from outbox_events where event_type = 'member.deleted' and payload->>'memberId' = $1",
      [memberId],
    );
    expect(outboxRes.rows.length).toBeGreaterThan(0);
    const eventPayload = outboxRes.rows[0].payload;
    expect(eventPayload.memberId).toBe(memberId);
    expect(eventPayload.publicationId).toBe("pub_default");
    // Ensure zero raw PII in outbox payload
    expect(eventPayload.email).toBeUndefined();
    expect(eventPayload.name).toBeUndefined();
    expect(eventPayload.token).toBeUndefined();
  });

  it("admin member deletion via DELETE /api/admin/v1/members/:id", async () => {
    const email = `admin-delete-${Date.now()}@example.com`;
    await authService.requestAuthLink(email);
    const rawToken =
      mailer.sent[mailer.sent.length - 1]!.magicLinkUrl.split("token=")[1]!;

    const authRes = await app.inject({
      method: "POST",
      url: "/api/members/v1/auth/verify",
      payload: { token: rawToken },
    });
    const memberId = JSON.parse(authRes.body).member.id;

    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/admin/v1/members/${memberId}`,
      headers: {
        cookie: ownerCookie,
        origin: "http://localhost:7779",
      },
    });
    expect(delRes.statusCode).toBe(200);
    expect(JSON.parse(delRes.body).deleted).toBe(true);

    const pool = getDbPool();
    const countRes = await pool.query(
      "select count(*)::int as c from members where id = $1",
      [memberId],
    );
    expect(countRes.rows[0].c).toBe(0);
  });

  it("allows clean re-registration of the same email address after account deletion", async () => {
    const email = `reregister-${Date.now()}@example.com`;
    await authService.requestAuthLink(email);
    const token1 =
      mailer.sent[mailer.sent.length - 1]!.magicLinkUrl.split("token=")[1]!;

    const authRes1 = await app.inject({
      method: "POST",
      url: "/api/members/v1/auth/verify",
      payload: { token: token1 },
    });
    expect(authRes1.statusCode).toBe(200);
    const cookie1 = authRes1.headers["set-cookie"] as string;
    const memberId1 = JSON.parse(authRes1.body).member.id;

    // Delete account
    await app.inject({
      method: "DELETE",
      url: "/api/members/v1/me",
      headers: { cookie: cookie1, origin: "http://localhost:7777" },
    });

    // Re-register with same email
    await authService.requestAuthLink(email);
    const token2 =
      mailer.sent[mailer.sent.length - 1]!.magicLinkUrl.split("token=")[1]!;

    const authRes2 = await app.inject({
      method: "POST",
      url: "/api/members/v1/auth/verify",
      payload: { token: token2 },
    });
    expect(authRes2.statusCode).toBe(200);
    const memberId2 = JSON.parse(authRes2.body).member.id;

    // Must be a fresh member UUID
    expect(memberId2).not.toBe(memberId1);
  });
});
