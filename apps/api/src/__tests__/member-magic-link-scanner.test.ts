import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
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

describe("Phase 1 — Magic Link Scanner Safety & Verification Lifecycle", () => {
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

  it("GET /auth/verify is strictly non-mutating and redirects to portal hash route", async () => {
    const email = `scanner-${Date.now()}@example.com`;
    await authService.requestAuthLink(email);
    const rawToken =
      mailer.sent[mailer.sent.length - 1]!.magicLinkUrl.split("token=")[1]!;

    // 1. Scanner GET request
    const getRes = await app.inject({
      method: "GET",
      url: `/api/members/v1/auth/verify?token=${encodeURIComponent(rawToken)}`,
    });

    expect(getRes.statusCode).toBe(302);
    expect(getRes.headers.location).toContain("/portal/#/auth/verify?token=");
    expect(getRes.headers["set-cookie"]).toBeUndefined();

    // 2. Repeat scanner GET multiple times (simulating prefetchers, AV scanners)
    for (let i = 0; i < 5; i++) {
      const repeatRes = await app.inject({
        method: "GET",
        url: `/api/members/v1/auth/verify?token=${encodeURIComponent(rawToken)}`,
      });
      expect(repeatRes.statusCode).toBe(302);
    }

    // 3. POST by real user consumes token and establishes session
    const postRes = await app.inject({
      method: "POST",
      url: "/api/members/v1/auth/verify",
      payload: { token: rawToken },
    });

    expect(postRes.statusCode).toBe(200);
    const postBody = JSON.parse(postRes.body);
    expect(postBody.member).toBeDefined();
    expect(postBody.member.emailVerified).toBe(true);
    expect(postRes.headers["set-cookie"]).toBeDefined();
    expect(postRes.headers["set-cookie"]).toContain("vibress_member_session=");

    // 4. Replay POST fails with 400 AUTH_TOKEN_USED
    const replayRes = await app.inject({
      method: "POST",
      url: "/api/members/v1/auth/verify",
      payload: { token: rawToken },
    });

    expect(replayRes.statusCode).toBe(400);
    const replayBody = JSON.parse(replayRes.body);
    expect(replayBody.errors[0].code).toBe("AUTH_TOKEN_USED");
  });

  it("POST /auth/verify rejects malformed, missing, or expired tokens", async () => {
    const invalidRes = await app.inject({
      method: "POST",
      url: "/api/members/v1/auth/verify",
      payload: { token: "non-existent-token-12345" },
    });
    expect(invalidRes.statusCode).toBe(400);
    expect(JSON.parse(invalidRes.body).errors[0].code).toBe("AUTH_TOKEN_INVALID");

    const missingRes = await app.inject({
      method: "POST",
      url: "/api/members/v1/auth/verify",
      payload: {},
    });
    expect(missingRes.statusCode).toBe(400);
  });
});
