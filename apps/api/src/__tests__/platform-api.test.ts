import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
import { getDb, publications, publicationMemberships, workspaces, users } from "@vibress/database";
import { eq } from "drizzle-orm";
import { hashPassword } from "@vibress/security";
import { SDK_VERSION } from "@vibress/plugin-sdk";
import type { PluginApiRoute, PluginApiScope, PluginStorageApi, PluginModule } from "@vibress/plugin-sdk";
import { PluginDomainError, pluginPhysicalModelDigest } from "@vibress/plugins";
import { pluginsService, workspaceService, publicationLocaleService } from "../services";

async function loginStaff(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/admin/v1/auth/login",
    payload: { email: "owner@example.com", password: "OwnerPass123!" },
  });
  expect(res.statusCode).toBe(200);
  const setCookie = (res.headers["set-cookie"] as unknown as string) || "";
  return setCookie.split(";")[0] ?? "";
}

async function ensureOwner(): Promise<void> {
  const db = getDb();
  const { users, userRoles, roles } = await import("@vibress/database");
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, "owner@example.com"))
    .limit(1);
  if (rows.length > 0) return;
  const hash = await hashPassword("OwnerPass123!");
  const ownerId = crypto.randomUUID();
  await db
    .insert(users)
    .values({
      id: ownerId,
      email: "owner@example.com",
      name: "Owner",
      slug: "e2e-owner",
      passwordHash: hash,
      status: "active",
    })
    .onConflictDoNothing();
  const ownerRole = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, "owner"))
    .limit(1);
  if (ownerRole[0])
    await db
      .insert(userRoles)
      .values({ userId: ownerId, roleId: ownerRole[0].id });
}

describe("Batch 12 — Platform Integration & Security", () => {
  let app: FastifyInstance;
  let staffCookie: string;

  beforeAll(async () => {
    process.env.VIBRESS_ENCRYPTION_KEY =
      process.env.VIBRESS_ENCRYPTION_KEY || "test-encryption-key-for-batch-12";
    app = buildApp();
    await app.ready();
    await ensureOwner();
    staffCookie = await loginStaff(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------- Integrations ----------------
  it("admin creates an integration (secrets encrypted at rest)", async () => {
    const key = `ci-${Date.now()}`;
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/integrations",
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      payload: {
        key,
        type: "external",
        name: "CI Integration",
        secrets: { apiToken: "top-secret" },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    // Masked — no raw secret in response
    expect(JSON.stringify(body)).not.toContain("top-secret");
    expect(body.integration.secrets.apiToken).toBe("••••••••");

    // Encrypted in DB (not plaintext)
    const db = getDb();
    const { integrations } = await import("@vibress/database");
    const rows = await db
      .select()
      .from(integrations)
      .where(eq(integrations.key, key))
      .limit(1);
    expect(rows.length).toBe(1);
    expect(rows[0]!.encryptedSecrets).toBeDefined();
  });

  it("integration routes require staff auth (401)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/integrations",
    });
    expect(res.statusCode).toBe(401);
  });

  it("member cookie cannot access admin platform routes", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/integrations",
      headers: { cookie: "vibress_member_session=forged" },
    });
    expect(res.statusCode).toBe(401);
  });

  // ---------------- API Keys ----------------
  it("creates an API key: raw secret returned once, hash stored", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/api-keys",
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      payload: { name: "CI token", scopes: ["content.read"] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.key.secret.startsWith("vk_")).toBe(true);
    expect(body.key.prefix).toBeTruthy();

    // Raw secret is NOT in the DB — only a hash
    const db = getDb();
    const { apiKeys } = await import("@vibress/database");
    const rows = await db.select().from(apiKeys);
    expect(rows.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(body.key.secret);
    // The full raw secret has two underscore-separated parts beyond the prefix
    expect(body.key.secret.split("_").length).toBeGreaterThan(2);
    const fullSecretParts = body.key.secret.split("_");
    const secretOnlyPart = fullSecretParts.slice(2).join("_");
    expect(serialized).not.toContain(secretOnlyPart);
    // Hash present, raw secret absent
    expect(serialized).toContain("keyHash");
  });

  it("machine endpoint authenticates with a valid key", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/api-keys",
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      payload: { name: "Machine A", scopes: ["content.read"] },
    });
    const secret = createRes.json().key.secret;

    const res = await app.inject({
      method: "GET",
      url: "/api/machine/v1/status",
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("machine endpoint rejects an invalid key with a generic response", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/machine/v1/status",
      headers: { authorization: "Bearer vk_invalid_doesnotexist" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("scope enforcement: key without the required scope gets 403", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/api-keys",
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      payload: { name: "Limited", scopes: ["webhooks.register"] },
    });
    const secret = createRes.json().key.secret;

    // /machine/events requires content.read → denied
    const res = await app.inject({
      method: "POST",
      url: "/api/machine/v1/events",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().errors[0].code).toBe("SCOPE_DENIED");
  });

  it("revoked key is rejected", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/api-keys",
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      payload: { name: "To revoke", scopes: ["content.read"] },
    });
    const keyId = createRes.json().key.id;
    const secret = createRes.json().key.secret;

    const revokeRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/api-keys/${keyId}/revoke`,
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
    });
    expect(revokeRes.statusCode).toBe(200);

    const res = await app.inject({
      method: "GET",
      url: "/api/machine/v1/status",
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("API key routes require RBAC (401 unauth, staff cookie only)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/api-keys",
    });
    expect(res.statusCode).toBe(401);
  });

  // ---------------- Outbound Webhooks ----------------
  it("webhook endpoint registration rejects localhost (SSRF)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/webhook-endpoints",
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      payload: {
        name: "Bad",
        url: "http://localhost:9999/hook",
        eventTypes: ["comment.created"],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe("UNSAFE_URL");
  });

  it("webhook endpoint registration rejects private IPs (SSRF)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/webhook-endpoints",
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      payload: {
        name: "Bad",
        url: "http://192.168.1.10/hook",
        eventTypes: ["comment.created"],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe("UNSAFE_URL");
  });

  it("webhook endpoint registration accepts a public URL and encrypts the secret", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/webhook-endpoints",
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      payload: {
        name: "Public receiver",
        url: "https://receiver.example.com/hook",
        secret: "hook-secret-123",
        eventTypes: ["comment.created"],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.endpoint.hasSecret).toBe(true);
    expect(JSON.stringify(body)).not.toContain("hook-secret-123");

    // Encrypted in DB
    const db = getDb();
    const { webhookEndpoints } = await import("@vibress/database");
    const rows = await db.select().from(webhookEndpoints);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("hook-secret-123");
  });

  it("webhook endpoint routes require RBAC (401 unauth)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/webhook-endpoints",
    });
    expect(res.statusCode).toBe(401);
  });

  // ---------------- Host-rendered extension views ----------------
  it("denies unauthenticated and Member sessions from Studio view discovery", async () => {
    const url = "/api/admin/v1/extensions/navigation";
    const unauthenticated = await app.inject({ method: "GET", url });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json().errors[0].code).toBe("AUTHENTICATION_REQUIRED");

    const memberOnly = await app.inject({
      method: "GET", url, headers: { cookie: "vibress_member_session=forged" },
    });
    expect(memberOnly.statusCode).toBe(401);
  });

  it("returns only Host-filtered Studio navigation without cacheable content", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/extensions/navigation",
      headers: { cookie: staffCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json()).toHaveProperty("items");
    expect(Array.isArray(res.json().items)).toBe(true);
    for (const item of res.json().items) {
      expect(item).toEqual({
        pluginId: expect.stringMatching(/^[a-z0-9][a-z0-9-]*$/),
        viewId: expect.stringMatching(/^[a-z][a-z0-9-]*$/),
        routeId: expect.stringMatching(/^[a-z][a-z0-9-]*$/),
        title: { en: expect.any(String), ar: expect.any(String) },
        label: { en: expect.any(String), ar: expect.any(String) },
        permission: expect.stringMatching(/^(plugins|posts)\.(read|manage|edit)$/),
      });
    }
  });

  it("isolates broken plugins, caches admitted descriptors and rechecks enablement", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "");
    const goodId = `good-${suffix}`;
    const badId = `bad-${suffix}`;
    const unavailableId = `unavailable-${suffix}`;
    const plugin = (manifestId: string) => ({
      id: manifestId, manifestId, name: manifestId, version: "1.0.0",
      vibressApiVersion: SDK_VERSION, description: null, entrypoint: "index.mjs",
      capabilities: ["admin.navigation", "extension.routes.admin"],
      status: "active" as const, settingsSchema: {}, hooks: [],
      createdAt: new Date(), updatedAt: new Date(),
      publicationScoped: true, publicationEnabled: true,
    });
    const label = { en: "Courses", ar: "الدورات" };
    const handle = vi.fn(async () => ({ total: 2 }));
    const working: PluginModule = {
      activate() {},
      routes: [{
        id: "course-list", audience: "admin", method: "GET",
        permission: "plugins.read", response: { fields: { total: "number" } }, handle,
      }],
      adminViews: [{ id: "courses", routeId: "course-list", title: label }],
      adminNavigation: [{ viewId: "courses", label, permission: "plugins.read" }],
    };
    const invalid: PluginModule = {
      ...working,
      adminNavigation: [{ viewId: "missing", label, permission: "plugins.read" }],
    };
    let goodEnabled = true;
    let digest = "a".repeat(64);
    const list = vi.spyOn(pluginsService, "listPluginsForPublication")
      .mockImplementation(async () => [
        { ...plugin(goodId), publicationEnabled: goodEnabled },
        plugin(badId), plugin(unavailableId),
      ]);
    const fingerprints = vi.spyOn(pluginsService, "listOperatorAdminFingerprints")
      .mockImplementation(async () => new Map([
        [goodId, digest], [badId, "b".repeat(64)], [unavailableId, "c".repeat(64)],
      ]));
    const resolve = vi.spyOn(pluginsService, "resolveExtensionApiModule")
      .mockImplementation(async (manifestId) => {
        if (manifestId === goodId) return working;
        if (manifestId === badId) return invalid;
        throw new Error("operator plugin fault: secret must not escape");
      });
    const prepared = vi.spyOn(pluginsService, "prepareExtensionApiExecution")
      .mockImplementation(async () => goodEnabled);
    const discover = () => app.inject({
      method: "GET", url: "/api/admin/v1/extensions/navigation",
      headers: { cookie: staffCookie },
    });
    try {
      const [initial, repeated] = await Promise.all([discover(), discover()]);
      expect(initial.statusCode).toBe(200);
      expect(initial.json().items).toEqual([{
        pluginId: goodId, viewId: "courses", routeId: "course-list",
        title: label, label, permission: "plugins.read",
      }]);
      expect(repeated.statusCode).toBe(200);
      expect(repeated.json()).toEqual(initial.json());
      expect(resolve).toHaveBeenCalledTimes(3); // coalesced pinned metadata
      expect(fingerprints).toHaveBeenCalledTimes(2);

      const view = await app.inject({
        method: "GET",
        url: `/api/admin/v1/extensions/${goodId}/v1/course-list`,
        headers: { cookie: staffCookie },
      });
      expect(view.statusCode).toBe(200);
      expect(view.json()).toEqual({ total: 2 });
      expect(handle).toHaveBeenCalledTimes(1);

      goodEnabled = false;
      const disabled = await discover();
      expect(disabled.statusCode).toBe(200);
      expect(disabled.json().items).toEqual([]);
      const forbiddenView = await app.inject({
        method: "GET",
        url: `/api/admin/v1/extensions/${goodId}/v1/course-list`,
        headers: { cookie: staffCookie },
      });
      expect(forbiddenView.statusCode).toBe(404);
      expect(handle).toHaveBeenCalledTimes(1);

      goodEnabled = true;
      digest = "d".repeat(64);
      const rotated = await discover();
      expect(rotated.statusCode).toBe(200);
      expect(rotated.json().items).toHaveLength(1);
      expect(resolve).toHaveBeenCalledTimes(6); // two Admin GETs + new pinned hash
      const forged = await app.inject({
        method: "GET", url: "/api/admin/v1/extensions/navigation",
        headers: { cookie: staffCookie, "x-publication-id": crypto.randomUUID() },
      });
      expect(forged.statusCode).toBe(403);
    } finally {
      prepared.mockRestore();
      resolve.mockRestore();
      fingerprints.mockRestore();
      list.mockRestore();
    }
  });

  // ---------------- EXT-301B2 authorized Admin UI bytes ----------------
  it("requires Staff auth before reading any Admin UI document", async () => {
    const url = "/api/admin/v1/extensions/example/views/courses/ui";
    const unauthenticated = await app.inject({ method: "GET", url });
    expect(unauthenticated.statusCode).toBe(401);
    const memberCookie = await app.inject({
      method: "GET", url, headers: { cookie: "vibress_member_session=forged" },
    });
    expect(memberCookie.statusCode).toBe(401);
    const malformed = await app.inject({
      method: "GET",
      url: "/api/admin/v1/extensions/example/views/%2e%2e/ui",
      headers: { cookie: staffCookie },
    });
    expect(malformed.statusCode).not.toBe(200);
  });

  it("serves operator-verified Admin UI only as no-store inert JSON for an admitted view", async () => {
    const pluginId = `verified-ui-${crypto.randomUUID().replaceAll("-", "")}`;
    const label = { en: "Courses", ar: "الدورات" };
    const html = '<main lang="ar" dir="rtl"><button type="button">الدورات</button></main>';
    const module: PluginModule = {
      activate() {},
      routes: [{
        id: "course-list", audience: "admin", method: "GET",
        permission: "plugins.read", response: { fields: { total: "number" } },
        handle: () => ({ total: 1 }),
      }],
      adminViews: [{ id: "courses", routeId: "course-list", title: label }],
      adminNavigation: [{ viewId: "courses", label, permission: "plugins.read" }],
    };
    const resolve = vi.spyOn(pluginsService, "resolveExtensionApiModule")
      .mockResolvedValue(module);
    const read = vi.spyOn(pluginsService, "readExtensionAdminUiAsset")
      .mockResolvedValue(html);
    const url = `/api/admin/v1/extensions/${pluginId}/views/courses/ui`;
    try {
      const response = await app.inject({
        method: "GET", url, headers: { cookie: staffCookie },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      expect(response.json()).toEqual({
        html, sha256: crypto.createHash("sha256").update(html).digest("hex"),
      });
      expect(read).toHaveBeenCalledWith(pluginId, expect.any(String), "courses");
      const wrongView = await app.inject({
        method: "GET",
        url: `/api/admin/v1/extensions/${pluginId}/views/other/ui`,
        headers: { cookie: staffCookie },
      });
      expect(wrongView.statusCode).toBe(404);
      expect(read).toHaveBeenCalledTimes(1);
      const forgedPublication = await app.inject({
        method: "GET", url,
        headers: { cookie: staffCookie, "x-publication-id": crypto.randomUUID() },
      });
      expect(forgedPublication.statusCode).toBe(403);
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      read.mockRestore();
      resolve.mockRestore();
    }
  });

  it("fails closed on disabled modules, corrupt views, tampered artifacts and oversized output", async () => {
    const pluginId = `failed-ui-${crypto.randomUUID().replaceAll("-", "")}`;
    const label = { en: "Courses", ar: "الدورات" };
    const good: PluginModule = {
      activate() {},
      routes: [{
        id: "list", audience: "admin", method: "GET",
        permission: "plugins.read", response: { fields: {} },
        handle: () => ({}),
      }],
      adminViews: [{ id: "courses", routeId: "list", title: label }],
      adminNavigation: [{ viewId: "courses", label, permission: "plugins.read" }],
    };
    const resolve = vi.spyOn(pluginsService, "resolveExtensionApiModule")
      .mockResolvedValue(null);
    const read = vi.spyOn(pluginsService, "readExtensionAdminUiAsset")
      .mockResolvedValue("<main>Approved</main>");
    const url = `/api/admin/v1/extensions/${pluginId}/views/courses/ui`;
    const request = () => app.inject({ method: "GET", url, headers: { cookie: staffCookie } });
    try {
      expect((await request()).statusCode).toBe(404);
      expect(read).not.toHaveBeenCalled();
      resolve.mockResolvedValue({ ...good, adminNavigation: undefined });
      expect((await request()).statusCode).toBe(503);
      expect(read).not.toHaveBeenCalled();
      resolve.mockResolvedValue(good);
      read.mockResolvedValue(null);
      expect((await request()).statusCode).toBe(404);
      read.mockRejectedValue(new Error("Operator path with secret"));
      const failure = await request();
      expect(failure.statusCode).toBe(503);
      expect(JSON.stringify(failure.json())).not.toContain("Operator path with secret");
      read.mockRejectedValue(new PluginDomainError(
        "PLUGIN_PUBLICATION_INACTIVE", "Publication disabled during UI read",
      ));
      expect((await request()).statusCode).toBe(404);
      read.mockResolvedValue("x".repeat(256 * 1024 + 1));
      expect((await request()).statusCode).toBe(503);
    } finally {
      read.mockRestore();
      resolve.mockRestore();
    }
  });

  // ---------------- EXT-301B2B one-time opaque frame delivery ----------------
  it("issues one-use Admin frame tickets and serves restrictive-CSP, opaque-origin HTML", async () => {
    const pluginId = `frame-ui-${crypto.randomUUID().replaceAll("-", "")}`;
    const label = { en: "Courses", ar: "الدورات" };
    const html = '<main lang="ar" dir="rtl"><button id="lesson">الدورات</button><script>document.querySelector("#lesson").addEventListener("click",()=>document.body.dataset.clicked="1")</script></main>';
    const module: PluginModule = {
      activate() {},
      routes: [{
        id: "course-list", audience: "admin", method: "GET", permission: "plugins.read",
        response: { fields: { total: "number" } }, handle: () => ({ total: 1 }),
      }],
      adminViews: [{ id: "courses", routeId: "course-list", title: label }],
      adminNavigation: [{ viewId: "courses", label, permission: "plugins.read" }],
    };
    const resolve = vi.spyOn(pluginsService, "resolveExtensionApiModule").mockResolvedValue(module);
    const read = vi.spyOn(pluginsService, "readExtensionAdminUiAsset").mockResolvedValue(html);
    const base = `/api/admin/v1/extensions/${pluginId}/views/courses`;
    try {
      expect((await app.inject({ method: "POST", url: base + "/frame-ticket" })).statusCode).toBe(401);
      const issue = await app.inject({
        method: "POST", url: base + "/frame-ticket",
        headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      });
      expect(issue.statusCode).toBe(200);
      expect(issue.headers["cache-control"]).toBe("no-store");
      expect(issue.json().bridgeNonce).toMatch(/^[a-f0-9]{64}$/);
      expect(issue.json().sha256).toBe(crypto.createHash("sha256").update(html).digest("hex"));
      const status = await app.inject({
        method: "GET", url: base + "/frame-status",
        headers: { cookie: staffCookie },
      });
      expect(status.statusCode).toBe(200);
      expect(status.headers["cache-control"]).toBe("no-store");
      expect(status.json()).toEqual({ sha256: issue.json().sha256 });
      expect((await app.inject({
        method: "GET", url: base + "/frame-status",
      })).statusCode).toBe(401);
      const src: unknown = issue.json().src;
      expect(src).toEqual(expect.stringMatching(new RegExp(`^\\/api\\/admin\\/v1\\/extensions\\/${pluginId}\\/views\\/courses\\/frame\\?ticket=[a-f0-9]{64}$`)));
      if (typeof src !== "string") throw new Error("Frame URL not provided");
      const frame = await app.inject({ method: "GET", url: src, headers: { cookie: staffCookie } });
      expect(frame.statusCode).toBe(200);
      expect(frame.headers["content-type"]).toContain("text/html");
      expect(frame.headers["cache-control"]).toBe("private, no-store");
      expect(frame.headers["x-frame-options"]).toBe("SAMEORIGIN");
      const csp = String(frame.headers["content-security-policy"]);
      expect(csp).toContain("sandbox allow-scripts");
      expect(csp).not.toContain("allow-same-origin");
      expect(csp).toContain("connect-src 'none'");
      expect(csp).toContain("frame-ancestors 'self'");
      expect(csp).toContain("form-action 'none'");
      expect(frame.headers["referrer-policy"]).toBe("no-referrer");
      expect(frame.body).toContain(html);
      expect(frame.body).toContain(issue.json().bridgeNonce);
      expect(frame.body).toContain("vibress:extension:ready");
      expect(frame.body).toContain("vibress:extension:gone");
      expect(frame.body).not.toContain(staffCookie);
      expect(read).toHaveBeenCalledTimes(3);
      expect((await app.inject({
        method: "GET", url: src, headers: { cookie: staffCookie },
      })).statusCode).toBe(404);
      expect(read).toHaveBeenCalledTimes(3);
    } finally {
      read.mockRestore();
      resolve.mockRestore();
    }
  });

  it("rejects stolen frame tickets, changed artifacts and disabled plugin views", async () => {
    const pluginId = `frame-denial-${crypto.randomUUID().replaceAll("-", "")}`;
    const label = { en: "Courses", ar: "الدورات" };
    const module: PluginModule = {
      activate() {},
      routes: [{
        id: "course-list", audience: "admin", method: "GET", permission: "plugins.read",
        response: { fields: {} }, handle: () => ({}),
      }],
      adminViews: [{ id: "courses", routeId: "course-list", title: label }],
      adminNavigation: [{ viewId: "courses", label, permission: "plugins.read" }],
    };
    const resolve = vi.spyOn(pluginsService, "resolveExtensionApiModule").mockResolvedValue(module);
    const read = vi.spyOn(pluginsService, "readExtensionAdminUiAsset").mockResolvedValue("<main>Version A</main>");
    const url = `/api/admin/v1/extensions/${pluginId}/views/courses/frame-ticket`;
    const issue = () => app.inject({
      method: "POST", url,
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
    });
    try {
      const first = await issue();
      expect(first.statusCode).toBe(200);
      const src = first.json().src as string;
      const crossSite = await app.inject({
        method: "GET", url: src, headers: { "sec-fetch-site": "cross-site" },
      });
      expect(crossSite.statusCode).toBe(404);
      const topLevel = await app.inject({
        method: "GET", url: src,
        headers: { "sec-fetch-site": "same-origin", "sec-fetch-dest": "document" },
      });
      expect(topLevel.statusCode).toBe(404);
      // SameSite=Lax cookies may be omitted for sandboxed opaque-origin
      // navigations. The one-use ticket still binds the *live* Staff session.
      const frameNoCookie = await app.inject({ method: "GET", url: src });
      expect(frameNoCookie.statusCode).toBe(200);
      // Even valid cookies cannot reuse the consumed ticket.
      expect((await app.inject({
        method: "GET", url: src, headers: { cookie: staffCookie },
      })).statusCode).toBe(404);

      const wrongSession = await issue();
      const anotherStaffCookie = await loginStaff(app);
      expect((await app.inject({
        method: "GET", url: wrongSession.json().src,
        headers: { cookie: anotherStaffCookie },
      })).statusCode).toBe(401);

      // A valid one-time ticket cannot revive a logged-out Staff session.
      const temporaryCookie = await loginStaff(app);
      const temporary = await app.inject({
        method: "POST", url,
        headers: { cookie: temporaryCookie, origin: "http://localhost:7777" },
      });
      expect(temporary.statusCode).toBe(200);
      const logout = await app.inject({
        method: "POST", url: "/api/admin/v1/auth/logout",
        headers: { cookie: temporaryCookie, origin: "http://localhost:7777" },
      });
      expect(logout.statusCode).toBe(200);
      expect((await app.inject({
        method: "GET", url: temporary.json().src,
      })).statusCode).toBe(401);

      const second = await issue();
      read.mockResolvedValue("<main>Version B</main>");
      expect((await app.inject({
        method: "GET", url: second.json().src,
        headers: { cookie: staffCookie },
      })).statusCode).toBe(404);

      read.mockResolvedValue("<main>Version A</main>");
      const third = await issue();
      resolve.mockResolvedValue(null);
      expect((await app.inject({
        method: "GET", url: third.json().src, headers: { cookie: staffCookie },
      })).statusCode).toBe(404);
      expect((await app.inject({
        method: "GET",
        url: `/api/admin/v1/extensions/${pluginId}/views/courses/frame-status`,
        headers: { cookie: staffCookie },
      })).statusCode).toBe(404);
    } finally {
      read.mockRestore();
      resolve.mockRestore();
    }
  });

  // ---------------- Plugins ----------------
  it("registers the official example plugin (valid manifest)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/plugins/register",
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      payload: {
        manifest: {
          id: "vibress-content-metrics",
          name: "Content Metrics Logger",
          version: "1.0.0",
          vibressApiVersion: SDK_VERSION,
          entrypoint: "index.ts",
          capabilities: [
            "events.subscribe",
            "settings.read-own",
            "settings.write-own",
          ],
          settingsSchema: {
            logLevel: { type: "string", secret: false },
            webhookUrl: { type: "string", secret: true },
          },
        },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().plugin.manifestId).toBe("vibress-content-metrics");
    expect(["registered", "active", "inactive", "error"]).toContain(
      res.json().plugin.status,
    );
  });

  it("rejects a plugin with an unsupported API version", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/plugins/register",
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      payload: {
        manifest: {
          id: "bad-plugin",
          name: "Bad",
          version: "1.0.0",
          vibressApiVersion: "9.9.9",
          entrypoint: "x.ts",
          capabilities: [],
        },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe("INVALID_MANIFEST");
  });

  it("rejects a plugin with an unknown capability", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/plugins/register",
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      payload: {
        manifest: {
          id: "evil-plugin",
          name: "Evil",
          version: "1.0.0",
          vibressApiVersion: SDK_VERSION,
          entrypoint: "x.ts",
          capabilities: ["all-access"],
        },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe("INVALID_MANIFEST");
  });

  it("activates the official plugin (proves SDK/lifecycle boundary)", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: "/api/admin/v1/plugins",
      headers: { cookie: staffCookie },
    });
    const plugin = listRes
      .json()
      .plugins.find((p: any) => p.manifestId === "vibress-content-metrics");
    expect(plugin).toBeTruthy();

    const res = await app.inject({
      method: "POST",
      url: `/api/admin/v1/plugins/${plugin.id}/activate`,
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().plugin.status).toBe("active");
  });

  it("plugin settings: secret stored encrypted and masked on read", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: "/api/admin/v1/plugins",
      headers: { cookie: staffCookie },
    });
    const plugin = listRes
      .json()
      .plugins.find((p: any) => p.manifestId === "vibress-content-metrics");

    const setRes = await app.inject({
      method: "POST",
      url: `/api/admin/v1/plugins/${plugin.id}/settings`,
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      payload: {
        settings: { webhookUrl: "https://secret-endpoint.example.com" },
      },
    });
    expect(setRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: "GET",
      url: `/api/admin/v1/plugins/${plugin.id}/settings`,
      headers: { cookie: staffCookie },
    });
    expect(getRes.statusCode).toBe(200);
    const settings = getRes.json().settings;
    const secret = settings.find((s: any) => s.key === "webhookUrl");
    expect(secret.masked).toBe(true);
    expect(JSON.stringify(getRes.json())).not.toContain(
      "secret-endpoint.example.com",
    );

    // Encrypted in DB
    const db = getDb();
    const { pluginSettings } = await import("@vibress/database");
    const rows = await db.select().from(pluginSettings);
    expect(JSON.stringify(rows)).not.toContain("secret-endpoint.example.com");
  });

  it("plugin routes require RBAC (401 unauth)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/plugins",
    });
    expect(res.statusCode).toBe(401);
  });

  it("plugin deactivation works", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: "/api/admin/v1/plugins",
      headers: { cookie: staffCookie },
    });
    const plugin = listRes
      .json()
      .plugins.find((p: any) => p.manifestId === "vibress-content-metrics");
    const res = await app.inject({
      method: "POST",
      url: `/api/admin/v1/plugins/${plugin.id}/deactivate`,
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().plugin.status).toBe("inactive");
  });

  it("plugin lifecycle recovery: recovers stuck activating plugin to error", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: "/api/admin/v1/plugins",
      headers: { cookie: staffCookie },
    });
    const plugin = listRes
      .json()
      .plugins.find((p: any) => p.manifestId === "vibress-content-metrics");

    // Manually simulate crash during activation
    const db = getDb();
    const { plugins } = await import("@vibress/database");
    await db.update(plugins).set({
      status: "activating",
      updatedAt: new Date(Date.now() - 20 * 60 * 1000),
    }).where(eq(plugins.id, plugin.id));

    const denied = await app.inject({
      method: "POST",
      url: `/api/admin/v1/plugins/${plugin.id}/recover`,
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      payload: { confirmAllRuntimesStopped: true },
    });
    expect(denied.statusCode).toBe(409);
    expect(denied.json().errors[0].code).toBe("PLUGIN_RECOVERY_NOT_QUIESCENT");

    vi.stubEnv("VIBRESS_PLUGIN_RECOVERY_MAINTENANCE", "1");
    try {
      const recRes = await app.inject({
        method: "POST",
        url: `/api/admin/v1/plugins/${plugin.id}/recover`,
        headers: { cookie: staffCookie, origin: "http://localhost:7777" },
        payload: { confirmAllRuntimesStopped: true },
      });
      expect(recRes.statusCode).toBe(200);
      expect(recRes.json().plugin.status).toBe("error");
    } finally {
      vi.unstubAllEnvs();
    }

    // Clean up back to inactive
    await db.update(plugins).set({ status: "inactive" }).where(eq(plugins.id, plugin.id));
  });

  it("plugin lifecycle recovery: rejects missing operator confirmation", async () => {
    const list = await app.inject({
      method: "GET", url: "/api/admin/v1/plugins", headers: { cookie: staffCookie },
    });
    const plugin = list.json().plugins.find(
      (value: { manifestId: string }) => value.manifestId === "vibress-content-metrics",
    );
    const response = await app.inject({
      method: "POST",
      url: `/api/admin/v1/plugins/${plugin.id}/recover`,
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().errors[0].code).toBe("VALIDATION_ERROR");
  });

  it("plugin lifecycle recovery: rejects recovery on non-transitional status with 409", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: "/api/admin/v1/plugins",
      headers: { cookie: staffCookie },
    });
    const plugin = listRes
      .json()
      .plugins.find((p: any) => p.manifestId === "vibress-content-metrics");

    vi.stubEnv("VIBRESS_PLUGIN_RECOVERY_MAINTENANCE", "1");
    try {
      const recRes = await app.inject({
        method: "POST",
        url: `/api/admin/v1/plugins/${plugin.id}/recover`,
        headers: { cookie: staffCookie, origin: "http://localhost:7777" },
        payload: { confirmAllRuntimesStopped: true },
      });
      expect(recRes.statusCode).toBe(409);
      expect(recRes.json().errors[0].code).toBe("PLUGIN_NOT_IN_TRANSITION");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("operator gate: editor without platform operator access is denied lifecycle operations", async () => {
    // Log in as editor
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      payload: { email: "editor@vibress.local", password: "DevPassword123!" },
    });
    if (loginRes.statusCode === 200) {
      const editorCookie = (loginRes.headers["set-cookie"] as string).split(";")[0]!;
      const listRes = await app.inject({
        method: "GET",
        url: "/api/admin/v1/plugins",
        headers: { cookie: staffCookie },
      });
      const plugin = listRes
        .json()
        .plugins.find((p: any) => p.manifestId === "vibress-content-metrics");

      const actRes = await app.inject({
        method: "POST",
        url: `/api/admin/v1/plugins/${plugin.id}/activate`,
        headers: { cookie: editorCookie, origin: "http://localhost:7777" },
      });
      expect(actRes.statusCode).toBe(403);
    }
  });

  it("EXT-401 admits plugin events only with Staff, valid Origin and strictly scoped inputs", async () => {
    const target = "/api/admin/v1/plugins/missing-plugin/events";
    const eventId = crypto.randomUUID();
    const payload = { eventId, eventName: "post.published", payload: { count: 1 } };
    const anonymous = await app.inject({ method: "POST", url: target, payload });
    expect(anonymous.statusCode).toBe(401);

    const foreignMember = await app.inject({
      method: "POST", url: target,
      headers: { cookie: "vibress_member_session=forged", origin: "http://localhost:7777" },
      payload,
    });
    expect(foreignMember.statusCode).toBe(401);

    const wrongOrigin = await app.inject({
      method: "POST", url: target,
      headers: { cookie: staffCookie, origin: "https://attacker.invalid" }, payload,
    });
    expect(wrongOrigin.statusCode).toBe(403);

    for (const malformed of [
      { ...payload, publicationId: "other-publication" },
      { ...payload, payload: { nested: { secret: "no" } } },
      { ...payload, eventId: "not-uuid" },
    ]) {
      const response = await app.inject({
        method: "POST", url: target,
        headers: { cookie: staffCookie, origin: "http://localhost:7777" },
        payload: malformed,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().errors[0].code).toBe("VALIDATION_ERROR");
    }

    // No queue admission or plugin code execution for absent registrations.
    const missing = await app.inject({
      method: "POST", url: target,
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      payload,
    });
    expect(missing.statusCode).toBe(404);
  });

  // ---------------- Host-routed Extension API (EXT-201/202) ----------------
  it("extension API fails closed before loading plugin code without Staff/Member session", async () => {
    const admin = await app.inject({
      method: "GET",
      url: "/api/admin/v1/extensions/independent-courses/v1/courses",
    });
    expect(admin.statusCode).toBe(401);
    const member = await app.inject({
      method: "GET",
      url: "/api/members/v1/extensions/independent-courses/v1/courses",
    });
    expect(member.statusCode).toBe(401);
  });

  it("host validates Staff extension input and returns only declared fields", async () => {
    const handle = vi.fn(async (
      input: { body: Readonly<Record<string, string | number | boolean>> },
      scope: { publicationId: string; principal: { kind: string } },
    ) => ({
      id: String(input.body.title),
      audience: scope.principal.kind,
      publication: scope.publicationId,
    }));
    const descriptor: PluginApiRoute = {
      id: "courses",
      audience: "admin",
      method: "POST",
      permission: "posts.edit",
      body: { fields: { title: "string" }, required: ["title"] },
      response: { fields: {
        id: "string", audience: "string", publication: "string",
      } },
      handle,
    };
    const resolved = vi.spyOn(pluginsService, "resolveExtensionApiModule")
      .mockResolvedValue({ activate: async () => undefined, routes: [descriptor] });
    const prepared = vi.spyOn(pluginsService, "prepareExtensionApiExecution")
      .mockResolvedValue(true);
    try {
      const url = "/api/admin/v1/extensions/independent-courses/v1/courses";
      const anonymous = await app.inject({
        method: "POST", url, payload: { title: "Course" },
      });
      expect(anonymous.statusCode).toBe(401);
      const noOrigin = await app.inject({
        method: "POST", url, headers: { cookie: staffCookie },
        payload: { title: "Course" },
      });
      expect(noOrigin.statusCode).toBe(403);
      const invalid = await app.inject({
        method: "POST", url,
        headers: { cookie: staffCookie, origin: "http://localhost:7777" },
        payload: { title: "Course", publicationId: "forged-publication" },
      });
      expect(invalid.statusCode).toBe(400);
      expect(handle).not.toHaveBeenCalled();
      const valid = await app.inject({
        method: "POST", url,
        headers: { cookie: staffCookie, origin: "http://localhost:7777" },
        payload: { title: "Course" },
      });
      expect(valid.statusCode).toBe(200);
      expect(valid.json().id).toBe("Course");
      expect(valid.json().audience).toBe("staff");
      expect(typeof valid.json().publication).toBe("string");
      expect(resolved).toHaveBeenCalledWith(
        "independent-courses", valid.json().publication, "extension.routes.admin",
      );
      expect(handle).toHaveBeenCalledTimes(1);
      expect(prepared).toHaveBeenCalledTimes(1);
    } finally {
      prepared.mockRestore();
      resolved.mockRestore();
    }
  });

  it("binds storage only in authorized Staff requests and closes retained SDK handles", async () => {
    const columns = [{ name: "title", type: "text", required: true }] as const;
    const model = { key: "courses", columns, schemaSha256: pluginPhysicalModelDigest(columns) };
    let retained: PluginStorageApi | undefined;
    const handle = vi.fn(async (_input: unknown, scope: PluginApiScope) => {
      retained = scope.storage;
      return { publication: scope.publicationId, hasStorage: Boolean(scope.storage) };
    });
    const descriptor: PluginApiRoute = {
      id: "courses", audience: "admin", method: "POST",
      permission: "posts.edit",
      body: { fields: { title: "string" }, required: ["title"] },
      response: { fields: { publication: "string", hasStorage: "boolean" } },
      handle,
    };
    const resolve = vi.spyOn(pluginsService, "resolveExtensionApiModule")
      .mockResolvedValue({ activate: async () => undefined, routes: [descriptor] });
    const prepare = vi.spyOn(pluginsService, "prepareExtensionApiExecution")
      .mockResolvedValue(true);
    const approve = vi.spyOn(pluginsService, "resolveExtensionStorageBinding")
      .mockImplementation(async (_manifestId, publicationId) => ({
        pluginId: "p-approved", publicationId, models: [model],
      }));
    const url = "/api/admin/v1/extensions/independent-courses/v1/courses";
    try {
      const forbidden = await app.inject({
        method: "POST", url, headers: { cookie: staffCookie },
        payload: { title: "Course" },
      });
      expect(forbidden.statusCode).toBe(403);
      expect(approve).not.toHaveBeenCalled();
      expect(handle).not.toHaveBeenCalled();

      const authorized = await app.inject({
        method: "POST", url,
        headers: { cookie: staffCookie, origin: "http://localhost:7777" },
        payload: { title: "Course" },
      });
      expect(authorized.statusCode).toBe(200);
      expect(authorized.json().hasStorage).toBe(true);
      expect(approve).toHaveBeenCalledWith(
        "independent-courses", authorized.json().publication,
      );
      expect(retained).toBeDefined();
      await expect(retained!.get("courses", "row-1"))
        .rejects.toMatchObject({ code: "PLUGIN_STORAGE_SESSION_CLOSED" });

      approve.mockResolvedValueOnce(null);
      const absentApproval = await app.inject({
        method: "POST", url,
        headers: { cookie: staffCookie, origin: "http://localhost:7777" },
        payload: { title: "Course" },
      });
      expect(absentApproval.statusCode).toBe(200);
      expect(absentApproval.json().hasStorage).toBe(false);
    } finally {
      approve.mockRestore();
      prepare.mockRestore();
      resolve.mockRestore();
    }
  });

  it("requires publication-local authority even for a globally privileged owner", async () => {
    const db = getDb();
    const [owner] = await db.select({ id: users.id }).from(users)
      .where(eq(users.email, "owner@example.com")).limit(1);
    expect(owner).toBeDefined();
    const suffix = crypto.randomUUID().replaceAll("-", "");
    const workspaceId = `ws-storage-${suffix}`;
    const ownerPubId = `pub-storage-owner-${suffix}`;
    const limitedPubId = `pub-storage-limited-${suffix}`;
    const localMembershipId = `membership-storage-${suffix}`;
    await db.insert(workspaces).values({
      id: workspaceId, name: "Storage permission test", slug: workspaceId,
    });
    const modelColumns = [{ name: "title", type: "text", required: true }] as const;
    const approvedModel = {
      key: "courses", columns: modelColumns,
      schemaSha256: pluginPhysicalModelDigest(modelColumns),
    };
    const route: PluginApiRoute = {
      id: "courses", audience: "admin", method: "POST",
      permission: "posts.edit",
      body: { fields: { title: "string" }, required: ["title"] },
      response: { fields: { hasStorage: "boolean", publication: "string" } },
      handle: async (_input, scope) => ({
        hasStorage: Boolean(scope.storage), publication: scope.publicationId,
      }),
    };
    const label = { en: "Private management", ar: "الإدارة الخاصة" };
    const adminRoute: PluginApiRoute = {
      id: "private-management", audience: "admin", method: "GET",
      permission: "plugins.manage",
      response: { fields: { ok: "boolean" } },
      handle: async () => ({ ok: true }),
    };
    const resolve = vi.spyOn(pluginsService, "resolveExtensionApiModule")
      .mockResolvedValue({
        activate: async () => undefined, routes: [route, adminRoute],
        adminViews: [{ id: "management", routeId: "private-management", title: label }],
        adminNavigation: [{ viewId: "management", label, permission: "plugins.manage" }],
      });
    const list = vi.spyOn(pluginsService, "listPluginsForPublication")
      .mockImplementation(async () => [{
        id: "extension-admission-test", manifestId: "independent-courses",
        name: "Independent Courses", version: "1.0.0", vibressApiVersion: SDK_VERSION,
        description: null, entrypoint: "index.mjs", capabilities: ["admin.navigation", "extension.routes.admin"],
        hooks: [], settingsSchema: {}, status: "active", createdAt: new Date(), updatedAt: new Date(),
        publicationScoped: true, publicationEnabled: true,
      }]);
    const fingerprints = vi.spyOn(pluginsService, "listOperatorAdminFingerprints")
      .mockResolvedValue(new Map([["independent-courses", "f".repeat(64)]]));
    const prepare = vi.spyOn(pluginsService, "prepareExtensionApiExecution")
      .mockResolvedValue(true);
    const approve = vi.spyOn(pluginsService, "resolveExtensionStorageBinding")
      .mockImplementation(async (_id, publicationId) => ({
        pluginId: "p-approved", publicationId, models: [approvedModel],
      }));
    const uiAsset = vi.spyOn(pluginsService, "readExtensionAdminUiAsset")
      .mockResolvedValue("<main>Publication-scoped UI</main>");
    const issueFrame = (publicationId: string) => app.inject({
      method: "POST",
      url: "/api/admin/v1/extensions/independent-courses/views/management/frame-ticket",
      headers: { cookie: staffCookie, "x-publication-id": publicationId, origin: "http://localhost:7777" },
    });
    const readUi = (publicationId: string) => app.inject({
      method: "GET",
      url: "/api/admin/v1/extensions/independent-courses/views/management/ui",
      headers: { cookie: staffCookie, "x-publication-id": publicationId },
    });
    const readManagement = (publicationId: string) => app.inject({
      method: "GET",
      url: "/api/admin/v1/extensions/independent-courses/v1/private-management",
      headers: { cookie: staffCookie, "x-publication-id": publicationId },
    });
    const navigation = (publicationId: string) => app.inject({
      method: "GET", url: "/api/admin/v1/extensions/navigation",
      headers: { cookie: staffCookie, "x-publication-id": publicationId },
    });
    const invoke = (publicationId: string) => app.inject({
      method: "POST",
      url: "/api/admin/v1/extensions/independent-courses/v1/courses",
      headers: {
        cookie: staffCookie, origin: "http://localhost:7777",
        "x-publication-id": publicationId,
      },
      payload: { title: "Publication isolated" },
    });
    try {
      await db.insert(publications).values([
        { id: ownerPubId, workspaceId, name: "Owner Publication", slug: "owned" },
        { id: limitedPubId, workspaceId, name: "Limited Publication", slug: "limited" },
      ]);
      await db.insert(publicationMemberships).values([
        {
          id: `membership-owner-${suffix}`, publicationId: ownerPubId,
          userId: owner!.id, role: "owner",
        },
        {
          id: localMembershipId, publicationId: limitedPubId,
          userId: owner!.id, role: "author",
        },
      ]);

      const ownerResponse = await invoke(ownerPubId);
      expect(ownerResponse.statusCode).toBe(200);
      expect(ownerResponse.json()).toEqual({
        hasStorage: true, publication: ownerPubId,
      });
      expect(approve).toHaveBeenCalledTimes(1);
      const ownerNav = await navigation(ownerPubId);
      expect(ownerNav.statusCode).toBe(200);
      expect(ownerNav.json().items).toHaveLength(1);
      expect((await readManagement(ownerPubId)).statusCode).toBe(200);
      expect((await readUi(ownerPubId)).statusCode).toBe(200);
      expect((await issueFrame(ownerPubId)).statusCode).toBe(200);
      expect(uiAsset).toHaveBeenCalledTimes(2);

      for (const localRole of ["author", "contributor"]) {
        await db.update(publicationMemberships).set({ role: localRole })
          .where(eq(publicationMemberships.id, localMembershipId));
        const response = await invoke(limitedPubId);
        expect(response.statusCode).toBe(403);
        expect(response.json().errors[0].code).toBe("PERMISSION_DENIED");
        const nav = await navigation(limitedPubId);
        expect(nav.statusCode).toBe(200);
        expect(nav.json().items).toEqual([]);
        expect((await readManagement(limitedPubId)).statusCode).toBe(403);
        expect((await readUi(limitedPubId)).statusCode).toBe(403);
        expect((await issueFrame(limitedPubId)).statusCode).toBe(403);
        expect(uiAsset).toHaveBeenCalledTimes(2);
      }
      await db.update(publicationMemberships).set({ role: "editor" })
        .where(eq(publicationMemberships.id, localMembershipId));
      const editorResponse = await invoke(limitedPubId);
      expect(editorResponse.statusCode).toBe(200);
      expect(editorResponse.json()).toEqual({
        hasStorage: false, publication: limitedPubId,
      });
      expect(approve).toHaveBeenCalledTimes(2);
      expect((await navigation(limitedPubId)).json().items).toEqual([]);
      expect((await readManagement(limitedPubId)).statusCode).toBe(403);
      expect((await readUi(limitedPubId)).statusCode).toBe(403);
      expect((await issueFrame(limitedPubId)).statusCode).toBe(403);
      expect(uiAsset).toHaveBeenCalledTimes(2);
      await db.update(publicationMemberships).set({ role: "admin" })
        .where(eq(publicationMemberships.id, localMembershipId));
      const adminResponse = await invoke(limitedPubId);
      expect(adminResponse.statusCode).toBe(200);
      expect(adminResponse.json()).toEqual({
        hasStorage: true, publication: limitedPubId,
      });
      expect(approve).toHaveBeenCalledTimes(3);
      expect((await navigation(limitedPubId)).json().items).toHaveLength(1);
      expect((await readManagement(limitedPubId)).statusCode).toBe(200);
      expect((await readUi(limitedPubId)).statusCode).toBe(200);
      expect((await issueFrame(limitedPubId)).statusCode).toBe(200);
      expect(uiAsset).toHaveBeenCalledTimes(4);
    } finally {
      uiAsset.mockRestore();
      fingerprints.mockRestore();
      list.mockRestore();
      approve.mockRestore();
      prepare.mockRestore();
      resolve.mockRestore();
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    }
  });

  it("never permits a Staff GET extension route to write without Origin validation", async () => {
    const columns = [{ name: "title", type: "text", required: true }] as const;
    const model = { key: "courses", columns, schemaSha256: pluginPhysicalModelDigest(columns) };
    const descriptor: PluginApiRoute = {
      id: "preview", audience: "admin", method: "GET",
      permission: "posts.read",
      response: { fields: { blocked: "boolean" } },
      handle: async (_input, scope) => {
        if (!scope.storage) return { blocked: false };
        try {
          await scope.storage.create("courses", "csrf-write", { title: "unsafe" });
          return { blocked: false };
        } catch (error) {
          return { blocked: error instanceof Error && "code" in error &&
            error.code === "PLUGIN_STORAGE_METHOD_DENIED" };
        }
      },
    };
    const resolve = vi.spyOn(pluginsService, "resolveExtensionApiModule")
      .mockResolvedValue({ activate: async () => undefined, routes: [descriptor] });
    const prepare = vi.spyOn(pluginsService, "prepareExtensionApiExecution")
      .mockResolvedValue(true);
    const approval = vi.spyOn(pluginsService, "resolveExtensionStorageBinding")
      .mockImplementation(async (_id, publicationId) => ({
        pluginId: "p-approved", publicationId, models: [model],
      }));
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/admin/v1/extensions/independent-courses/v1/preview",
        headers: { cookie: staffCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ blocked: true });
      expect(approval).toHaveBeenCalledTimes(1);
    } finally {
      approval.mockRestore();
      prepare.mockRestore();
      resolve.mockRestore();
    }
  });

  it("does not grant extension storage to an editor without plugins.manage", async () => {
    const email = `storage-editor-${crypto.randomUUID()}@example.com`;
    const invitation = await app.inject({
      method: "POST", url: "/api/admin/v1/users/invite",
      headers: { cookie: staffCookie, origin: "http://localhost:7777" },
      payload: { email, name: "Storage Editor", roleKey: "editor" },
    });
    expect(invitation.statusCode).toBe(201);
    const accepted = await app.inject({
      method: "POST", url: "/api/admin/v1/auth/invitation/accept",
      headers: { origin: "http://localhost:7777" },
      payload: { token: invitation.json().invitation.token,
        password: "EditorStoragePassword123!" },
    });
    expect(accepted.statusCode).toBe(200);
    const login = await app.inject({
      method: "POST", url: "/api/admin/v1/auth/login",
      payload: { email, password: "EditorStoragePassword123!" },
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie) as string;
    const route: PluginApiRoute = {
      id: "courses", audience: "admin", method: "POST",
      permission: "posts.edit",
      body: { fields: { title: "string" }, required: ["title"] },
      response: { fields: { storageExposed: "boolean" } },
      handle: async (_input, scope) => ({ storageExposed: Boolean(scope.storage) }),
    };
    const resolve = vi.spyOn(pluginsService, "resolveExtensionApiModule")
      .mockResolvedValue({ activate: async () => undefined, routes: [route] });
    const prepare = vi.spyOn(pluginsService, "prepareExtensionApiExecution")
      .mockResolvedValue(true);
    const approved = vi.spyOn(pluginsService, "resolveExtensionStorageBinding")
      .mockRejectedValue(new Error("Unauthorized storage approval lookup"));
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/v1/extensions/independent-courses/v1/courses",
        headers: { cookie, origin: "http://localhost:7777" },
        payload: { title: "No secret storage" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ storageExposed: false });
      expect(approved).not.toHaveBeenCalled();
    } finally {
      approved.mockRestore();
      prepare.mockRestore();
      resolve.mockRestore();
    }
  });

  it("EXT-302A resolves only explicitly linked, enabled public SSR views", async () => {
    const descriptor: PluginApiRoute = {
      id: "catalog", audience: "public", method: "GET",
      response: { fields: { title: "string", total: "number" } },
      handle: () => ({ title: "Public courses", total: 3 }),
    };
    const title = { en: "Courses", ar: "الدورات" };
    const module: PluginModule = {
      activate() {},
      routes: [descriptor],
      publicViews: [{ id: "courses", routeId: "catalog", title }],
    };
    const resolved = vi.spyOn(pluginsService, "resolveExtensionApiModule")
      .mockResolvedValue(module);
    const prepared = vi.spyOn(pluginsService, "prepareExtensionApiExecution")
      .mockResolvedValue(true);
    const url = "/api/content/v1/extensions/independent-courses/views/courses";
    try {
      const valid = await app.inject({
        method: "GET", url, headers: { host: "localhost:7777" },
      });
      expect(valid.statusCode).toBe(200);
      expect(valid.headers["cache-control"]).toBe("private, no-store");
      expect(valid.json()).toEqual({
        pluginId: "independent-courses", viewId: "courses",
        routeId: "catalog", title,
      });
      expect(prepared).not.toHaveBeenCalled();
      const page = await app.inject({
        method: "GET", url: url + "/page", headers: { host: "localhost:7777" },
      });
      expect(page.statusCode).toBe(200);
      expect(page.headers["cache-control"]).toBe("private, no-store");
      expect(page.json()).toEqual({
        publicationId: expect.any(String),
        locale: expect.any(String),
        pluginId: "independent-courses", viewId: "courses",
        routeId: "catalog", title,
        data: { title: "Public courses", total: 3 },
      });
      expect(prepared).toHaveBeenCalledWith(
        "independent-courses", expect.any(String), "extension.routes.public", module,
      );
      const scalar = await app.inject({
        method: "GET",
        url: "/api/content/v1/extensions/independent-courses/v1/catalog",
        headers: { host: "localhost:7777" },
      });
      expect(scalar.statusCode).toBe(200);
      expect(scalar.json()).toEqual({ title: "Public courses", total: 3 });

      expect((await app.inject({
        method: "GET",
        url: "/api/content/v1/extensions/independent-courses/views/unknown",
        headers: { host: "localhost:7777" },
      })).statusCode).toBe(404);
      expect((await app.inject({
        method: "GET",
        url: "/api/content/v1/extensions/independent-courses/views/%2e%2e",
        headers: { host: "localhost:7777" },
      })).statusCode).not.toBe(200);

      resolved.mockResolvedValue({ ...module, publicViews: undefined });
      expect((await app.inject({
        method: "GET", url, headers: { host: "localhost:7777" },
      })).statusCode).toBe(404);
      expect((await app.inject({
        method: "GET", url: url + "/page", headers: { host: "localhost:7777" },
      })).statusCode).toBe(404);

      resolved.mockResolvedValue({ ...module, routes: [{ ...descriptor, audience: "member" }] });
      expect((await app.inject({
        method: "GET", url, headers: { host: "localhost:7777" },
      })).statusCode).toBe(503);

      resolved.mockResolvedValue(null);
      expect((await app.inject({
        method: "GET", url, headers: { host: "localhost:7777" },
      })).statusCode).toBe(404);
      expect((await app.inject({
        method: "GET", url: url + "/page", headers: { host: "localhost:7777" },
      })).statusCode).toBe(404);
    } finally {
      prepared.mockRestore();
      resolved.mockRestore();
    }
  });

  it("EXT-302A binds descriptor and data to the same authoritative hostname publication", async () => {
    const hostContext = vi.spyOn(workspaceService, "resolvePublicPublicationContext")
      .mockImplementation(async (options) => {
        const publicationId = options.host?.startsWith("publication-b.")
          ? "pub_b" : "pub_a";
        return {
          publicationId, workspaceId: "workspace_shared",
          actorType: "public", isSystemOperation: false,
        };
      });
    const route: PluginApiRoute = {
      id: "catalog", audience: "public", method: "GET",
      response: { fields: { publication: "string" } },
      handle: (_input, scope) => ({ publication: scope.publicationId }),
    };
    const pluginModule: PluginModule = {
      activate() {}, routes: [route],
      publicViews: [{
        id: "courses", routeId: "catalog",
        title: { en: "Courses", ar: "الدورات" },
      }],
    };
    const resolve = vi.spyOn(pluginsService, "resolveExtensionApiModule")
      .mockResolvedValue(pluginModule);
    const prepare = vi.spyOn(pluginsService, "prepareExtensionApiExecution")
      .mockResolvedValue(true);
    const url = "/api/content/v1/extensions/independent-courses/views/courses/page";
    try {
      const a = await app.inject({
        method: "GET", url, headers: { host: "publication-a.example" },
      });
      const b = await app.inject({
        method: "GET", url, headers: { host: "publication-b.example" },
      });
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      expect(a.json().publicationId).toBe("pub_a");
      expect(b.json().publicationId).toBe("pub_b");
      expect(a.json().data).toEqual({ publication: "pub_a" });
      expect(b.json().data).toEqual({ publication: "pub_b" });
      expect(resolve).toHaveBeenCalledWith(
        "independent-courses", "pub_a", "extension.routes.public",
      );
      expect(resolve).toHaveBeenCalledWith(
        "independent-courses", "pub_b", "extension.routes.public",
      );
      expect(prepare).toHaveBeenCalledTimes(2);
    } finally {
      prepare.mockRestore();
      resolve.mockRestore();
      hostContext.mockRestore();
    }
  });

  it("EXT-302B serves only enabled and explicitly published locale variants", async () => {
    const handler = vi.fn((_input, scope: PluginApiScope) => ({
      headline: scope.locale === "ar" ? "الدورات" : "Courses",
    }));
    const route: PluginApiRoute = {
      id: "catalog", audience: "public", method: "GET",
      response: { fields: { headline: "string" } }, handle: handler,
    };
    const module: PluginModule = {
      activate() {},
      routes: [route],
      publicViews: [{
        id: "courses", routeId: "catalog",
        title: { en: "Courses", ar: "الدورات" },
        publishedLocales: ["en", "ar"],
      }],
    };
    const resolver = vi.spyOn(pluginsService, "resolveExtensionApiModule")
      .mockResolvedValue(module);
    const prepare = vi.spyOn(pluginsService, "prepareExtensionApiExecution")
      .mockResolvedValue(true);
    const policy = vi.spyOn(publicationLocaleService, "getConfiguration")
      .mockResolvedValue({
        primaryLocale: "en", enabledLocales: ["en", "ar"],
        isMultilingual: true, needsReconciliation: false,
      });
    const url = "/api/content/v1/extensions/independent-courses/views/courses/page";
    try {
      const arabic = await app.inject({
        method: "GET", url: url + "?locale=ar", headers: { host: "localhost:7777" },
      });
      expect(arabic.statusCode).toBe(200);
      expect(arabic.json().locale).toBe("ar");
      expect(arabic.json().data).toEqual({ headline: "الدورات" });
      expect(arabic.json().publishedLocales).toEqual(["en", "ar"]);
      expect(handler).toHaveBeenCalledTimes(1);

      const disabled = await app.inject({
        method: "GET", url: url + "?locale=fr", headers: { host: "localhost:7777" },
      });
      expect(disabled.statusCode).toBe(404);
      const invalid = await app.inject({
        method: "GET", url: url + "?locale=../../admin", headers: { host: "localhost:7777" },
      });
      expect(invalid.statusCode).toBe(400);
      expect(handler).toHaveBeenCalledTimes(1);
      policy.mockResolvedValue({
        primaryLocale: "en", enabledLocales: ["en"],
        isMultilingual: false, needsReconciliation: false,
      });
      const noLongerEnabled = await app.inject({
        method: "GET", url: url + "?locale=ar", headers: { host: "localhost:7777" },
      });
      expect(noLongerEnabled.statusCode).toBe(404);
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      policy.mockRestore();
      prepare.mockRestore();
      resolver.mockRestore();
    }
  });

  it("public extension API is GET-only, host-scoped and validates response projection", async () => {
    const handler = vi.fn(async () => ({ title: "Available courses" }));
    const descriptor: PluginApiRoute = {
      id: "catalog",
      audience: "public",
      method: "GET",
      query: { fields: { lang: "string" }, required: ["lang"] },
      response: { fields: { title: "string" }, required: ["title"] },
      handle: handler,
    };
    const resolve = vi.spyOn(pluginsService, "resolveExtensionApiModule")
      .mockResolvedValue({ activate: async () => undefined, routes: [descriptor] });
    const prepare = vi.spyOn(pluginsService, "prepareExtensionApiExecution")
      .mockResolvedValue(true);
    try {
      const url = "/api/content/v1/extensions/independent-courses/v1/catalog";
      const valid = await app.inject({
        method: "GET", url: `${url}?lang=en`, headers: { host: "localhost:7777" },
      });
      expect(valid.statusCode).toBe(200);
      expect(valid.json()).toEqual({ title: "Available courses" });
      expect(handler).toHaveBeenCalledTimes(1);

      const forged = await app.inject({
        method: "GET", url: `${url}?lang=en&publicationId=forged`,
        headers: { host: "localhost:7777" },
      });
      expect(forged.statusCode).toBe(400);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(prepare).toHaveBeenCalledTimes(1);

      const mutation = await app.inject({
        method: "POST", url, headers: { host: "localhost:7777" },
        payload: { title: "not allowed" },
      });
      expect(mutation.statusCode).toBe(404);

      handler.mockResolvedValue(Object.assign({ title: "Visible" }, { internalSecret: "hidden" }));
      const malformedResponse = await app.inject({
        method: "GET", url: `${url}?lang=en`,
        headers: { host: "localhost:7777" },
      });
      expect(malformedResponse.statusCode).toBe(503);
      expect(malformedResponse.body).not.toContain("hidden");
    } finally {
      prepare.mockRestore();
      resolve.mockRestore();
    }
  });

  it("rejects duplicate extension routes and suppresses handler exceptions", async () => {
    const descriptor: PluginApiRoute = {
      id: "courses", audience: "admin", method: "GET",
      permission: "posts.read", response: { fields: {} },
      handle: async () => ({}),
    };
    const spy = vi.spyOn(pluginsService, "resolveExtensionApiModule")
      .mockResolvedValue({ activate: async () => undefined, routes: [descriptor, descriptor] });
    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/admin/v1/extensions/independent-courses/v1/courses",
        headers: { cookie: staffCookie },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json().errors[0].code).toBe("EXTENSION_INVALID_ROUTES");
    } finally { spy.mockRestore(); }
  });

  // ---------------- CSRF ----------------
  it("CSRF: platform state-changing routes require a valid origin", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/integrations",
      headers: { cookie: staffCookie },
      payload: { key: `no-origin-${Date.now()}`, type: "x", name: "X" },
    });
    expect(res.statusCode).toBe(403);
  });
});
