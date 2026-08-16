import { test, expect } from "@playwright/test";

/**
 * First-Run Setup Wizard E2E — runs against the dedicated fresh-install
 * stack (compose.setup-e2e.yml, gateway at http://localhost:8899), which has
 * its own fresh database and is UNINSTALLED.
 *
 *   docker compose -f compose.setup-e2e.yml up -d --build
 *   npx playwright test tests/e2e/setup-wizard.test.ts
 *
 * Tests are serial: uninstalled-state tests run first, then installation
 * completes, then installed-state tests assert the permanent lock. The
 * existing suite (localhost:7777, seeded) is untouched.
 */

const BASE = "http://localhost:8899";
const SETUP_TOKEN = "setup-e2e-token-0123456789abcdef0123456789abcdef";
const OWNER_EMAIL = `owner-${Date.now()}@example.com`;

test.describe.serial("First-Run Setup Wizard (fresh instance)", () => {
  test.beforeAll(async () => {
    try {
      const res = await fetch(`${BASE}/api/setup/v1/status`);
      if (!res.ok) {
        test.skip(true, "Setup E2E instance (port 8899) not running; skipping isolated setup suite");
        return;
      }
      const data = await res.json();
      if (data.installed) {
        test.skip(true, "Setup E2E instance (port 8899) already completed installation; skipping");
        return;
      }
    } catch {
      test.skip(true, "Setup E2E instance (port 8899) not reachable; skipping isolated setup suite");
    }
  });

  test("fresh instance: wizard appears, wrong key and validation errors are rejected", async ({
    page,
  }) => {
    // Wizard appears
    await page.goto(`${BASE}/admin`);
    await expect(page.locator("body")).toContainText("First-run setup");
    await expect(page.locator("h1")).toContainText("Welcome");

    // Wrong setup key
    await page.fill("#setup-key", "wrong-setup-key-00000000000000000000");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toContainText("Invalid setup key");

    // Validation errors (weak password + invalid email)
    await page.fill("#setup-key", SETUP_TOKEN);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator("h1")).toContainText("Your site");
    await page.fill("#site-name", "Validation Site");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.fill("#owner-name", "Owner");
    await page.fill("#owner-email", "owner@validation.test");
    await page.fill("#owner-password", "short");
    await page.fill("#owner-password-confirm", "short");
    await page.getByRole("button", { name: "Install Vibress" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "at least 12 characters",
    );
  });

  test("mobile viewport renders the wizard with labels and keyboard focus", async ({
    browser,
  }) => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await page.goto(`${BASE}/admin`);
    await expect(page.locator("#setup-key")).toBeVisible();
    await page.locator("#setup-key").focus();
    await expect(page.locator("#setup-key")).toBeFocused();
    await expect(page.locator('label[for="setup-key"]')).toHaveText(
      "Setup key",
    );
    await page.close();
  });

  test("complete the wizard end-to-end and enter Admin automatically", async ({
    page,
  }) => {
    // Welcome — enter setup key
    await page.goto(`${BASE}/admin`);
    await page.fill("#setup-key", SETUP_TOKEN);
    await page.getByRole("button", { name: "Continue" }).click();
    // Site step
    await expect(page.locator("h1")).toContainText("Your site");
    await page.fill("#site-name", "E2E Wizard Site");
    await page.fill("#site-description", "Installed via the first-run wizard.");
    await page.getByRole("button", { name: "Continue" }).click();
    // Owner step
    await expect(page.locator("h1")).toContainText("Your account");
    await expect(page.locator("body")).toContainText(
      "Create the owner account",
    );
    await page.fill("#owner-name", "E2E Owner");
    await page.fill("#owner-email", OWNER_EMAIL);
    await page.fill("#owner-password", "StrongE2EPassword123!");
    await page.fill("#owner-password-confirm", "StrongE2EPassword123!");
    await page.getByRole("button", { name: "Install Vibress" }).click();
    // Owner enters Admin automatically (session cookie set by the server);
    // the brief "Vibress is ready." state transitions into the dashboard.
    await expect(page.locator("body")).toContainText("Analytics", {
      timeout: 30000,
    });
  });

  test("reload after installation: no wizard, /admin/setup redirects away", async ({
    page,
  }) => {
    await page.goto(`${BASE}/admin`);
    await expect(page.locator("body")).not.toContainText("First-run setup");
    await page.goto(`${BASE}/admin/setup`);
    await expect(page.locator("body")).not.toContainText("First-run setup");
  });

  test("setup stays permanently locked after installation (409 with correct token)", async ({
    request,
  }) => {
    const res = await request.post(`${BASE}/api/setup/v1/complete`, {
      headers: {
        "Content-Type": "application/json",
        Origin: BASE,
        "X-Vibress-Setup-Token": SETUP_TOKEN,
      },
      data: {
        site: { name: "Replay", description: "", locale: "en" },
        owner: {
          name: "Replay",
          email: `replay-${Date.now()}@example.com`,
          password: "StrongE2EPassword123!",
        },
      },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.errors[0].code).toBe("SETUP_ALREADY_COMPLETED");

    const status = await request.get(`${BASE}/api/setup/v1/status`);
    expect(await status.json()).toEqual({ installed: true });
  });
});
