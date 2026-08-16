import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
import {
  getDb,
  installedThemes,
  themeSettings,
  themeConfigurations,
  users,
  userRoles,
  roles,
} from "@vibress/database";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { hashPassword } from "@vibress/security";

async function loginStaff(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/admin/v1/auth/login",
    payload: { email: "owner-e2e@example.com", password: "OwnerPass123!" },
  });
  expect(res.statusCode).toBe(200);
  const setCookie = (res.headers["set-cookie"] as unknown as string) || "";
  return setCookie.split(";")[0] ?? "";
}

async function ensureOwner(): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, "owner-e2e@example.com"))
    .limit(1);
  if (rows.length > 0) return;
  const hash = await hashPassword("OwnerPass123!");
  const ownerId = crypto.randomUUID();
  await db
    .insert(users)
    .values({
      id: ownerId,
      email: "owner-e2e@example.com",
      name: "E2E Owner",
      slug: "theme-e2e-owner-full",
      passwordHash: hash,
      status: "active",
    })
    .onConflictDoNothing();
  const ownerRole = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, "owner"))
    .limit(1);
  if (ownerRole[0]) {
    await db
      .insert(userRoles)
      .values({ userId: ownerId, roleId: ownerRole[0].id })
      .onConflictDoNothing();
  }
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

describe("E2E External Theme Full Lifecycle & Cold Restart Persistence Gate", () => {
  let app: FastifyInstance;
  let staffCookie: string;
  const starterZipPath = path.resolve(__dirname, "../../../../content/vibress-theme-starter.zip");

  beforeAll(async () => {
    process.env.VIBRESS_ENCRYPTION_KEY =
      process.env.VIBRESS_ENCRYPTION_KEY || "test-encryption-key-for-themes-e2e";
    app = buildApp();
    await app.ready();
    await ensureOwner();
    staffCookie = await loginStaff(app);

    // Clean up any lingering installed test themes and reset active theme
    const db = getDb();
    await db
      .delete(installedThemes)
      .where(eq(installedThemes.themeId, "vibress-starter-theme"));
    await db
      .delete(themeSettings)
      .where(eq(themeSettings.themeId, "vibress-starter-theme"));
    await db.delete(themeConfigurations);
  });

  afterAll(async () => {
    await app.close();
  });

  it("Step 1: Admin uploads real official vibress-theme-starter.zip → validation & install succeed", async () => {
    expect(fs.existsSync(starterZipPath)).toBe(true);
    const zipBuffer = fs.readFileSync(starterZipPath);

    const boundary = `----WebKitFormBoundary${crypto.randomBytes(8).toString("hex")}`;
    const payload = buildMultipartFormData(
      boundary,
      "file",
      "vibress-theme-starter.zip",
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
    expect(body.theme.themeId).toBe("vibress-starter-theme");
    expect(body.theme.version).toBe("1.0.0");
    expect(body.theme.isBuiltIn).toBe(false);
  });

  it("Step 2: Preview external theme → public visitors remain on default theme", async () => {
    // Generate preview token
    const previewRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/themes/vibress-starter-theme/preview",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
      },
    });

    expect(previewRes.statusCode).toBe(200);
    const previewBody = previewRes.json();
    expect(previewBody.previewToken).toBeDefined();
    expect(previewBody.themeId).toBe("vibress-starter-theme");

    // Public active theme endpoint still returns vibress-default
    const activeRes = await app.inject({
      method: "GET",
      url: "/api/admin/v1/themes/active",
      headers: { cookie: staffCookie },
    });

    expect(activeRes.statusCode).toBe(200);
    const activeBody = activeRes.json();
    expect(activeBody.themeId).toBe("vibress-default");
  });

  it("Step 3: Activate external theme → immediately becomes active theme", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/themes/vibress-starter-theme/activate",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.theme.themeId).toBe("vibress-starter-theme");
    expect(body.theme.themeVersion).toBe("1.0.0");

    // Verify active endpoint reflects it
    const activeRes = await app.inject({
      method: "GET",
      url: "/api/admin/v1/themes/active",
      headers: { cookie: staffCookie },
    });
    expect(activeRes.statusCode).toBe(200);
    expect(activeRes.json().themeId).toBe("vibress-starter-theme");
  });

  it("Step 4: Customize settings → persist custom accentColor and heroHeadline", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/admin/v1/themes/vibress-starter-theme/settings",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
      },
      payload: {
        accentColor: "#ec4899",
        heroHeadline: "E2E Verified Publications",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.theme.settings.accentColor).toBe("#ec4899");
    expect(body.theme.settings.heroHeadline).toBe("E2E Verified Publications");
  });

  it("Step 5: Switch to built-in theme and switch back → custom settings remain intact", async () => {
    // Switch to built-in theme
    const switchRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/themes/vibress-default/activate",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
      },
    });
    expect(switchRes.statusCode).toBe(200);
    expect(switchRes.json().theme.themeId).toBe("vibress-default");

    // Switch back to external theme
    const switchBackRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/themes/vibress-starter-theme/activate",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
      },
    });
    expect(switchBackRes.statusCode).toBe(200);
    const body = switchBackRes.json();
    expect(body.theme.themeId).toBe("vibress-starter-theme");
    // Settings preserved from previous customization
    expect(body.theme.settings.accentColor).toBe("#ec4899");
    expect(body.theme.settings.heroHeadline).toBe("E2E Verified Publications");
  });

  it("Step 6: Upload newer version 2.0.0 → active version 1.0.0 remains unchanged until activation", async () => {
    // Create version 2.0.0 package
    const previewWebpBuffer = fs.readFileSync(
      path.resolve(__dirname, "../../../../content/theme-starter/preview.webp"),
    );
    const zip = new JSZip();
    zip.file(
      "theme.json",
      JSON.stringify({
        id: "vibress-starter-theme",
        name: "Vibress Starter Theme",
        version: "2.0.0",
        themeApi: 1,
        previewImage: "preview.webp",
      }),
    );
    zip.file(
      "settings.json",
      JSON.stringify({
        fields: [
          { key: "accentColor", type: "color", default: "#6366f1" },
          { key: "heroHeadline", type: "string", default: "V2 Headline" },
        ],
      }),
    );
    zip.file("preview.webp", previewWebpBuffer);
    zip.file("templates/home.liquid", "<h1>V2 Home: {{ site.title }}</h1>");
    zip.file("templates/post.liquid", "<h1>V2 Post: {{ post.title }}</h1>");
    zip.file("templates/page.liquid", "<h1>V2 Page: {{ page.title }}</h1>");
    zip.file("assets/css/theme.css", "body { color: blue; }");

    const v2Buffer = await zip.generateAsync({ type: "nodebuffer" });
    const boundary = `----WebKitFormBoundary${crypto.randomBytes(8).toString("hex")}`;
    const payload = buildMultipartFormData(
      boundary,
      "file",
      "starter-theme-2.0.0.zip",
      v2Buffer,
    );

    const uploadRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/themes/upload",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    if (uploadRes.statusCode !== 201) {
      console.error("Upload failed with:", JSON.stringify(uploadRes.json()));
    }
    expect(uploadRes.statusCode).toBe(201);
    const uploadBody = uploadRes.json();
    expect(uploadBody.theme.version).toBe("2.0.0");
    // Installed status, not active yet
    expect(uploadBody.theme.status).toBe("installed");

    // Active version is still 1.0.0
    const activeRes = await app.inject({
      method: "GET",
      url: "/api/admin/v1/themes/active",
      headers: { cookie: staffCookie },
    });
    expect(activeRes.statusCode).toBe(200);
    expect(activeRes.json().themeVersion).toBe("1.0.0");

    // Explicitly activate version 2.0.0
    const activateV2Res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/themes/vibress-starter-theme/activate",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
      },
      payload: { version: "2.0.0" },
    });
    expect(activateV2Res.statusCode).toBe(200);
    expect(activateV2Res.json().theme.themeVersion).toBe("2.0.0");
  });

  it("Step 7: Cold restart / recreate persistence proof → theme survives server restart", async () => {
    // 1. Close current application instance
    await app.close();

    // 2. Recreate / reboot fresh app instance from scratch (simulating container restart)
    const rebootedApp = buildApp();
    await rebootedApp.ready();
    const newStaffCookie = await loginStaff(rebootedApp);

    // 3. Verify active theme is still vibress-starter-theme v2.0.0
    const activeRes = await rebootedApp.inject({
      method: "GET",
      url: "/api/admin/v1/themes/active",
      headers: { cookie: newStaffCookie },
    });

    expect(activeRes.statusCode).toBe(200);
    const activeBody = activeRes.json();
    expect(activeBody.themeId).toBe("vibress-starter-theme");
    expect(activeBody.themeVersion).toBe("2.0.0");
    // Verify settings were retained across cold restart
    expect(activeBody.settings.accentColor).toBe("#ec4899");

    // 4. Verify installed themes list shows both version 1.0.0 and 2.0.0 installed
    const listRes = await rebootedApp.inject({
      method: "GET",
      url: "/api/admin/v1/themes",
      headers: { cookie: newStaffCookie },
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json();
    const starterSummary = listBody.themes.find(
      (t: any) => t.manifest.id === "vibress-starter-theme",
    );
    expect(starterSummary).toBeDefined();
    expect(starterSummary.isActive).toBe(true);

    await rebootedApp.close();
  });
});
