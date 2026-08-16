import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { themeRoutes } from "../routes/themes";
import JSZip from "jszip";

describe("API Security & Themes — Theme Lifecycle & Multi-Version Hardening", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });
    app.decorateRequest("user", undefined);
    app.decorateRequest("roles", undefined);
    app.decorateRequest("permissions", undefined);
    app.addHook("preHandler", async (req) => {
      (req as any).user = {
        id: "test-admin-1",
        email: "admin@vibress.local",
        roleId: "role-admin",
        role: "admin",
      };
      (req as any).roles = ["admin"];
      (req as any).permissions = ["themes.manage", "themes.read"];
    });

    await app.register(themeRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createThemeZip(
    id: string,
    version: string,
    extraFiles: Record<string, string | Buffer> = {},
  ): Promise<Buffer> {
    const zip = new JSZip();
    zip.file(
      "theme.json",
      JSON.stringify({
        id,
        name: `Theme ${id}`,
        version,
        themeApi: 1,
        author: "Vibress Labs",
      }),
    );
    zip.file(
      "settings.json",
      JSON.stringify({
        fields: [
          {
            key: "accentColor",
            type: "color",
            default: "#3b82f6",
          },
          {
            key: "sidebarLayout",
            type: "select",
            options: ["left", "right"],
            default: "left",
          },
        ],
      }),
    );
    zip.file("templates/home.liquid", "<h1>Home {{ site.title }}</h1>");
    zip.file("templates/post.liquid", "<h1>Post {{ post.title }}</h1>");
    zip.file("templates/page.liquid", "<h1>Page {{ page.title }}</h1>");
    zip.file("assets/css/theme.css", "body { margin: 0; }");

    for (const [p, content] of Object.entries(extraFiles)) {
      zip.file(p, content);
    }
    return zip.generateAsync({ type: "nodebuffer" });
  }

  it("successfully lists built-in themes out of the box", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/themes",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.themes).toBeInstanceOf(Array);
    expect(body.themes.length).toBeGreaterThanOrEqual(1);
    expect(body.themes.some((t: any) => t.manifest.id === "vibress-default")).toBe(true);
  });

  it("rejects theme upload containing forbidden javascript (.js)", async () => {
    const zipWithJs = await createThemeZip("evil-theme", "1.0.0", {
      "assets/js/exploit.js": "window.location='https://evil.com'",
    });

    const boundary = "----WebKitFormBoundaryTest";
    const bodyBuffer = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="evil-theme.zip"\r\nContent-Type: application/zip\r\n\r\n`),
      zipWithJs,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/themes/upload",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      body: bodyBuffer,
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.errors[0]?.code).toBe("THEME_FORBIDDEN_FILE_TYPE");
  });

  it("rejects theme upload when settings schema field has no default", async () => {
    const invalidSettingsZip = await createThemeZip("invalid-settings", "1.0.0", {
      "settings.json": JSON.stringify({
        fields: [
          {
            key: "badField",
            type: "string",
            // missing default
          },
        ],
      }),
    });

    const boundary = "----WebKitFormBoundaryTest";
    const bodyBuffer = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="invalid-settings.zip"\r\nContent-Type: application/zip\r\n\r\n`),
      invalidSettingsZip,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/themes/upload",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      body: bodyBuffer,
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.errors[0]?.code).toBe("THEME_SETTINGS_SCHEMA_INVALID");
  });

  it("creates and resolves preview tokens for themes", async () => {
    const tokenRes = await app.inject({
      method: "POST",
      url: "/themes/vibress-default/preview",
    });

    expect(tokenRes.statusCode).toBe(200);
    const tokenBody = JSON.parse(tokenRes.body);
    expect(tokenBody.previewToken).toBeDefined();

    // Resolve token
    const resolveRes = await app.inject({
      method: "GET",
      url: `/themes/preview/${tokenBody.previewToken}`,
    });

    expect(resolveRes.statusCode).toBe(200);
    const resolveBody = JSON.parse(resolveRes.body);
    expect(resolveBody.themeId).toBe("vibress-default");
  });
});
