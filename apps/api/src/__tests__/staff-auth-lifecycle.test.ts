import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
import { getDb, publicationMemberships, seedDatabase } from "@vibress/database";
import { and, eq } from "drizzle-orm";

describe("AUTH-01 & AUTH-02: Staff Identity Lifecycle & Password Recovery Suite", () => {
  let app: FastifyInstance;
  let ownerCookie: string;

  beforeAll(async () => {
    await seedDatabase();
    app = buildApp();
    await app.ready();

    // Login as default seeded owner
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      payload: {
        email: "owner@example.com",
        password: "OwnerPass123!",
      },
    });

    expect(loginRes.statusCode).toBe(200);
    const setCookie = loginRes.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    ownerCookie = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("AUTH-01: Staff Invitation Lifecycle", () => {
    const inviteEmail = `new-editor-${Date.now()}@example.com`;
    let invitationToken: string;
    let invitedUserId: string;

    it("allows owner/admin to invite a new staff member with a secure token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/v1/users/invite",
        headers: {
          cookie: ownerCookie,
          origin: "http://localhost:7779",
        },
        payload: {
          email: inviteEmail,
          name: "Alice Editor",
          roleKey: "editor",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.user.email).toBe(inviteEmail);
      expect(body.user.status).toBe("invited");
      expect(body.invitation.status).toBe("pending");
      expect(body.invitation.token).toBeDefined();
      invitationToken = body.invitation.token;
      invitedUserId = body.user.id;

      const memberships = await getDb()
        .select()
        .from(publicationMemberships)
        .where(
          and(
            eq(publicationMemberships.publicationId, "pub_default"),
            eq(publicationMemberships.userId, invitedUserId),
          ),
        );
      expect(memberships).toHaveLength(0);
    });

    it("rejects inviting an already active user with HTTP 409", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/v1/users/invite",
        headers: {
          cookie: ownerCookie,
          origin: "http://localhost:7779",
        },
        payload: {
          email: "owner@example.com",
          name: "Owner Again",
          roleKey: "editor",
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.errors[0].code).toBe("EMAIL_ALREADY_EXISTS");
    });

    it("allows resending an invitation to an invited staff user", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/v1/users/invite/resend",
        headers: {
          cookie: ownerCookie,
          origin: "http://localhost:7779",
        },
        payload: {
          email: inviteEmail,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.invitation.token).toBeDefined();
      // Update token to the freshly issued one
      invitationToken = body.invitation.token;
    });

    it("rejects acceptance with a malformed or invalid token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/invitation/accept",
        headers: {
          origin: "http://localhost:7779",
        },
        payload: {
          token: "invalid-non-existent-token",
          password: "NewSecurePassword123!",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.errors[0].code).toBe("INVALID_OR_EXPIRED_TOKEN");
    });

    it("successfully accepts invitation, sets password, and activates staff user", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/invitation/accept",
        headers: {
          origin: "http://localhost:7779",
        },
        payload: {
          token: invitationToken,
          password: "NewSecurePassword123!",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);

      const memberships = await getDb()
        .select()
        .from(publicationMemberships)
        .where(
          and(
            eq(publicationMemberships.publicationId, "pub_default"),
            eq(publicationMemberships.userId, invitedUserId),
          ),
        );
      expect(memberships).toHaveLength(1);
      expect(memberships[0]?.role).toBe("editor");
    });

    it("allows newly activated staff user to log in with their password", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/login",
        payload: {
          email: inviteEmail,
          password: "NewSecurePassword123!",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.user.email).toBe(inviteEmail);
      expect(body.user.status).toBe("active");
      expect(body.user.roles).toContain("editor");
    });

    it("does not grant publication access for a revoked invitation", async () => {
      const revokedEmail = `revoked-${Date.now()}@example.com`;
      const inviteRes = await app.inject({
        method: "POST",
        url: "/api/admin/v1/users/invite",
        headers: {
          cookie: ownerCookie,
          origin: "http://localhost:7779",
        },
        payload: {
          email: revokedEmail,
          name: "Revoked Author",
          roleKey: "author",
        },
      });
      expect(inviteRes.statusCode).toBe(201);
      const inviteBody = JSON.parse(inviteRes.body);
      const revokedUserId = inviteBody.user.id as string;
      const revokedToken = inviteBody.invitation.token as string;

      const revokeRes = await app.inject({
        method: "POST",
        url: "/api/admin/v1/users/invite/revoke",
        headers: {
          cookie: ownerCookie,
          origin: "http://localhost:7779",
        },
        payload: { email: revokedEmail },
      });
      expect(revokeRes.statusCode).toBe(200);

      const acceptRes = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/invitation/accept",
        headers: { origin: "http://localhost:7779" },
        payload: {
          token: revokedToken,
          password: "NeverActivated123!",
        },
      });
      expect(acceptRes.statusCode).toBe(400);
      expect(JSON.parse(acceptRes.body).errors[0].code).toBe(
        "INVITATION_REVOKED",
      );

      const memberships = await getDb()
        .select()
        .from(publicationMemberships)
        .where(
          and(
            eq(publicationMemberships.publicationId, "pub_default"),
            eq(publicationMemberships.userId, revokedUserId),
          ),
        );
      expect(memberships).toHaveLength(0);
    });

    it("rejects re-use of an already accepted invitation token (single-use)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/invitation/accept",
        headers: {
          origin: "http://localhost:7779",
        },
        payload: {
          token: invitationToken,
          password: "AnotherPassword123!",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.errors[0].code).toBe("TOKEN_ALREADY_USED");
    });
  });

  describe("AUTH-02: Staff Password Recovery", () => {
    const staffEmail = `reset-staff-${Date.now()}@example.com`;
    let staffSessionCookie: string;
    let resetToken: string;

    beforeAll(async () => {
      // Create and activate staff member
      const inviteRes = await app.inject({
        method: "POST",
        url: "/api/admin/v1/users/invite",
        headers: {
          cookie: ownerCookie,
          origin: "http://localhost:7779",
        },
        payload: {
          email: staffEmail,
          name: "Bob Author",
          roleKey: "author",
        },
      });
      const inviteBody = JSON.parse(inviteRes.body);

      await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/invitation/accept",
        headers: { origin: "http://localhost:7779" },
        payload: {
          token: inviteBody.invitation.token,
          password: "OldPassword123!",
        },
      });

      // Login to get active session
      const loginRes = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/login",
        payload: {
          email: staffEmail,
          password: "OldPassword123!",
        },
      });
      const setCookie = loginRes.headers["set-cookie"];
      staffSessionCookie = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string);
    });

    it("rejects malformed recovery request data before hashing", async () => {
      const invalidReset = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/reset-password",
        headers: { origin: "http://localhost:7779" },
        payload: { token: ["malformed"], password: { invalid: true } },
      });
      expect(invalidReset.statusCode).toBe(400);
      expect(invalidReset.json().errors[0].code).toBe("VALIDATION_ERROR");

      const invalidEmail = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/forgot-password",
        headers: { origin: "http://localhost:7779" },
        payload: { email: ["bad-email"] },
      });
      expect(invalidEmail.statusCode).toBe(400);
    });

    it("returns timing-safe generic response for non-existent email (enumeration resistant)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/forgot-password",
        headers: { origin: "http://localhost:7779" },
        payload: { email: `nobody-exists-${Date.now()}@example.com` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.message).toContain("If that email address is registered");
    });

    it("generates secure reset token for active staff member", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/forgot-password",
        headers: { origin: "http://localhost:7779" },
        payload: { email: staffEmail },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.token).toBeDefined();
      resetToken = body.token;
    });

    it("successfully resets password and revokes all active prior sessions", async () => {
      // 1. Verify session is active before reset
      const meBefore = await app.inject({
        method: "GET",
        url: "/api/admin/v1/auth/me",
        headers: { cookie: staffSessionCookie },
      });
      expect(meBefore.statusCode).toBe(200);

      // 2. Execute password reset
      const resetRes = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/reset-password",
        headers: { origin: "http://localhost:7779" },
        payload: {
          token: resetToken,
          password: "BrandNewPassword456!",
        },
      });

      expect(resetRes.statusCode).toBe(200);
      const resetBody = JSON.parse(resetRes.body);
      expect(resetBody.success).toBe(true);

      // 3. Verify prior session is now invalidated
      const meAfter = await app.inject({
        method: "GET",
        url: "/api/admin/v1/auth/me",
        headers: { cookie: staffSessionCookie },
      });
      expect(meAfter.statusCode).toBe(401);

      // 4. Verify login works with new password
      const newLogin = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/login",
        payload: {
          email: staffEmail,
          password: "BrandNewPassword456!",
        },
      });
      expect(newLogin.statusCode).toBe(200);
    });

    it("invalidates all other outstanding tokens for the same account", async () => {
      const headers = { origin: "http://localhost:7779" };
      const first = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/forgot-password",
        headers,
        payload: { email: staffEmail },
      });
      const second = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/forgot-password",
        headers,
        payload: { email: staffEmail },
      });
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      const firstToken: string = first.json().token;
      const secondToken: string = second.json().token;

      const redeemed = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/reset-password",
        headers,
        payload: { token: firstToken, password: "NewAgainPassword123!" },
      });
      expect(redeemed.statusCode).toBe(200);

      const blocked = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/reset-password",
        headers,
        payload: { token: secondToken, password: "ShouldNotWork123!" },
      });
      expect(blocked.statusCode).toBe(400);
      expect(blocked.json().errors[0].code).toBe("TOKEN_ALREADY_USED");
    });

    it("serializes simultaneous resets using two different tokens", async () => {
      const headers = { origin: "http://localhost:7779" };
      const issue = () => app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/forgot-password",
        headers,
        payload: { email: staffEmail },
      });
      const [first, second] = await Promise.all([issue(), issue()]);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      const [a, b] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/api/admin/v1/auth/reset-password",
          headers,
          payload: { token: first.json().token, password: "ConcurrentA123!" },
        }),
        app.inject({
          method: "POST",
          url: "/api/admin/v1/auth/reset-password",
          headers,
          payload: { token: second.json().token, password: "ConcurrentB123!" },
        }),
      ]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 400]);
      const rejected = a.statusCode === 400 ? a : b;
      expect(rejected.json().errors[0].code).toBe("TOKEN_ALREADY_USED");
    });

    it("rejects reused password reset token (single-use guarantee)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/v1/auth/reset-password",
        headers: { origin: "http://localhost:7779" },
        payload: {
          token: resetToken,
          password: "AnotherPassword789!",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.errors[0].code).toBe("TOKEN_ALREADY_USED");
    });
  });
});
