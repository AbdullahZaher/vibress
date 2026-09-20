import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
import { newslettersService } from "../services";
import { getDbPool } from "@vibress/database";

describe("Area 1 & Phases 7-8 — Double Opt-In Scanner Safety & Token Lifecycle", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("Scanner GET repeated 5+ times is non-mutating and leaves token valid for subsequent POST", async () => {
    const pool = getDbPool();
    const memberId = `m-scanner-${Date.now()}`;
    const email = `scanner-${Date.now()}@example.com`;
    const newsletterId = `nl-scanner-${Date.now()}`;

    await pool.query(
      `insert into members (id, publication_id, email, email_normalized, status) values ($1, 'pub_default', $2, $3, 'active')`,
      [memberId, email, email],
    );

    await pool.query(
      `insert into newsletters (id, publication_id, name, key, sender_name, sender_email, status) values ($1, 'pub_default', 'Scanner News', $2, 'Publisher', 'news@vibress.io', 'active')`,
      [newsletterId, `scanner-key-${Date.now()}`],
    );

    const token = newslettersService.signOptInToken(memberId, newsletterId);

    // 1. Simulate enterprise email security scanner hitting GET 5 times in succession
    for (let i = 0; i < 5; i++) {
      const scanRes = await app.inject({
        method: "GET",
        url: `/api/public/v1/newsletters/confirm?token=${encodeURIComponent(token)}`,
      });
      expect(scanRes.statusCode).toBe(200);
      const scanBody = JSON.parse(scanRes.body);
      expect(scanBody.valid).toBe(true);
      expect(scanBody.pendingConfirmation).toBe(true);
      expect(scanBody.memberId).toBe(memberId);
      expect(scanBody.newsletterId).toBe(newsletterId);
    }

    // 2. Verify database state is untouched (no preference row exists or subscribed is not true)
    const prefCheck = await pool.query(
      `select * from newsletter_preferences where member_id = $1 and newsletter_id = $2`,
      [memberId, newsletterId],
    );
    expect(prefCheck.rows.length === 0 || prefCheck.rows[0].subscribed === false).toBe(true);

    // 3. User explicitly confirms via POST
    const confirmRes = await app.inject({
      method: "POST",
      url: "/api/public/v1/newsletters/confirm",
      payload: { token },
    });
    expect(confirmRes.statusCode).toBe(200);
    const confirmBody = JSON.parse(confirmRes.body);
    expect(confirmBody.confirmed).toBe(true);
    expect(confirmBody.memberId).toBe(memberId);
    expect(confirmBody.newsletterId).toBe(newsletterId);

    // 4. Verify DB is now mutated to subscribed = true
    const postConfirmPref = await pool.query(
      `select * from newsletter_preferences where member_id = $1 and newsletter_id = $2`,
      [memberId, newsletterId],
    );
    expect(postConfirmPref.rows[0].subscribed).toBe(true);

    // 5. Replay POST fails because token has already been used
    const replayRes = await app.inject({
      method: "POST",
      url: "/api/public/v1/newsletters/confirm",
      payload: { token },
    });
    expect(replayRes.statusCode).toBe(400);
    const replayBody = JSON.parse(replayRes.body);
    expect(replayBody.errors[0].code).toBe("TOKEN_ALREADY_USED");
  });

  it("rejects expired, tampered, or forged opt-in tokens on both GET and POST", async () => {
    const expiredToken = newslettersService.signOptInToken(
      "m1",
      "nl1",
      Date.now() - 8 * 24 * 60 * 60 * 1000,
    );

    const getExpired = await app.inject({
      method: "GET",
      url: `/api/public/v1/newsletters/confirm?token=${encodeURIComponent(expiredToken)}`,
    });
    expect(getExpired.statusCode).toBe(400);

    const postExpired = await app.inject({
      method: "POST",
      url: "/api/public/v1/newsletters/confirm",
      payload: { token: expiredToken },
    });
    expect(postExpired.statusCode).toBe(400);

    const forgedRes = await app.inject({
      method: "POST",
      url: "/api/public/v1/newsletters/confirm",
      payload: { token: "forged.token.here" },
    });
    expect(forgedRes.statusCode).toBe(400);
  });

  it("rejects confirmation when newsletter does not exist or member is disabled/deleted", async () => {
    const pool = getDbPool();
    const disabledMemberId = `m-disabled-${Date.now()}`;
    const email = `disabled-${Date.now()}@example.com`;
    const newsletterId = `nl-dis-${Date.now()}`;

    await pool.query(
      `insert into members (id, publication_id, email, email_normalized, status) values ($1, 'pub_default', $2, $3, 'disabled')`,
      [disabledMemberId, email, email],
    );

    await pool.query(
      `insert into newsletters (id, publication_id, name, key, sender_name, sender_email, status) values ($1, 'pub_default', 'Dis News', $2, 'Publisher', 'news@vibress.io', 'active')`,
      [newsletterId, `dis-key-${Date.now()}`],
    );

    const tokenForDisabled = newslettersService.signOptInToken(disabledMemberId, newsletterId);

    const disabledPost = await app.inject({
      method: "POST",
      url: "/api/public/v1/newsletters/confirm",
      payload: { token: tokenForDisabled },
    });
    expect(disabledPost.statusCode).toBe(400);

    // Non-existent newsletter
    const nonExistentNlToken = newslettersService.signOptInToken(disabledMemberId, "nl-nonexistent");
    const nonExistentRes = await app.inject({
      method: "POST",
      url: "/api/public/v1/newsletters/confirm",
      payload: { token: nonExistentNlToken },
    });
    expect(nonExistentRes.statusCode).toBe(400);
  });

  it("handles concurrent confirmation requests cleanly with exactly 1 winning activation", async () => {
    const pool = getDbPool();
    const memberId = `m-race-${Date.now()}`;
    const email = `race-${Date.now()}@example.com`;
    const newsletterId = `nl-race-${Date.now()}`;

    await pool.query(
      `insert into members (id, publication_id, email, email_normalized, status) values ($1, 'pub_default', $2, $3, 'active')`,
      [memberId, email, email],
    );

    await pool.query(
      `insert into newsletters (id, publication_id, name, key, sender_name, sender_email, status) values ($1, 'pub_default', 'Race News', $2, 'Publisher', 'news@vibress.io', 'active')`,
      [newsletterId, `race-key-${Date.now()}`],
    );

    const token = newslettersService.signOptInToken(memberId, newsletterId);

    // Fire 5 concurrent POST requests with the same token
    const results = await Promise.all(
      Array.from({ length: 5 }).map(() =>
        app.inject({
          method: "POST",
          url: "/api/public/v1/newsletters/confirm",
          payload: { token },
        }),
      ),
    );

    const successful = results.filter((r) => r.statusCode === 200);
    const rejected = results.filter((r) => r.statusCode === 400);

    expect(successful.length).toBe(1);
    expect(rejected.length).toBe(4);

    const finalPref = await pool.query(
      `select * from newsletter_preferences where member_id = $1 and newsletter_id = $2`,
      [memberId, newsletterId],
    );
    expect(finalPref.rows.length).toBe(1);
    expect(finalPref.rows[0].subscribed).toBe(true);
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
