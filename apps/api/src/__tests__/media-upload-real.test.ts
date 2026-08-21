import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
import { getDb, users, userRoles, roles } from "@vibress/database";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { hashPassword } from "@vibress/security";

async function loginStaff(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/admin/v1/auth/login",
    payload: { email: "media-owner@example.com", password: "OwnerPass123!" },
  });
  expect(res.statusCode).toBe(200);
  const setCookie = (res.headers["set-cookie"] as unknown as string) || "";
  return setCookie.split(";")[0] ?? "";
}

async function ensureMediaOwner(): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, "media-owner@example.com"))
    .limit(1);
  if (rows.length > 0) return;
  const hash = await hashPassword("OwnerPass123!");
  const ownerId = crypto.randomUUID();
  await db
    .insert(users)
    .values({
      id: ownerId,
      email: "media-owner@example.com",
      name: "Media Owner",
      slug: "media-owner",
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
      .values({ userId: ownerId, roleId: ownerRole[0].id })
      .onConflictDoNothing();
}

function buildMultipart(
  boundary: string,
  fieldName: string,
  fileName: string,
  fileContent: Buffer,
  mimeType: string,
): Buffer {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([head, fileContent, tail]);
}

// 1x1 valid PNG buffer
const VALID_PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// 1x1 valid JPEG buffer
const VALID_JPEG_BUFFER = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

// 1x1 valid GIF buffer
const VALID_GIF_BUFFER = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

// 1x1 valid WebP buffer
const VALID_WEBP_BUFFER = Buffer.from(
  "UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaQAA3AA/v39WAAA",
  "base64",
);

describe("POST /api/admin/v1/media Upload Testing", () => {
  let app: FastifyInstance;
  let staffCookie: string;

  beforeAll(async () => {
    process.env.VIBRESS_ENCRYPTION_KEY =
      process.env.VIBRESS_ENCRYPTION_KEY || "test-encryption-key-for-media";
    app = buildApp();
    await app.ready();
    await ensureMediaOwner();
    staffCookie = await loginStaff(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("successfully uploads a valid PNG image", async () => {
    const boundary = `----WebKitFormBoundary${crypto.randomBytes(8).toString("hex")}`;
    const payload = buildMultipart(
      boundary,
      "file",
      "test-image.png",
      VALID_PNG_BUFFER,
      "image/png",
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/media",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    console.log("PNG Upload Response:", res.statusCode, res.body);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.media).toBeDefined();
    expect(body.media.id).toBeDefined();
    expect(body.media.mimeType).toBe("image/png");
    expect(body.media.url).toBeDefined();
  });

  it("successfully uploads a valid JPEG image", async () => {
    const boundary = `----WebKitFormBoundary${crypto.randomBytes(8).toString("hex")}`;
    const payload = buildMultipart(
      boundary,
      "file",
      "test-photo.jpg",
      VALID_JPEG_BUFFER,
      "image/jpeg",
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/media",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    console.log("JPEG Upload Response:", res.statusCode, res.body);
    expect(res.statusCode).toBe(201);
  });

  it("successfully uploads a valid WebP image", async () => {
    const boundary = `----WebKitFormBoundary${crypto.randomBytes(8).toString("hex")}`;
    const payload = buildMultipart(
      boundary,
      "file",
      "test-graphic.webp",
      VALID_WEBP_BUFFER,
      "image/webp",
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/media",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    console.log("WebP Upload Response:", res.statusCode, res.body);
    expect(res.statusCode).toBe(201);
  });

  it("successfully uploads a valid GIF image", async () => {
    const boundary = `----WebKitFormBoundary${crypto.randomBytes(8).toString("hex")}`;
    const payload = buildMultipart(
      boundary,
      "file",
      "test-anim.gif",
      VALID_GIF_BUFFER,
      "image/gif",
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/media",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    console.log("GIF Upload Response:", res.statusCode, res.body);
    expect(res.statusCode).toBe(201);
  });

  it("successfully uploads an image with Arabic/Unicode filename and spaces", async () => {
    const boundary = `----WebKitFormBoundary${crypto.randomBytes(8).toString("hex")}`;
    const payload = buildMultipart(
      boundary,
      "file",
      "صورة الشعار الجديد (1).png",
      VALID_PNG_BUFFER,
      "image/png",
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/media",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    console.log("Unicode Upload Response:", res.statusCode, res.body);
    expect(res.statusCode).toBe(201);
  });

  it("successfully uploads an image with multiple dots in filename", async () => {
    const boundary = `----WebKitFormBoundary${crypto.randomBytes(8).toString("hex")}`;
    const payload = buildMultipart(
      boundary,
      "file",
      "Screenshot 2026-08-17 at 12.34.56 PM.png",
      VALID_PNG_BUFFER,
      "image/png",
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/media",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    console.log("Multiple Dots Upload Response:", res.statusCode, res.body);
    expect(res.statusCode).toBe(201);
  });

  it("successfully uploads a valid SVG logo/icon", async () => {
    const boundary = `----WebKitFormBoundary${crypto.randomBytes(8).toString("hex")}`;
    const svgBuffer = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><circle cx="50" cy="50" r="40" fill="red"/></svg>`,
    );
    const payload = buildMultipart(
      boundary,
      "file",
      "logo.svg",
      svgBuffer,
      "image/svg+xml",
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/media",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    console.log("SVG Upload Response:", res.statusCode, res.body);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.media.mimeType).toBe("image/svg+xml");
    expect(body.media.assetType).toBe("image");
    expect(body.media.width).toBe(100);
    expect(body.media.height).toBe(100);
  });

  it("rejects malicious SVG containing script tags with 422 and structured error", async () => {
    const boundary = `----WebKitFormBoundary${crypto.randomBytes(8).toString("hex")}`;
    const maliciousSvg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg"><script>alert('XSS')</script></svg>`,
    );
    const payload = buildMultipart(
      boundary,
      "file",
      "malicious.svg",
      maliciousSvg,
      "image/svg+xml",
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/media",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.errors).toBeDefined();
    expect(body.errors[0].code).toBe("MEDIA_INVALID_FILE");
    expect(body.errors[0].message).toContain("unsafe scripts");
  });

  it("successfully uploads a valid ICO favicon", async () => {
    const boundary = `----WebKitFormBoundary${crypto.randomBytes(8).toString("hex")}`;
    const icoBuffer = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10]);
    const payload = buildMultipart(
      boundary,
      "file",
      "favicon.ico",
      icoBuffer,
      "image/x-icon",
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/media",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.media.mimeType).toBe("image/x-icon");
    expect(body.media.assetType).toBe("image");
  });

  it("successfully uploads a valid PDF document", async () => {
    const boundary = `----WebKitFormBoundary${crypto.randomBytes(8).toString("hex")}`;
    const pdfBuffer = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
    const payload = buildMultipart(
      boundary,
      "file",
      "report.pdf",
      pdfBuffer,
      "application/pdf",
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/media",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.media.mimeType).toBe("application/pdf");
    expect(body.media.assetType).toBe("file");
  });
});
