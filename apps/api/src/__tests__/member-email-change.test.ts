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
  verificationSent: Array<{ to: string; verifyUrl: string }> = [];
  noticeSent: Array<{ to: string; newEmail: string }> = [];

  async sendMagicLink(input: any): Promise<void> {
    this.sent.push({ to: input.to, magicLinkUrl: input.magicLinkUrl });
  }

  async sendEmailChangeVerification(input: any): Promise<void> {
    this.verificationSent.push({ to: input.to, verifyUrl: input.verifyUrl });
  }

  async sendEmailChangeNotice(input: any): Promise<void> {
    this.noticeSent.push({ to: input.to, newEmail: input.newEmail });
  }
}

describe("Phase 5 — Verified Email Change Lifecycle", () => {
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

  it("completes verified email change lifecycle end-to-end", async () => {
    const originalEmail = `old-email-${Date.now()}@example.com`;
    const newEmail = `new-email-${Date.now()}@example.com`;

    // 1. Sign up / login member
    await authService.requestAuthLink(originalEmail);
    const loginToken =
      mailer.sent[mailer.sent.length - 1]!.magicLinkUrl.split("token=")[1]!;

    const authRes = await app.inject({
      method: "POST",
      url: "/api/members/v1/auth/verify",
      payload: { token: loginToken },
    });
    const memberCookie = authRes.headers["set-cookie"] as string;

    // 2. Request email change
    const reqRes = await app.inject({
      method: "POST",
      url: "/api/members/v1/auth/request-email-change",
      headers: {
        cookie: memberCookie,
        origin: "http://localhost:7777",
      },
      payload: { newEmail },
    });

    expect(reqRes.statusCode).toBe(200);
    expect(JSON.parse(reqRes.body).sent).toBe(true);

    // 3. Confirm email change via API
    // Generate/lookup token through service
    const changeLink = await authService.requestEmailChange(
      JSON.parse(authRes.body).member.id,
      newEmail,
    );
    expect(changeLink.sent).toBe(true);
    const rawChangeToken =
      mailer.verificationSent[mailer.verificationSent.length - 1]!.verifyUrl.split(
        "token=",
      )[1]!;

    const confirmRes = await app.inject({
      method: "POST",
      url: "/api/members/v1/auth/confirm-email-change",
      payload: { token: rawChangeToken },
    });

    expect(confirmRes.statusCode).toBe(200);
    const confirmBody = JSON.parse(confirmRes.body);
    expect(confirmBody.success).toBe(true);
    expect(confirmBody.newEmail).toBe(newEmail);

    // 4. Verify updated email in GET /me
    const meRes = await app.inject({
      method: "GET",
      url: "/api/members/v1/me",
      headers: { cookie: memberCookie },
    });
    expect(meRes.statusCode).toBe(200);
    expect(JSON.parse(meRes.body).member.email).toBe(newEmail);

    // 5. Replay confirm fails
    const replayRes = await app.inject({
      method: "POST",
      url: "/api/members/v1/auth/confirm-email-change",
      payload: { token: rawChangeToken },
    });
    expect(replayRes.statusCode).toBe(400);
  });
});
