import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../main";
import { getDb, users, userRoles, roles } from "@vibress/database";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { hashPassword } from "@vibress/security";

async function ensureTestStaffUser(): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, "bodylimit-owner@example.com"))
    .limit(1);
  if (rows.length > 0) return;
  const hash = await hashPassword("OwnerPass123!");
  const ownerId = crypto.randomUUID();
  await db
    .insert(users)
    .values({
      id: ownerId,
      email: "bodylimit-owner@example.com",
      name: "BodyLimit Owner",
      slug: "bodylimit-owner",
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

async function loginStaff(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/admin/v1/auth/login",
    payload: {
      email: "bodylimit-owner@example.com",
      password: "OwnerPass123!",
    },
  });
  expect(res.statusCode).toBe(200);
  const setCookie = (res.headers["set-cookie"] as unknown as string) || "";
  return setCookie.split(";")[0] ?? "";
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

describe("Body Limit Enforcement", () => {
  let app: FastifyInstance;
  let staffCookie: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    await ensureTestStaffUser();
    staffCookie = await loginStaff(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects oversized JSON on auth routes with HTTP 413", async () => {
    const largePadding = "a".repeat(1.5 * 1024 * 1024);
    const oversizedBody = JSON.stringify({
      email: "attacker@example.com",
      password: "password123",
      padding: largePadding,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      headers: {
        "content-type": "application/json",
      },
      payload: oversizedBody,
    });

    expect(res.statusCode).toBe(413);
    const body = res.json();
    expect(body.errors[0].code).toBe("FST_ERR_CTP_BODY_TOO_LARGE");
  });

  it("rejects oversized JSON on member auth routes with HTTP 413", async () => {
    const largePadding = "a".repeat(1.5 * 1024 * 1024);
    const oversizedBody = JSON.stringify({
      email: "member@example.com",
      padding: largePadding,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/members/v1/auth/request",
      headers: {
        "content-type": "application/json",
      },
      payload: oversizedBody,
    });

    expect(res.statusCode).toBe(413);
  });

  it("rejects oversized JSON on setup routes with HTTP 413", async () => {
    const largePadding = "a".repeat(1.5 * 1024 * 1024);
    const oversizedBody = JSON.stringify({
      email: "owner@example.com",
      name: "Owner",
      password: "Password123!",
      siteName: "My Site",
      padding: largePadding,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/setup/v1/owner",
      headers: {
        "content-type": "application/json",
      },
      payload: oversizedBody,
    });

    expect(res.statusCode).toBe(413);
  });

  it("rejects oversized JSON on billing webhook routes with HTTP 413", async () => {
    const largePadding = "a".repeat(1.5 * 1024 * 1024);
    const oversizedBody = JSON.stringify({
      id: "evt_123",
      type: "customer.subscription.updated",
      padding: largePadding,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/v1/stripe",
      headers: {
        "content-type": "application/json",
        "stripe-signature": "t=123,v1=sig",
      },
      payload: oversizedBody,
    });

    expect(res.statusCode).toBe(413);
  });

  it("allows multipart media uploads larger than 1MB (route bodyLimit overrides global 1MB limit)", async () => {
    // 1.2MB valid SVG buffer (exceeds global 1MB limit, but within 500MB route limit and 20MB image limit)
    const padding = "x".repeat(1.2 * 1024 * 1024);
    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><!-- ${padding} --></svg>`;
    const fileBuffer = Buffer.from(svgContent, "utf8");

    const boundary = `----WebKitFormBoundary${crypto.randomBytes(8).toString("hex")}`;
    const payload = buildMultipart(
      boundary,
      "file",
      "large-banner.svg",
      fileBuffer,
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

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.media).toBeDefined();
    expect(body.media.id).toBeDefined();
    expect(body.media.sizeBytes).toBeGreaterThan(1024 * 1024);
  });

  it("rejects multipart upload above 500MB on /media with HTTP 413", async () => {
    // Inject a request with declared content-length exceeding 500MB route bodyLimit
    const boundary = `----WebKitFormBoundary${crypto.randomBytes(8).toString("hex")}`;
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="huge.mp4"\r\nContent-Type: video/mp4\r\n\r\n`,
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/media",
      headers: {
        cookie: staffCookie,
        origin: "http://localhost:7777",
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": "530000000", // 530MB declared content-length
      },
      payload: head,
    });

    expect(res.statusCode).toBe(413);
  });
});
