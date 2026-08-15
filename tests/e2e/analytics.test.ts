import { test, expect } from "@playwright/test";

/**
 * Analytics v1 E2E — public web traffic reaches the Admin dashboard.
 * Runs against the dev stack (localhost:7777) with seeded dev users.
 *
 * Flow: visit a published public post → the tracker beacon fires → the
 * existing Analytics queue + worker persist the event → the Admin Analytics
 * overview reports the view.
 */

// Overridable so the suite can target the real gateway (e.g. a LAN
// address) when a local app occupies localhost:7777.
const BASE = process.env.VIBRESS_E2E_BASE || "http://localhost:7777";

// The analytics pipeline correctly treats automation UAs (e.g.
// "HeadlessChrome") as bots. Use a realistic browser UA for the traffic
// tests so page views count as real visitors.
test.use({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
});
// Origin header allowed by the dev API's CORS/staff-origin allow-list.
const ORIGIN = "http://localhost:7777";

test.describe.serial("Analytics v1 — public traffic to dashboard", () => {
  let postSlug = "";
  let ownerCookie = "";

  test.beforeAll(async ({ request }) => {
    // Clean slate for traffic events (only this suite writes analytics_events).
    await request.post(`${BASE}/api/admin/v1/auth/login`, {
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      data: { email: "owner@example.com", password: "OwnerPass123!" },
    });
    // Use the API directly to clear traffic events deterministically.
    const admin = await request.post(`${BASE}/api/admin/v1/auth/login`, {
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      data: { email: "owner@example.com", password: "OwnerPass123!" },
    });
    const adminCookie =
      ((admin.headers()["set-cookie"] as unknown as string) || "").split(
        ";",
      )[0] ?? "";

    // Login as the seeded owner
    const loginRes = await request.post(`${BASE}/api/admin/v1/auth/login`, {
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      data: { email: "owner@example.com", password: "OwnerPass123!" },
    });
    expect(loginRes.status()).toBe(200);
    const setCookie =
      (loginRes.headers()["set-cookie"] as unknown as string) || "";
    ownerCookie = setCookie.split(";")[0] ?? "";
    const loginData = await loginRes.json();

    // Create + publish a post
    postSlug = `analytics-e2e-${Date.now()}`;
    const postRes = await request.post(`${BASE}/api/admin/v1/posts`, {
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGIN,
        cookie: ownerCookie,
      },
      data: {
        title: "Analytics E2E Post",
        slug: postSlug,
        content: {
          schema: "vibress-studio",
          version: 1,
          root: {
            type: "root",
            children: [
              {
                type: "paragraph",
                children: [{ type: "text", text: "Analytics E2E body." }],
              },
            ],
          },
        },
        primaryAuthorId: loginData.user.id,
      },
    });
    expect(postRes.status()).toBe(201);
    const post = (await postRes.json()).post;
    await request.post(`${BASE}/api/admin/v1/posts/${post.id}/publish`, {
      headers: { Origin: ORIGIN, cookie: ownerCookie },
    });
  });

  test("visiting a public post records a view visible in Admin Analytics", async ({
    page,
    request,
  }) => {
    // 1. Visit the published public post (tracker beacon fires)
    const res = await page.goto(`${BASE}/posts/${postSlug}`);
    expect(res?.status()).toBe(200);

    // 2. Poll the Analytics overview until the view is processed by the worker
    let overview: any = null;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(500);
      const overviewRes = await request.get(
        `${BASE}/api/admin/v1/analytics/overview?range=7d`,
        {
          headers: { cookie: ownerCookie },
        },
      );
      if (overviewRes.status() !== 200) continue;
      overview = await overviewRes.json();
      if ((overview.summary?.views ?? 0) >= 1) break;
    }
    expect(overview?.summary?.views ?? 0).toBeGreaterThanOrEqual(1);

    // 3. Top content includes the post path
    const paths = (overview.topContent ?? []).map(
      (c: { path: string }) => c.path,
    );
    expect(paths).toContain(`/posts/${postSlug}`);
  });

  async function overview(request: any): Promise<any> {
    const res = await request.get(
      `${BASE}/api/admin/v1/analytics/overview?range=7d`,
      {
        headers: { cookie: ownerCookie },
      },
    );
    return res.status() === 200
      ? res.json()
      : { summary: { views: 0, visitors: 0 }, topContent: [] };
  }

  test("multiple views by the same visitor count as one visitor", async ({
    page,
    request,
  }) => {
    // Capture the visitor baseline, then refresh the post twice in the SAME
    // browser context (same anonymous visitor).
    const before = await overview(request);
    await page.goto(`${BASE}/posts/${postSlug}`);
    await page.goto(`${BASE}/posts/${postSlug}`);

    let after = before;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(500);
      after = await overview(request);
      if ((after.summary?.views ?? 0) >= (before.summary?.views ?? 0) + 2)
        break;
    }
    expect(after.summary?.views ?? 0).toBeGreaterThanOrEqual(
      (before.summary?.views ?? 0) + 2,
    );
    // Two extra views from the SAME context → only ONE new visitor.
    expect(after.summary?.visitors ?? 0).toBe(
      (before.summary?.visitors ?? 0) + 1,
    );
  });

  test("a second browser context counts as a new visitor", async ({
    browser,
    request,
  }) => {
    const before = await overview(request);
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/posts/${postSlug}`);
    // Let the beacon flush before closing (sendBeacon is async).
    await page.waitForTimeout(1000);
    await page.close();
    await context.close();

    let after = before;
    for (let i = 0; i < 40; i++) {
      after = await overview(request);
      if ((after.summary?.visitors ?? 0) >= (before.summary?.visitors ?? 0) + 1)
        break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(after.summary?.visitors ?? 0).toBe(
      (before.summary?.visitors ?? 0) + 1,
    );
  });
});
