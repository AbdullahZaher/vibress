import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
import {
  DrizzleMemberRepository,
  DrizzleMemberAuthTokenRepository,
  DrizzleMemberSessionRepository,
  MemberAuthService,
} from "@vibress/members";
import { normalizeMemberEmail } from "@vibress/members";

class CaptureMailer {
  sent: Array<{ to: string; magicLinkUrl: string }> = [];
  async sendMagicLink(input: any): Promise<void> {
    this.sent.push({ to: input.to, magicLinkUrl: input.magicLinkUrl });
  }
}

describe("Batch 8 — Member API Integration & Security", () => {
  let app: FastifyInstance;
  let mailer: CaptureMailer;
  let authService: MemberAuthService;
  let memberRepo: DrizzleMemberRepository;

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
  });

  afterAll(async () => {
    await app.close();
  });

  it("member auth request returns generic enumeration-safe response", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/members/v1/auth/request",
      payload: { email: `enum-${Date.now()}@example.com` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("sign-in link");
  });

  it("does not reveal member existence via response shape", async () => {
    const unknown = await app.inject({
      method: "POST",
      url: "/api/members/v1/auth/request",
      payload: { email: `nobody-${Date.now()}@example.com` },
    });
    const knownEmail = `known-${Date.now()}@example.com`;
    await authService.requestAuthLink(knownEmail);
    const known = await app.inject({
      method: "POST",
      url: "/api/members/v1/auth/request",
      payload: { email: knownEmail },
    });
    expect(unknown.body).toBe(known.body);
  });

  it("raw auth token never stored in database (hash only)", async () => {
    const email = `hash-${Date.now()}@example.com`;
    await authService.requestAuthLink(email);
    const rawToken =
      mailer.sent[mailer.sent.length - 1]!.magicLinkUrl.split("token=")[1]!;
    const { getDbPool } = await import("@vibress/database");
    const pool = getDbPool();
    const res = await pool.query(
      "select count(*)::int as c from member_auth_tokens where token_hash = $1",
      [rawToken],
    );
    expect(res.rows[0].c).toBe(0); // raw token never matches the hash column
  });

  it("member endpoint requires member session (staff cookie rejected)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/members/v1/me",
      headers: { cookie: "vibress_session=fake-staff-token" },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).errors[0].code).toBe("MEMBER_AUTH_REQUIRED");
  });

  it("admin member endpoint requires staff session (member cookie rejected)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/members",
      headers: { cookie: "vibress_member_session=fake-member-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("creates member and verifies magic link end-to-end", async () => {
    const email = `it-${Date.now()}@example.com`;
    await authService.requestAuthLink(email);
    const rawToken =
      mailer.sent[mailer.sent.length - 1]!.magicLinkUrl.split("token=")[1]!;
    const { member, sessionToken } =
      await authService.verifyAndCreateSession(rawToken);
    expect(member.emailNormalized).toBe(normalizeMemberEmail(email));
    expect(member.emailVerifiedAt).not.toBeNull();

    // Session resolves
    const resolved = await authService.resolveSession(sessionToken);
    expect(resolved?.id).toBe(member.id);

    // Token single-use
    await expect(
      authService.verifyAndCreateSession(rawToken),
    ).rejects.toThrow();
  });

  it("unique normalized email enforced at database level", async () => {
    const email = `uniq-${Date.now()}@example.com`;
    await authService.requestAuthLink(email);
    // Direct DB insert of duplicate normalized email must fail
    const { getDbPool } = await import("@vibress/database");
    const pool = getDbPool();
    await expect(
      pool.query(
        `insert into members (id, email, email_normalized, status) values ($1, $2, $3, 'active')`,
        [`dup-${Date.now()}`, email.toUpperCase(), normalizeMemberEmail(email)],
      ),
    ).rejects.toThrow();
  });
});
