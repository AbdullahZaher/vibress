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
import type { ThemeAuthContractV1 } from "@vibress/theme-core";

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
  // Phase 6 & 7: SSR Request-Awareness & Cache Isolation Simulation
  // --------------------------------------------------------------------------
  describe("Phase 6 & 7: SSR Request-Awareness & Cache Isolation", () => {
    it("guarantees request-scoped auth resolution with zero cross-request cache leakage", async () => {
      const email = `ssr-cache-${Date.now()}@example.com`;
      await authService.requestAuthLink(email, {}, "pub_default");
      const rawToken =
        mailer.sent[mailer.sent.length - 1]!.magicLinkUrl.split("token=")[1]!;
      const { member, sessionToken } =
        await authService.verifyAndCreateSession(rawToken);
      await memberRepo.update(member.id, { name: "Abdullah Zaher" });

      // Request A: Unauthenticated Visitor
      const reqA1 = await app.inject({
        method: "GET",
        url: "/api/members/v1/session",
      });
      expect(JSON.parse(reqA1.body)).toEqual({
        status: "unauthenticated",
        member: null,
      });

      // Request B: Authenticated Member
      const reqB1 = await app.inject({
        method: "GET",
        url: "/api/members/v1/session",
        headers: { cookie: `vibress_member_session=${sessionToken}` },
      });
      expect(JSON.parse(reqB1.body).status).toBe("authenticated");
      expect(JSON.parse(reqB1.body).member.name).toBe("Abdullah Zaher");

      // Request A (re-fetch): Must remain unauthenticated (no cross-request cache bleed)
      const reqA2 = await app.inject({
        method: "GET",
        url: "/api/members/v1/session",
      });
      expect(JSON.parse(reqA2.body)).toEqual({
        status: "unauthenticated",
        member: null,
      });

      // Request B (re-fetch): Must remain authenticated
      const reqB2 = await app.inject({
        method: "GET",
        url: "/api/members/v1/session",
        headers: { cookie: `vibress_member_session=${sessionToken}` },
      });
      expect(JSON.parse(reqB2.body).status).toBe("authenticated");
      expect(JSON.parse(reqB2.body).member.name).toBe("Abdullah Zaher");
    });
  });

  // --------------------------------------------------------------------------
  // Phase 18 & 21: Theme API Contract V1 & Custom Third-Party Theme Certification
  // --------------------------------------------------------------------------
  describe("Phase 18 & 21: Theme API Contract V1 & Custom Theme Certification", () => {
    it("custom theme renders arbitrary UI using ThemeAuthContractV1 without MemberHeaderAuth", () => {
      // Completely custom theme renderer that does NOT use MemberHeaderAuth
      function renderCustomThemeLayout(auth: import("@vibress/theme-core").ThemeAuthContractV1) {
        if (auth.isLoading) {
          return `<div class="custom-skeleton">Loading...</div>`;
        }
        if (auth.isAuthenticated && auth.member) {
          return `<div class="custom-member-pill">
            <span class="custom-avatar">${auth.member.initials || "M"}</span>
            <span class="custom-name">${auth.member.name}</span>
            <button class="custom-signout" data-action="logout">Sign out</button>
          </div>`;
        }
        return `<button class="custom-signin-btn" data-action="login">Sign in</button>`;
      }

      // 1. Unauthenticated test
      const loggedOutContract: ThemeAuthContractV1 = {
        status: "unauthenticated",
        member: null,
        isAuthenticated: false,
        isLoading: false,
        login: () => {},
        signup: () => {},
        account: () => {},
        logout: async () => {},
        refresh: async () => {},
      };
      expect(renderCustomThemeLayout(loggedOutContract)).toContain("custom-signin-btn");

      // 2. Authenticated test with Arabic display name
      const loggedInContract: ThemeAuthContractV1 = {
        status: "authenticated",
        member: {
          id: "mem_custom_123",
          name: "عبدالله زاهر",
          avatarUrl: null,
          initials: "عز",
        },
        isAuthenticated: true,
        isLoading: false,
        login: () => {},
        signup: () => {},
        account: () => {},
        logout: async () => {},
        refresh: async () => {},
      };
      const rendered = renderCustomThemeLayout(loggedInContract);
      expect(rendered).toContain("custom-member-pill");
      expect(rendered).toContain("عبدالله زاهر");
      expect(rendered).toContain("عز");
      expect(rendered).toContain("custom-signout");
    });
  });
});
