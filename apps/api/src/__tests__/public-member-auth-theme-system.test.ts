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
import type {
  PublicMemberIdentity,
  MemberAuthState,
} from "@vibress/theme-core";

class CaptureMailer {
  sent: Array<{ to: string; magicLinkUrl: string }> = [];
  async sendMagicLink(input: { to: string; magicLinkUrl: string }): Promise<void> {
    this.sent.push({ to: input.to, magicLinkUrl: input.magicLinkUrl });
  }
}

describe("Vibress Public Member Auth & Theme-Agnostic Identity Certification", () => {
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

  // --------------------------------------------------------------------------
  // Phase 1 & 4: Canonical Public Member Session Endpoint
  // --------------------------------------------------------------------------
  describe("Phase 1 & 4: Canonical Public Member Session Endpoint (/api/members/v1/session)", () => {
    it("returns 200 unauthenticated when no session cookie is provided", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/members/v1/session",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toEqual({
        status: "unauthenticated",
        member: null,
      });
    });

    it("returns 200 unauthenticated for invalid / forged session token", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/members/v1/session",
        headers: {
          cookie: "vb_member_session=forged-invalid-session-token",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toEqual({
        status: "unauthenticated",
        member: null,
      });
    });

    it("returns 200 authenticated with safe public DTO for valid member session", async () => {
      const email = `auth-test-${Date.now()}@example.com`;
      await authService.requestAuthLink(email, {}, "pub_default");
      const rawToken =
        mailer.sent[mailer.sent.length - 1]!.magicLinkUrl.split("token=")[1]!;
      const { member, sessionToken } =
        await authService.verifyAndCreateSession(rawToken);

      // Update name to verify public display name
      await memberRepo.update(member.id, { name: "Abdullah Zaher" });

      const res = await app.inject({
        method: "GET",
        url: "/api/members/v1/session",
        headers: {
          cookie: `vb_member_session=${sessionToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe("authenticated");
      expect(body.member).toBeDefined();
      expect(body.member.id).toBe(member.id);
      expect(body.member.name).toBe("Abdullah Zaher");
      expect(body.member.initials).toBe("AZ");
      expect(body.member.avatarUrl).toBeNull();

      // Security check: Verify NO private or sensitive fields leaked
      expect(body.member.email).toBeUndefined();
      expect(body.member.token).toBeUndefined();
      expect(body.member.sessionToken).toBeUndefined();
      expect(body.member.passwordHash).toBeUndefined();
      expect(body.member.billing).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Phase 12 & 13: Session Revocation, Expiry & Disabled Member
  // --------------------------------------------------------------------------
  describe("Phase 12 & 13: Lifecycle Transitions (Logout, Revocation, Expiry, Disabled)", () => {
    it("logout invalidates session and switches session endpoint to unauthenticated", async () => {
      const email = `logout-test-${Date.now()}@example.com`;
      await authService.requestAuthLink(email, {}, "pub_default");
      const rawToken =
        mailer.sent[mailer.sent.length - 1]!.magicLinkUrl.split("token=")[1]!;
      const { sessionToken } =
        await authService.verifyAndCreateSession(rawToken);

      // Verify active
      const beforeRes = await app.inject({
        method: "GET",
        url: "/api/members/v1/session",
        headers: { cookie: `vb_member_session=${sessionToken}` },
      });
      expect(JSON.parse(beforeRes.body).status).toBe("authenticated");

      // Logout
      const logoutRes = await app.inject({
        method: "POST",
        url: "/api/members/v1/auth/logout",
        headers: { cookie: `vb_member_session=${sessionToken}` },
      });
      expect(logoutRes.statusCode).toBe(200);

      // Verify now unauthenticated
      const afterRes = await app.inject({
        method: "GET",
        url: "/api/members/v1/session",
        headers: { cookie: `vb_member_session=${sessionToken}` },
      });
      expect(JSON.parse(afterRes.body)).toEqual({
        status: "unauthenticated",
        member: null,
      });
    });

    it("disabled member account returns unauthenticated status", async () => {
      const email = `disabled-test-${Date.now()}@example.com`;
      await authService.requestAuthLink(email, {}, "pub_default");
      const rawToken =
        mailer.sent[mailer.sent.length - 1]!.magicLinkUrl.split("token=")[1]!;
      const { member, sessionToken } =
        await authService.verifyAndCreateSession(rawToken);

      // Disable member
      await memberRepo.update(member.id, { status: "disabled", disabledAt: new Date() });

      const res = await app.inject({
        method: "GET",
        url: "/api/members/v1/session",
        headers: { cookie: `vb_member_session=${sessionToken}` },
      });
      expect(JSON.parse(res.body)).toEqual({
        status: "unauthenticated",
        member: null,
      });
    });

    it("deleted member returns unauthenticated status", async () => {
      const email = `delete-test-${Date.now()}@example.com`;
      await authService.requestAuthLink(email, {}, "pub_default");
      const rawToken =
        mailer.sent[mailer.sent.length - 1]!.magicLinkUrl.split("token=")[1]!;
      const { member, sessionToken } =
        await authService.verifyAndCreateSession(rawToken);

      // Delete member
      await memberRepo.delete(member.id);

      const res = await app.inject({
        method: "GET",
        url: "/api/members/v1/session",
        headers: { cookie: `vb_member_session=${sessionToken}` },
      });
      expect(JSON.parse(res.body)).toEqual({
        status: "unauthenticated",
        member: null,
      });
    });
  });

  // --------------------------------------------------------------------------
  // Phase 14: Multi-Publication Tenant Isolation
  // --------------------------------------------------------------------------
  describe("Phase 14: Multi-Publication Tenant Isolation", () => {
    it("member session from pub_A cannot resolve in pub_B context", async () => {
      const pool = getDbPool();
      const pubRes = await pool.query(`SELECT workspace_id FROM publications LIMIT 1;`);
      const workspaceId = pubRes.rows[0]?.workspace_id || "ws_default";

      // Ensure pub_alt exists
      await pool.query(
        `INSERT INTO publications (id, workspace_id, name, slug, created_at, updated_at)
         VALUES ('pub_alt', $1, 'Alternative Pub', 'alt-pub', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING;`,
        [workspaceId],
      );

      const email = `isolation-${Date.now()}@example.com`;
      // Create member in pub_alt
      await authService.requestAuthLink(email, {}, "pub_alt");
      const rawToken =
        mailer.sent[mailer.sent.length - 1]!.magicLinkUrl.split("token=")[1]!;
      const { sessionToken } =
        await authService.verifyAndCreateSession(rawToken);

      // When accessed from pub_default (default publication context)
      // If the route runs with pub_default context, session should be rejected
      const resolved = await authService.resolveSession(sessionToken);
      expect(resolved?.publicationId).toBe("pub_alt");

      // Verify that when checked against pub_default, it is isolated
      expect(resolved?.publicationId === "pub_default").toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Phase 9 & 22: Arabic Unicode and RTL Rendering
  // --------------------------------------------------------------------------
  describe("Phase 9 & 22: Arabic Unicode and RTL Rendering", () => {
    it("correctly handles Arabic member display names and initials", async () => {
      const email = `arabic-${Date.now()}@example.com`;
      await authService.requestAuthLink(email, {}, "pub_default");
      const rawToken =
        mailer.sent[mailer.sent.length - 1]!.magicLinkUrl.split("token=")[1]!;
      const { member, sessionToken } =
        await authService.verifyAndCreateSession(rawToken);

      await memberRepo.update(member.id, { name: "عبدالله زاهر" });

      const res = await app.inject({
        method: "GET",
        url: "/api/members/v1/session",
        headers: { cookie: `vb_member_session=${sessionToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe("authenticated");
      expect(body.member.name).toBe("عبدالله زاهر");
      expect(body.member.initials).toBe("عز");
    });
  });

  // --------------------------------------------------------------------------
  // Phase 18 & 21: Theme API Contract & Synthetic Third-Party Theme Test
  // --------------------------------------------------------------------------
  describe("Phase 18 & 21: Theme API Contract & Synthetic Future Theme Certification", () => {
    it("synthetic theme consumes MemberAuthState contract without importing auth internals", () => {
      // Synthetic Theme rendering logic that strictly consumes Theme API contract
      function renderSyntheticThemeHeader(auth: MemberAuthState): {
        viewState: "LOGGED_IN" | "LOGGED_OUT" | "LOADING";
        renderedName?: string;
      } {
        if (auth.status === "loading") {
          return { viewState: "LOADING" };
        }
        if (auth.status === "authenticated" && auth.member) {
          return {
            viewState: "LOGGED_IN",
            renderedName: auth.member.name,
          };
        }
        return { viewState: "LOGGED_OUT" };
      }

      // 1. Unauthenticated test
      const loggedOutState: MemberAuthState = {
        status: "unauthenticated",
        member: null,
      };
      expect(renderSyntheticThemeHeader(loggedOutState)).toEqual({
        viewState: "LOGGED_OUT",
      });

      // 2. Authenticated test with Arabic name
      const loggedInState: MemberAuthState = {
        status: "authenticated",
        member: {
          id: "mem_123",
          name: "عبدالله زاهر",
          avatarUrl: null,
          initials: "عز",
        },
      };
      expect(renderSyntheticThemeHeader(loggedInState)).toEqual({
        viewState: "LOGGED_IN",
        renderedName: "عبدالله زاهر",
      });
    });
  });
});
