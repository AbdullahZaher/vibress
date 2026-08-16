import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
import { getDb } from "@vibress/database";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { hashPassword } from "@vibress/security";
import JSZip from "jszip";

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
      slug: "theme-e2e-owner",
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

async function createZipBuffer(
  files: Record<string, string | Buffer>,
): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

function buildMultipartFormData(
  boundary: string,
  fieldName: string,
  fileName: string,
  fileContent: Buffer,
): Buffer {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\nContent-Type: application/zip\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([head, fileContent, tail]);
}

describe("API — External Theme System Integration", () => {
  let app: FastifyInstance;
  let staffCookie: string;

  beforeAll(async () => {
    process.env.VIBRESS_ENCRYPTION_KEY =
      process.env.VIBRESS_ENCRYPTION_KEY || "test-encryption-key-for-themes";
    app = buildApp();
    await app.ready();
    await ensureOwner();
    staffCookie = await loginStaff(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("lists all default and registered themes", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/themes",
      headers: { cookie: staffCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.themes).toBeDefined();
    expect(Array.isArray(body.themes)).toBe(true);
    expect(body.themes.length).toBeGreaterThanOrEqual(1);

    const defaultTheme = body.themes.find(
      (t: any) => t.manifest.id === "vibress-default",
    );
    expect(defaultTheme).toBeDefined();
    expect(defaultTheme.isBuiltIn).toBe(true);
  });

  it("uploads and installs a valid external theme package via ZIP", async () => {
    const validManifest = JSON.stringify({
      id: "vibress-news-express",
      name: "News Express",
      version: "1.0.0",
      description: "Fast news theme for Vibress",
      author: { name: "Theme Studio" },
      themeApi: 1,
      settingsSchemaVersion: 1,
    });

    const validSettings = JSON.stringify({
      fields: [
        { key: "accentColor", type: "color", default: "#0066cc" },
        { key: "headlineFont", type: "string", default: "Inter" },
      ],
    });

    const files = {
      "theme.json": validManifest,
      "settings.json": validSettings,
      "templates/home.liquid": "<h1>{{ site.title }}</h1>",
      "templates/post.liquid": "<h1>{{ post.title }}</h1>",
      "templates/page.liquid": "<h1>{{ page.title }}</h1>",
      "assets/css/theme.css": "body { font-family: sans-serif; }",
    };

    const zipBuffer = await createZipBuffer(files);
    const boundary = `----WebKitFormBoundary${crypto.randomBytes(8).toString("hex")}`;
    const payload = buildMultipartFormData(
      boundary,
      "file",
      "news-express.zip",
      zipBuffer,
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/themes/upload",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.theme).toBeDefined();
    expect(body.theme.themeId).toBe("vibress-news-express");
    expect(body.theme.name).toBe("News Express");
    expect(body.theme.isBuiltIn).toBe(false);
  });

  it("rejects uploading a malicious ZIP containing server executable code", async () => {
    const maliciousFiles = {
      "theme.json": JSON.stringify({
        id: "evil-theme",
        name: "Evil Theme",
        version: "1.0.0",
        themeApi: 1,
      }),
      "templates/home.liquid": "<h1>Home</h1>",
      "templates/post.liquid": "<h1>Post</h1>",
      "templates/page.liquid": "<h1>Page</h1>",
      "server.ts": "import os from 'os'; console.log(os.hostname());",
    };

    const zipBuffer = await createZipBuffer(maliciousFiles);
    const boundary = `----WebKitFormBoundary${crypto.randomBytes(8).toString("hex")}`;
    const payload = buildMultipartFormData(
      boundary,
      "file",
      "evil.zip",
      zipBuffer,
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/themes/upload",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.errors[0]?.message).toMatch(/forbidden executable or server code file/i);
  });

  it("activates an installed external theme instantly", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/themes/vibress-news-express/activate",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.theme.themeId).toBe("vibress-news-express");
    expect(body.theme.settings.accentColor).toBe("#0066cc");

    // Verify active endpoint reflects it
    const activeRes = await app.inject({
      method: "GET",
      url: "/api/admin/v1/themes/active",
      headers: { cookie: staffCookie },
    });
    expect(activeRes.statusCode).toBe(200);
    expect(activeRes.json().themeId).toBe("vibress-news-express");
  });

  it("updates active theme settings", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/admin/v1/themes/vibress-news-express/settings",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
      },
      payload: {
        accentColor: "#ff4400",
        headlineFont: "Georgia",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.theme.settings.accentColor).toBe("#ff4400");
    expect(body.theme.settings.headlineFont).toBe("Georgia");
  });

  it("creates and resolves theme preview tokens", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/themes/vibress-minimal/preview",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
      },
    });

    expect(createRes.statusCode).toBe(200);
    const { previewToken } = createRes.json();
    expect(previewToken).toBeDefined();

    const resolveRes = await app.inject({
      method: "GET",
      url: `/api/admin/v1/themes/preview/${previewToken}`,
    });

    expect(resolveRes.statusCode).toBe(200);
    expect(resolveRes.json().themeId).toBe("vibress-minimal");
  });

  it("prevents deleting currently active theme", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/admin/v1/themes/vibress-news-express",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0]?.message).toMatch(/Cannot delete currently active theme/i);
  });

  it("prevents deleting built-in themes", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/admin/v1/themes/vibress-default",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0]?.message).toMatch(/Built-in system themes cannot be uninstalled/i);
  });

  it("deletes an external theme when no longer active", async () => {
    // 1. Switch back to built-in default
    await app.inject({
      method: "POST",
      url: "/api/admin/v1/themes/vibress-default/activate",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
      },
    });

    // 2. Delete news express theme
    const res = await app.inject({
      method: "DELETE",
      url: "/api/admin/v1/themes/vibress-news-express",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);

    // 3. Verify it's no longer listed
    const listRes = await app.inject({
      method: "GET",
      url: "/api/admin/v1/themes",
      headers: { cookie: staffCookie },
    });
    const found = listRes
      .json()
      .themes.find((t: any) => t.manifest.id === "vibress-news-express");
    expect(found).toBeUndefined();
  });
});
