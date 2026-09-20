import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
import { getDbPool } from "@vibress/database";

describe("Phase 6 — Admin Member CSV Import / Export", () => {
  let app: FastifyInstance;
  let ownerCookie: string;

  beforeAll(async () => {
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
    const setCookie = loginRes.headers["set-cookie"];
    ownerCookie = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string);
  });

  afterAll(async () => {
    await app.close();
  });

  it("exports members as CSV with formula injection protection", async () => {
    // Insert a test member with formula-like name
    const pool = getDbPool();
    const formulaEmail = `formula-${Date.now()}@example.com`;
    await pool.query(
      `insert into members (id, publication_id, email, email_normalized, name, status) values ($1, 'pub_default', $2, $3, '=SUM(1+1)', 'active')`,
      [`form-${Date.now()}`, formulaEmail, formulaEmail],
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/members/export",
      headers: { cookie: ownerCookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment; filename=");
    expect(res.body).toContain("id,email,name,status,email_verified,created_at");
    // Escaped formula injection
    expect(res.body).toContain("'=SUM(1+1)");
  });

  it("dry-run import validates rows without mutating database", async () => {
    const csvContent = `email,name
dry1-${Date.now()}@example.com,Dry Runner One
dry2-${Date.now()}@example.com,Dry Runner Two
bad-email-no-at,Invalid Row
`;

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/members/import",
      headers: {
        cookie: ownerCookie,
        origin: "http://localhost:7779",
      },
      payload: {
        csv: csvContent,
        dryRun: true,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(3);
    expect(body.valid).toBe(2);
    expect(body.invalid).toBe(1);
    expect(body.created).toBe(2);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].row).toBe(3);

    // Verify nothing created in DB
    const pool = getDbPool();
    const countRes = await pool.query(
      `select count(*)::int as c from members where email like 'dry1-%'`,
    );
    expect(countRes.rows[0].c).toBe(0);
  });

  it("actual import creates members successfully", async () => {
    const unique = Date.now();
    const csvContent = `email,name
import1-${unique}@example.com,Imported User 1
import2-${unique}@example.com,Imported User 2
`;

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/members/import",
      headers: {
        cookie: ownerCookie,
        origin: "http://localhost:7779",
      },
      payload: {
        csv: csvContent,
        dryRun: false,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(2);
    expect(body.valid).toBe(2);
    expect(body.created).toBe(2);

    // Verify rows exist in DB
    const pool = getDbPool();
    const countRes = await pool.query(
      `select count(*)::int as c from members where email like 'import%-${unique}@example.com'`,
    );
    expect(countRes.rows[0].c).toBe(2);
  });
});
