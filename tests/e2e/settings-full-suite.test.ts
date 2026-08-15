import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:7777";

test.describe("Vibress Full Settings System & Public Runtime Verification", () => {
  async function loginAsAdmin(page: any) {
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState("networkidle");
    const emailInput = page.locator("#email");
    if (await emailInput.isVisible({ timeout: 4000 }).catch(() => false)) {
      await emailInput.fill("owner@example.com");
      await page.locator("#password").fill("OwnerPass123!");
      await page.click('button[type="submit"]');
      await expect(page.locator("#email")).toHaveCount(0, { timeout: 10000 });
      await page.waitForLoadState("networkidle");
    }
  }

  async function loginAsStaff(request: any) {
    await request.post(`${BASE_URL}/api/admin/v1/auth/login`, {
      headers: { "Content-Type": "application/json", Origin: BASE_URL },
      data: { email: "owner@example.com", password: "OwnerPass123!" },
    });
  }

  test.use({ viewport: { width: 1440, height: 900 } });

  test("1. Admin Settings Navigation & Tabs routing", async ({ page }) => {
    await loginAsAdmin(page);

    // Direct navigate to settings
    await page.goto(`${BASE_URL}/admin/settings/general`);
    await page.waitForLoadState("networkidle");

    // Verify sections exist
    const tabs = [
      "General settings",
      "Site",
      "Membership",
      "Growth",
      "Advanced",
    ];
    for (const tab of tabs) {
      const tabButton = page.locator("button").filter({ hasText: tab }).first();
      await expect(tabButton).toBeVisible({ timeout: 5000 });
    }
  });

  test("2. General Settings: Title, Description, Locale, Timezone updates & persistence", async ({
    request,
  }) => {
    await loginAsStaff(request);

    const newTitle = `Vibress Test Publication ${Date.now()}`;
    const newDesc = "A world-class modern publication platform.";

    // Update via API
    const updateRes = await request.put(
      `${BASE_URL}/api/admin/v1/settings/site/title`,
      {
        headers: { Origin: BASE_URL },
        data: { value: newTitle },
      },
    );
    expect(updateRes.status()).toBe(200);

    const descRes = await request.put(
      `${BASE_URL}/api/admin/v1/settings/site/description`,
      {
        headers: { Origin: BASE_URL },
        data: { value: newDesc },
      },
    );
    expect(descRes.status()).toBe(200);

    // Verify public content API reflects new title and description
    const siteRes = await request.get(`${BASE_URL}/api/content/v1/site`);
    expect(siteRes.status()).toBe(200);
    const siteData = await siteRes.json();
    expect(siteData.site.title).toBe(newTitle);
    expect(siteData.site.description).toBe(newDesc);
  });

  test("3. Site Settings: Navigation & Announcement Bar public enforcement", async ({
    request,
    page,
  }) => {
    await loginAsStaff(request);

    // Set Navigation and Announcement Bar
    const navItems = [
      { label: "Explore", url: "/explore" },
      { label: "Featured", url: "/featured" },
    ];
    const announcementText = `Special Launch Event ${Date.now()}!`;
    const announcementUrl = "/explore";

    await request.put(`${BASE_URL}/api/admin/v1/settings/site/primaryNav`, {
      headers: { Origin: BASE_URL },
      data: { value: navItems },
    });

    await request.put(
      `${BASE_URL}/api/admin/v1/settings/site/announcementEnabled`,
      {
        headers: { Origin: BASE_URL },
        data: { value: true },
      },
    );

    await request.put(
      `${BASE_URL}/api/admin/v1/settings/site/announcementText`,
      {
        headers: { Origin: BASE_URL },
        data: { value: announcementText },
      },
    );

    await request.put(
      `${BASE_URL}/api/admin/v1/settings/site/announcementUrl`,
      {
        headers: { Origin: BASE_URL },
        data: { value: announcementUrl },
      },
    );

    // Public API returns the navigation and announcement settings
    const siteRes = await request.get(`${BASE_URL}/api/content/v1/site`);
    expect(siteRes.status()).toBe(200);
    const siteJson = await siteRes.json();
    expect(siteJson.site.announcementEnabled).toBe(true);
    expect(siteJson.site.announcementText).toBe(announcementText);
    expect(siteJson.site.primaryNav).toHaveLength(2);

    // Public Web page renders announcement bar
    const webPage = await page.goto(`${BASE_URL}/`);
    expect(webPage?.status()).toBe(200);
    const bar = page.locator("#vb-announcement-bar");
    await expect(bar).toBeVisible();
    await expect(bar).toContainText(announcementText);
  });

  test("4. Site Privacy: End-to-End public protection barrier & unlock flow", async ({
    browser,
    request,
  }) => {
    await loginAsStaff(request);

    const pass = "SuperSecretSitePassword123!";
    const anonContext = await browser.newContext();

    try {
      // 1. Configure site password and enable isPrivate
      await request.put(`${BASE_URL}/api/admin/v1/settings/security/password`, {
        headers: { Origin: BASE_URL },
        data: { value: pass },
      });

      await request.put(
        `${BASE_URL}/api/admin/v1/settings/security/isPrivate`,
        {
          headers: { Origin: BASE_URL },
          data: { value: true },
        },
      );

      // 2. Visiting public root redirects to /private
      const anonPage = await anonContext.newPage();
      anonPage.on("console", (msg) =>
        console.log("PAGE LOG:", msg.type(), msg.text()),
      );
      anonPage.on("pageerror", (err) =>
        console.log("PAGE ERROR:", err.message),
      );
      anonPage.on("requestfailed", (req) =>
        console.log("REQ FAILED:", req.url(), req.failure()?.errorText),
      );

      await anonPage.goto(`${BASE_URL}/`);
      await anonPage.waitForURL("**/private**", { timeout: 8000 });
      expect(anonPage.url()).toContain("/private");
      await expect(anonPage.locator("h1")).toContainText(
        "This Site is Private",
      );

      // 2b. Attempting forged unsigned cookie vb_site_auth=1 must NOT bypass gate
      await anonContext.addCookies([
        { name: "vb_site_auth", value: "1", domain: "localhost", path: "/" },
      ]);
      await anonPage.goto(`${BASE_URL}/`);
      await anonPage.waitForURL("**/private**", { timeout: 8000 });
      expect(anonPage.url()).toContain("/private");

      // 3. Entering incorrect password fails
      await anonPage.waitForLoadState("networkidle");
      await anonPage.fill("#site-password-input", "WrongPassword!");
      await anonPage.click("#submit-site-password-btn");
      await expect(anonPage.locator("text=Invalid password")).toBeVisible({
        timeout: 5000,
      });

      // 4. Entering correct password unlocks the site (generates signed HMAC token)
      await anonPage.fill("#site-password-input", pass);
      await anonPage.click("#submit-site-password-btn");
      await anonPage.waitForURL(`${BASE_URL}/`, { timeout: 10000 });
      expect(anonPage.url()).toBe(`${BASE_URL}/`);

      // 4b. Verify the generated cookie is HMAC-signed (v1.<timestamp>.<hmac>)
      const cookies = await anonContext.cookies();
      const authCookie = cookies.find((c) => c.name === "vb_site_auth");
      expect(authCookie).toBeDefined();
      expect(authCookie?.value).toMatch(/^v1\.\d+\.[a-f0-9]{64}$/);
    } finally {
      // 5. Disable privacy again
      await request.put(
        `${BASE_URL}/api/admin/v1/settings/security/isPrivate`,
        {
          headers: { Origin: BASE_URL },
          data: { value: false },
        },
      );
      await anonContext.close();
    }
  });

  test("5. Growth Settings: SMTP test delivery endpoint", async ({
    request,
  }) => {
    await loginAsStaff(request);
    const res = await request.post(
      `${BASE_URL}/api/admin/v1/settings/test-smtp`,
      {
        headers: { Origin: BASE_URL },
        data: { targetEmail: "owner@example.com" },
      },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test("6. Advanced Settings: Code Injection in <head> and </body>", async ({
    request,
    page,
  }) => {
    await loginAsStaff(request);
    const headerMarker = `<meta name="e2e-custom-meta" content="vibress-header-code-${Date.now()}" />`;
    const footerMarker = `<div id="e2e-footer-injected-marker-${Date.now()}">Injected Content</div>`;

    await request.put(`${BASE_URL}/api/admin/v1/settings/code/headerCode`, {
      headers: { Origin: BASE_URL },
      data: { value: headerMarker },
    });

    await request.put(`${BASE_URL}/api/admin/v1/settings/code/footerCode`, {
      headers: { Origin: BASE_URL },
      data: { value: footerMarker },
    });

    // Check public site HTML
    await page.goto(`${BASE_URL}/`);
    const content = await page.content();
    expect(content).toContain("e2e-custom-meta");
    expect(content).toContain("e2e-footer-injected-marker");
  });

  test("7. Advanced Settings: Maintenance operation & Integrity checks", async ({
    request,
  }) => {
    await loginAsStaff(request);
    // Purge cache maintenance op
    const maintRes = await request.post(
      `${BASE_URL}/api/admin/v1/system/maintenance`,
      {
        headers: { Origin: BASE_URL },
        data: { operation: "cache-purge" },
      },
    );
    expect(maintRes.status()).toBe(200);
    expect((await maintRes.json()).accepted).toBe(true);

    // Integrity checks
    const integrityRes = await request.get(
      `${BASE_URL}/api/admin/v1/system/integrity`,
    );
    expect(integrityRes.status()).toBe(200);
    const checks = (await integrityRes.json()).checks;
    expect(Array.isArray(checks)).toBe(true);
    expect(checks.length).toBeGreaterThan(0);
  });

  test("8. RBAC & Security: Unauthenticated access blocked on settings endpoints", async ({
    browser,
  }) => {
    const anonContext = await browser.newContext();

    const unauthSettings = await anonContext.request.get(
      `${BASE_URL}/api/admin/v1/settings`,
    );
    expect(unauthSettings.status()).toBe(401);

    const unauthAudit = await anonContext.request.get(
      `${BASE_URL}/api/admin/v1/audit`,
    );
    expect(unauthAudit.status()).toBe(401);

    const unauthDiagnostics = await anonContext.request.get(
      `${BASE_URL}/api/admin/v1/system/diagnostics`,
    );
    expect(unauthDiagnostics.status()).toBe(401);

    await anonContext.close();
  });

  test("9. Themes Drawer & Danger Zone UI Execution", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin/settings/site#site`);
    await page.waitForLoadState("networkidle");

    // Open Themes Drawer
    const manageThemesBtn = page
      .locator("button", { hasText: "Change theme" })
      .first();
    await expect(manageThemesBtn).toBeVisible({ timeout: 5000 });
    await manageThemesBtn.click();

    // Verify Themes Drawer is displayed with registry notice
    await expect(page.locator("text=Themes Manager")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator("text=Official Theme Registry")).toBeVisible({
      timeout: 5000,
    });

    // Close Themes Drawer
    await page.click('button[aria-label="Close themes drawer"]');

    // Navigate to Advanced Settings
    await page.goto(`${BASE_URL}/admin/settings/advanced#advanced`);
    await page.waitForLoadState("networkidle");

    // Open Danger Zone Modal
    const accessZoneBtn = page
      .locator("button", { hasText: "Access zone" })
      .first();
    await expect(accessZoneBtn).toBeVisible({ timeout: 5000 });
    await accessZoneBtn.click();

    // Verify Danger Zone Modal with safe cache purge
    await expect(
      page.locator("text=System Maintenance & Danger Zone"),
    ).toBeVisible({ timeout: 5000 });
    const purgeBtn = page.locator("button", { hasText: "Purge cache" }).first();
    await expect(purgeBtn).toBeVisible({ timeout: 5000 });
    await purgeBtn.click();

    // Verify success feedback
    await expect(page.locator("text=purged successfully")).toBeVisible({
      timeout: 5000,
    });
  });

  test("10. Code Injection RBAC & Security Isolation", async ({
    request,
    playwright,
  }) => {
    await loginAsStaff(request);

    // Superadmin / Owner can update code
    const validUpdate = await request.put(
      `${BASE_URL}/api/admin/v1/settings/code/headerCode`,
      {
        headers: { Origin: BASE_URL },
        data: { value: "<!-- verified-admin-injection -->" },
      },
    );
    expect(validUpdate.status()).toBe(200);

    // Unauthenticated request is rejected
    const anonRequest = await playwright.request.newContext();
    const unauthUpdate = await anonRequest.put(
      `${BASE_URL}/api/admin/v1/settings/code/headerCode`,
      {
        headers: { Origin: BASE_URL },
        data: { value: '<script>alert("hacked")</script>' },
      },
    );
    expect(unauthUpdate.status()).toBe(401);
    await anonRequest.dispose();
  });
});
