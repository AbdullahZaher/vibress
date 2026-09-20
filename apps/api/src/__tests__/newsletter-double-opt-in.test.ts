import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
import { newslettersService } from "../services";

describe("Phase 7 & 8 — Newsletter Double Opt-In & Unsubscribe Tokens", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST and GET /newsletters/confirm confirms double opt-in subscription", async () => {
    const { getDbPool } = await import("@vibress/database");
    const pool = getDbPool();
    const memberId = `m-optin-${Date.now()}`;
    const email = `optin-${Date.now()}@example.com`;
    const newsletterId = `nl-optin-${Date.now()}`;

    await pool.query(
      `insert into members (id, publication_id, email, email_normalized, status) values ($1, 'pub_default', $2, $3, 'active')`,
      [memberId, email, email],
    );

    await pool.query(
      `insert into newsletters (id, publication_id, name, key, sender_name, sender_email, status) values ($1, 'pub_default', 'Weekly Optin', $2, 'Publisher', 'newsletter@vibress.io', 'active')`,
      [newsletterId, `weekly-optin-${Date.now()}`],
    );

    const token = newslettersService.signOptInToken(memberId, newsletterId);

    // POST /api/public/v1/newsletters/confirm
    const postRes = await app.inject({
      method: "POST",
      url: "/api/public/v1/newsletters/confirm",
      payload: { token },
    });

    expect(postRes.statusCode).toBe(200);
    const postBody = JSON.parse(postRes.body);
    expect(postBody.confirmed).toBe(true);
    expect(postBody.memberId).toBe(memberId);

    // GET /api/public/v1/newsletters/confirm
    const token2 = newslettersService.signOptInToken(memberId, newsletterId);
    const getRes = await app.inject({
      method: "GET",
      url: `/api/public/v1/newsletters/confirm?token=${encodeURIComponent(token2)}`,
    });

    expect(getRes.statusCode).toBe(200);
    const getBody = JSON.parse(getRes.body);
    expect(getBody.confirmed).toBe(true);
  });

  it("rejects expired or forged opt-in token", async () => {
    const expiredToken = newslettersService.signOptInToken(
      "m1",
      "nl1",
      Date.now() - 8 * 24 * 60 * 60 * 1000,
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/public/v1/newsletters/confirm",
      payload: { token: expiredToken },
    });
    expect(res.statusCode).toBe(400);

    const forgedRes = await app.inject({
      method: "POST",
      url: "/api/public/v1/newsletters/confirm",
      payload: { token: "forged.token.here" },
    });
    expect(forgedRes.statusCode).toBe(400);
  });

  it("POST /api/public/v1/unsubscribe rejects expired or tampered unsubscribe tokens", async () => {
    const expiredToken = newslettersService.signUnsubscribeToken(
      "m1",
      "s1",
      Date.now() - 400 * 24 * 60 * 60 * 1000,
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/public/v1/unsubscribe",
      payload: { token: expiredToken },
    });
    expect(res.statusCode).toBe(400);

    const tamperedRes = await app.inject({
      method: "POST",
      url: "/api/public/v1/unsubscribe",
      payload: { token: "tampered-token" },
    });
    expect(tamperedRes.statusCode).toBe(400);
  });
});
