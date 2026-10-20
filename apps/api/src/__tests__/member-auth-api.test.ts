import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
import {
  DrizzleMemberRepository,
  DrizzleMemberAuthTokenRepository,
  DrizzleMemberSessionRepository,
  MemberAuthService,
} from "@vibress/members";
import { normalizeMemberEmail } from "@vibress/members";
import type { PluginApiRoute } from "@vibress/plugin-sdk";
import { MEMBER_COOKIE_NAME } from "../middleware/member-auth";
import { pluginsService, workspaceService } from "../services";

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

  it("extension member API rejects a member from another publication before plugin execution", async () => {
    const email = `ext-member-${Date.now()}@example.com`;
    await authService.requestAuthLink(email);
    const token = mailer.sent[mailer.sent.length - 1]!.magicLinkUrl.split("token=")[1]!;
    const { member, sessionToken } = await authService.verifyAndCreateSession(token);
    expect(member.publicationId).toBe("pub_default");
    const cookie = `${MEMBER_COOKIE_NAME}=${sessionToken}`;

    const handle = vi.fn(async (_input: unknown, scope: { publicationId: string; principal: { kind: string } }) => ({
      publication: scope.publicationId,
      principal: scope.principal.kind,
    }));
    const route: PluginApiRoute = {
      id: "courses", audience: "member", method: "GET",
      response: { fields: { publication: "string", principal: "string" } },
      handle,
    };
    const resolvePlugin = vi.spyOn(pluginsService, "resolveExtensionApiModule")
      .mockResolvedValue({ activate: async () => undefined, routes: [route] });
    const prepared = vi.spyOn(pluginsService, "prepareExtensionApiExecution")
      .mockResolvedValue(true);
    const resolvePublication = vi.spyOn(workspaceService, "resolvePublicPublicationContext");
    const url = "/api/members/v1/extensions/independent-courses/v1/courses";
    try {
      // Simulate a legitimate second publication selected by the host;
      // the authenticated member belongs to pub_default, not pub-other.
      resolvePublication.mockResolvedValue({
        publicationId: "pub-other", workspaceId: "ws-other",
        actorType: "public", isSystemOperation: false,
      });
      const wrongPublication = await app.inject({
        method: "GET", url, headers: { cookie },
      });
      expect(wrongPublication.statusCode).toBe(404);
      expect(resolvePlugin).not.toHaveBeenCalled();
      expect(handle).not.toHaveBeenCalled();

      resolvePublication.mockResolvedValue({
        publicationId: "pub_default", workspaceId: "ws_default",
        actorType: "public", isSystemOperation: false,
      });
      const valid = await app.inject({
        method: "GET", url, headers: { cookie },
      });
      expect(valid.statusCode).toBe(200);
      expect(valid.json()).toEqual({ publication: "pub_default", principal: "member" });
      expect(resolvePlugin).toHaveBeenCalledWith(
        "independent-courses", "pub_default", "extension.routes.member",
      );
      expect(handle).toHaveBeenCalledTimes(1);
      expect(prepared).toHaveBeenCalledTimes(1);
    } finally {
      prepared.mockRestore();
      resolvePublication.mockRestore();
      resolvePlugin.mockRestore();
    }
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
