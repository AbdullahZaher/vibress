import { test, expect } from "@playwright/test";

test.describe("Batch 8 Member Auth E2E Suite", () => {
  test.beforeEach(async () => {
    await fetch("http://127.0.0.1:8025/api/v1/messages", {
      method: "DELETE",
    }).catch(() => {});
  });

  async function getLatestMagicLink(email: string): Promise<string> {
    for (let i = 0; i < 25; i++) {
      const res = await fetch("http://127.0.0.1:8025/api/v1/messages");
      const data = await res.json();
      const matches = (data.messages || [])
        .filter((m: any) => m.To?.[0]?.Address === email)
        .sort(
          (a: any, b: any) =>
            new Date(b.Created).getTime() - new Date(a.Created).getTime(),
        );
      if (matches.length > 0) {
        const msg = matches[0];
        const detail = await (
          await fetch(`http://127.0.0.1:8025/api/v1/message/${msg.ID}`)
        ).json();
        const link = (detail.HTML || "").match(/href="([^"]+)"/)?.[1];
        if (link) return link;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`expected a mail to ${email}`);
  }

  async function loginAsStaff(request: any) {
    await request.post("http://localhost:7777/api/admin/v1/auth/login", {
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:7777",
      },
      data: { email: "owner@example.com", password: "OwnerPass123!" },
    });
  }

  test("[New Member] Full magic-link signup → account", async ({
    page,
    request,
  }) => {
    const email = `e2e-member-${Date.now()}@example.com`;

    // 1. Visit portal sign-in
    await page.goto("http://localhost:7777/portal/");
    await expect(page.locator("h1")).toContainText("Vibress");

    // 2. Enter email
    await page.fill("#email", email);
    await page.click('button[type="submit"]');

    // 3. Check-email screen
    await expect(page.locator("h1")).toContainText("Check your email");

    // 4. Get magic link from Mailpit
    const link = await getLatestMagicLink(email);

    // 5. Open link
    await page.goto(link);

    // 6. Account page with member email
    await expect(page.locator("h1")).toContainText("Your account");
    await expect(page.locator("body")).toContainText(email);

    // 7. Session persists on refresh
    await page.reload();
    await expect(page.locator("h1")).toContainText("Your account");
  });

  test("[Existing Member] Login again keeps same member id, no duplicate", async ({
    page,
    request,
  }) => {
    const email = `e2e-existing-${Date.now()}@example.com`;

    // First signup
    await page.goto("http://localhost:7777/portal/");
    await page.fill("#email", email);
    await page.click('button[type="submit"]');
    await expect(page.locator("h1")).toContainText("Check your email");
    const link1 = await getLatestMagicLink(email);
    await page.goto(link1);
    await expect(page.locator("h1")).toContainText("Your account");
    const memberId1 = await page.evaluate(async () => {
      const res = await fetch("/api/members/v1/me", { credentials: "include" });
      return (await res.json()).member.id;
    });

    // Logout
    await page.click('button:has-text("Sign out")');
    await expect(page.locator("h1")).toContainText("Vibress");

    // Second login
    await page.fill("#email", email);
    await page.click('button[type="submit"]');
    await expect(page.locator("h1")).toContainText("Check your email");
    const link2 = await getLatestMagicLink(email);
    await page.goto(link2);
    await expect(page.locator("h1")).toContainText("Your account");
    const memberId2 = await page.evaluate(async () => {
      const res = await fetch("/api/members/v1/me", { credentials: "include" });
      return (await res.json()).member.id;
    });

    expect(memberId2).toBe(memberId1);

    // Exactly one member row for this email
    await loginAsStaff(request);
    const listRes = await request.get(
      `http://localhost:7777/api/admin/v1/members?search=${encodeURIComponent(email)}`,
      {
        headers: { Origin: "http://localhost:7777" },
      },
    );
    const listData = await listRes.json();
    expect(listData.total).toBe(1);
  });

  test("[Logout] Member cookie revoked, account requires sign-in", async ({
    page,
  }) => {
    const email = `e2e-logout-${Date.now()}@example.com`;
    await page.goto("http://localhost:7777/portal/");
    await page.fill("#email", email);
    await page.click('button[type="submit"]');
    await expect(page.locator("h1")).toContainText("Check your email");
    const link = await getLatestMagicLink(email);
    await page.goto(link);
    await expect(page.locator("h1")).toContainText("Your account");

    await page.click('button:has-text("Sign out")');
    await expect(page.locator("h1")).toContainText("Vibress");

    // Protected account redirects to sign-in
    await page.goto("http://localhost:7777/portal/#/account");
    await expect(page.locator("h1")).toContainText(
      "Your session is no longer valid",
    );
  });

  test("[Staff + Member Coexistence] Both identities independent", async ({
    page,
  }) => {
    const email = `e2e-coexist-${Date.now()}@example.com`;

    // Staff login first (direct cookie set)
    const res = await page.goto("http://localhost:7777/admin/login");
    await page.fill("#email", "owner@example.com");
    await page.fill("#password", "OwnerPass123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/admin");

    // Member signup via portal (separate context cookie via same browser)
    await page.goto("http://localhost:7777/portal/");
    await page.fill("#email", email);
    await page.click('button[type="submit"]');
    await expect(page.locator("h1")).toContainText("Check your email");
    const link = await getLatestMagicLink(email);
    await page.goto(link);
    await expect(page.locator("h1")).toContainText("Your account");

    // Admin still works (staff session intact)
    await page.goto("http://localhost:7777/admin");
    await expect(page.locator("body")).toContainText("owner@example.com");
  });

  test("[Staff Cookie Rejected by Member API]", async ({ request }) => {
    await loginAsStaff(request);
    const res = await request.get("http://localhost:7777/api/members/v1/me");
    expect(res.status()).toBe(401);
  });

  test("[Member Cookie Rejected by Admin API]", async ({ page }) => {
    const email = `e2e-isolation-${Date.now()}@example.com`;
    await page.goto("http://localhost:7777/portal/");
    await page.fill("#email", email);
    await page.click('button[type="submit"]');
    await expect(page.locator("h1")).toContainText("Check your email");
    const link = await getLatestMagicLink(email);
    await page.goto(link);
    await expect(page.locator("h1")).toContainText("Your account");

    // Member-only browser calling admin API → 401
    const status = await page.evaluate(async () => {
      const res = await fetch("/api/admin/v1/members", {
        credentials: "include",
      });
      return res.status;
    });
    expect(status).toBe(401);
  });

  test("[Disable Member] Session invalidated; re-enable requires new login", async ({
    page,
    request,
  }) => {
    const email = `e2e-disable-${Date.now()}@example.com`;

    // Member signup
    await page.goto("http://localhost:7777/portal/");
    await page.fill("#email", email);
    await page.click('button[type="submit"]');
    await expect(page.locator("h1")).toContainText("Check your email");
    const link = await getLatestMagicLink(email);
    await page.goto(link);
    await expect(page.locator("h1")).toContainText("Your account");

    // Get member id
    const memberId = await page.evaluate(async () => {
      const res = await fetch("/api/members/v1/me", { credentials: "include" });
      return (await res.json()).member.id;
    });

    // Staff disables member
    await loginAsStaff(request);
    const disableRes = await request.post(
      `http://localhost:7777/api/admin/v1/members/${memberId}/disable`,
      {
        headers: { Origin: "http://localhost:7777" },
      },
    );
    expect(disableRes.status()).toBe(200);

    // Member session invalid → account shows sign-in
    await page.goto("http://localhost:7777/portal/#/account");
    await expect(page.locator("h1")).toContainText(
      "Your session is no longer valid",
    );

    // Re-enable
    await request.post(
      `http://localhost:7777/api/admin/v1/members/${memberId}/enable`,
      {
        headers: { Origin: "http://localhost:7777" },
      },
    );

    // Old session still invalid
    await page.goto("http://localhost:7777/portal/#/account");
    await expect(page.locator("h1")).toContainText(
      "Your session is no longer valid",
    );

    // New magic link works
    await fetch("http://127.0.0.1:8025/api/v1/messages", { method: "DELETE" }).catch(() => {});
    await page.goto("http://localhost:7777/portal/");
    await page.fill("#email", email);
    await page.click('button[type="submit"]');
    await expect(page.locator("h1")).toContainText("Check your email");
    const link2 = await getLatestMagicLink(email);
    await page.goto(link2);
    await expect(page.locator("h1")).toContainText("Your account");
  });

  test("[Enumeration] Known vs unknown email identical response", async ({
    request,
  }) => {
    const known = "reuse@example.com";
    const unknown = `nobody-${Date.now()}@example.com`;

    const knownRes = await request.post(
      "http://localhost:7777/api/members/v1/auth/request",
      {
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:7777",
        },
        data: { email: known },
      },
    );
    const unknownRes = await request.post(
      "http://localhost:7777/api/members/v1/auth/request",
      {
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:7777",
        },
        data: { email: unknown },
      },
    );

    expect(knownRes.status()).toBe(200);
    expect(unknownRes.status()).toBe(200);
    const knownBody = await knownRes.json();
    const unknownBody = await unknownRes.json();
    expect(JSON.stringify(knownBody)).toBe(JSON.stringify(unknownBody));
  });

  test("[Token Reuse] Second verification fails", async ({ page }) => {
    const email = `e2e-reuse-${Date.now()}@example.com`;
    await page.goto("http://localhost:7777/portal/");
    await page.fill("#email", email);
    await page.click('button[type="submit"]');
    await expect(page.locator("h1")).toContainText("Check your email");
    const link = await getLatestMagicLink(email);

    // First use
    await page.goto(link);
    await expect(page.locator("h1")).toContainText("Your account");

    // Second use (new browser context = no cookie)
    const page2 = await page.context().newPage();
    await page2.goto(link);
    await expect(page2.locator("body")).toContainText("invalid or expired");
  });
});
