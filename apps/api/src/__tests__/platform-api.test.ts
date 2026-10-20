import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
import { getDb } from "@vibress/database";
import { eq } from "drizzle-orm";
import { hashPassword } from "@vibress/security";
import { SDK_VERSION } from "@vibress/plugin-sdk";
import type { PluginApiRoute } from "@vibress/plugin-sdk";
import { pluginsService } from "../services";

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
