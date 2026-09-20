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

describe("Phase 2 — Member Account Deletion & Data Retention", () => {
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

  it("member self-deletion revokes session and purges member record", async () => {
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

    // Verify GET /me works
    const meRes = await app.inject({
      method: "GET",
      url: "/api/members/v1/me",
      headers: { cookie: memberCookie },
    });
    expect(meRes.statusCode).toBe(200);

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

    // DB verify
    const pool = getDbPool();
    const countRes = await pool.query(
      "select count(*)::int as c from members where id = $1",
      [memberId],
    );
    expect(countRes.rows[0].c).toBe(0);
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
});
