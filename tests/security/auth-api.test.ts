import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../apps/api/src/main";
import {
  getDbPool,
  closeDbPool,
  seedDatabase,
  runMigrations,
} from "@vibress/database";
import { DrizzleUserRepository, UsersService } from "@vibress/users";
import { DrizzleRoleRepository, RolesService } from "@vibress/roles";
import { hashPassword } from "@vibress/security";

describe("Auth & Authorization API Security", () => {
  let app: ReturnType<typeof buildApp>;
  let ownerUser: any;
  let limitedUser: any;
  const ownerPassword = "OwnerTestPassword123!";
  const limitedPassword = "LimitedUserPassword123!";

  beforeAll(async () => {
    await runMigrations();

    const pool = getDbPool();
    await pool.query(`
      TRUNCATE TABLE audit_events, sessions, role_permissions, user_roles, permissions, roles, users CASCADE;
    `);

    await seedDatabase();

    const userRepo = new DrizzleUserRepository();
    const roleRepo = new DrizzleRoleRepository();
    const usersService = new UsersService(userRepo);
    const rolesService = new RolesService(roleRepo);

    // Create Owner user
    const ownerHash = await hashPassword(ownerPassword);
    ownerUser = await usersService.createUser({
      email: "admin.owner@vibress.test",
      name: "Admin Owner",
      passwordHash: ownerHash,
      status: "active",
    });
    const ownerRole = await rolesService.findByKey("owner");
    await rolesService.assignRoleToUser(ownerUser.id, ownerRole!.id);

    // Create Limited user (Contributor role with no users.read permission)
    const limitedHash = await hashPassword(limitedPassword);
    limitedUser = await usersService.createUser({
      email: "limited.contributor@vibress.test",
      name: "Limited Contributor",
      passwordHash: limitedHash,
      status: "active",
    });
    const contribRole = await rolesService.findByKey("contributor");
    await rolesService.assignRoleToUser(limitedUser.id, contribRole!.id);

    app = buildApp();
    await app.ready();
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
    await closeDbPool();
  });

  it("login with valid credentials sets HttpOnly cookie and returns user summary", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      headers: {
        origin: "http://localhost:7777",
      },
      payload: {
        email: "admin.owner@vibress.test",
        password: ownerPassword,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.user.email).toBe("admin.owner@vibress.test");
    expect(body.user.roles).toContain("owner");

    const cookies = response.headers["set-cookie"];
    expect(cookies).toBeDefined();
    const cookieStr = Array.isArray(cookies)
      ? cookies.join(";")
      : (cookies as string);
    expect(cookieStr).toContain("vibress_session=");
    expect(cookieStr.toLowerCase()).toContain("httponly");
    expect(cookieStr.toLowerCase()).toContain("samesite=lax");
  });

  it("login with invalid password or non-existent email returns generic INVALID_CREDENTIALS", async () => {
    const res1 = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      payload: {
        email: "admin.owner@vibress.test",
        password: "WrongPassword123!",
      },
    });
    expect(res1.statusCode).toBe(401);
    expect(res1.json().errors[0].code).toBe("INVALID_CREDENTIALS");

    const res2 = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      payload: { email: "unknown@vibress.test", password: ownerPassword },
    });
    expect(res2.statusCode).toBe(401);
    expect(res2.json().errors[0].code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects state-changing requests with invalid external origin", async () => {
    // First login to get session cookie
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      payload: { email: "admin.owner@vibress.test", password: ownerPassword },
    });
    const cookieHeader = loginRes.headers["set-cookie"];

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/logout",
      headers: {
        cookie: cookieHeader as string,
        origin: "https://malicious-attacker-site.com",
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().errors[0].code).toBe("INVALID_ORIGIN");
  });

  it("returns current user identity on GET /api/admin/v1/auth/me", async () => {
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      payload: { email: "admin.owner@vibress.test", password: ownerPassword },
    });
    const cookieHeader = loginRes.headers["set-cookie"];

    const meRes = await app.inject({
      method: "GET",
      url: "/api/admin/v1/auth/me",
      headers: { cookie: cookieHeader as string },
    });

    expect(meRes.statusCode).toBe(200);
    const body = meRes.json();
    expect(body.user.email).toBe("admin.owner@vibress.test");
    expect(body.user.roles).toContain("owner");
  });

  const getCookieFromLogin = async (email: string, pass: string) => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      payload: { email, password: pass },
    });
    const cookieHeader = res.headers["set-cookie"];
    if (!cookieHeader)
      throw new Error("Login failed to return set-cookie header");
    return Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
  };

  it("enforces permission checks on protected endpoints", async () => {
    // 1. Unauthenticated request -> 401
    const unauthRes = await app.inject({
      method: "GET",
      url: "/api/admin/v1/users",
    });
    expect(unauthRes.statusCode).toBe(401);

    // 2. Owner user (has all permissions) -> 200
    const ownerCookie = await getCookieFromLogin(
      "admin.owner@vibress.test",
      ownerPassword,
    );

    const ownerUsersRes = await app.inject({
      method: "GET",
      url: "/api/admin/v1/users",
      headers: { cookie: ownerCookie },
    });
    expect(ownerUsersRes.statusCode).toBe(200);
    expect(ownerUsersRes.json().users).toBeDefined();

    // 3. Limited user without users.read permission -> 403
    const limitedCookie = await getCookieFromLogin(
      "limited.contributor@vibress.test",
      limitedPassword,
    );

    const limitedUsersRes = await app.inject({
      method: "GET",
      url: "/api/admin/v1/users",
      headers: { cookie: limitedCookie },
    });
    expect(limitedUsersRes.statusCode).toBe(403);
    expect(limitedUsersRes.json().errors[0].code).toBe("PERMISSION_DENIED");
  });

  it("revokes session on logout", async () => {
    const cookieHeader = await getCookieFromLogin(
      "admin.owner@vibress.test",
      ownerPassword,
    );

    const logoutRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/logout",
      headers: {
        cookie: cookieHeader,
        origin: "http://localhost:7777",
      },
    });
    expect(logoutRes.statusCode).toBe(200);

    // Using the old session cookie should now return 401
    const meRes = await app.inject({
      method: "GET",
      url: "/api/admin/v1/auth/me",
      headers: { cookie: cookieHeader },
    });
    expect(meRes.statusCode).toBe(401);
  });
});
