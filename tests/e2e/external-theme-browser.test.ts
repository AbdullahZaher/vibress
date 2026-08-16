import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

test.describe("External Theme System — End-to-End Browser UI Lifecycle", () => {
  const starterZipPath = path.resolve(__dirname, "../../content/vibress-theme-starter.zip");
  let testPostSlug: string;
  let testTagSlug: string;
  let testAuthorSlug: string;

  async function loginOwner(page: any) {
    await page.goto("http://localhost:7777/admin/login");
    await page.waitForLoadState("networkidle");
    await page.fill('input[type="email"]', "owner@example.com");
    await page.fill('input[type="password"]', "OwnerPass123!");
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.includes("/admin/login"));
  }

  test.beforeAll(async ({ request }) => {
    // 1. Authenticate via admin API
    const loginRes = await request.post("http://localhost:7777/api/admin/v1/auth/login", {
      headers: { "Content-Type": "application/json", Origin: "http://localhost:7777" },
      data: { email: "owner@example.com", password: "OwnerPass123!" },
    });
    expect(loginRes.status()).toBe(200);

    // 2. Ensure site is public & default theme is active
    await request.put("http://localhost:7777/api/admin/v1/settings/security/isPrivate", {
      headers: { Origin: "http://localhost:7777" },
      data: { value: false },
    });
    await request.post("http://localhost:7777/api/admin/v1/themes/vibress-default/activate", {
      headers: { Origin: "http://localhost:7777" },
    });

    // 3. Create test post with tag and author
    const meRes = await request.get("http://localhost:7777/api/admin/v1/auth/me", {
      headers: { Origin: "http://localhost:7777" },
    });
    const meData = await meRes.json();
    const ownerId = meData.user.id;
    testAuthorSlug = meData.user.slug || "owner-example";

    testTagSlug = `starter-tag-${Date.now()}`;
    const tagRes = await request.post("http://localhost:7777/api/admin/v1/tags", {
      headers: { "Content-Type": "application/json", Origin: "http://localhost:7777" },
      data: { name: "Starter Theme Tag", slug: testTagSlug },
    });
    const tagData = await tagRes.json();

    testPostSlug = `theme-e2e-post-${Date.now()}`;
    const postRes = await request.post("http://localhost:7777/api/admin/v1/posts", {
      headers: { "Content-Type": "application/json", Origin: "http://localhost:7777" },
      data: {
        title: "Starter Theme Verified Post",
        slug: testPostSlug,
        excerpt: "Full liquid template rendering test body",
        content: {
          schema: "vibress-studio",
          version: 1,
          root: {
            type: "root",
            children: [{ type: "paragraph", children: [{ type: "text", text: "Liquid template rendered successfully!" }] }],
          },
        },
        primaryAuthorId: ownerId,
        primaryTagId: tagData.tag?.id,
      },
    });
    const postData = await postRes.json();
    await request.post(`http://localhost:7777/api/admin/v1/posts/${postData.post.id}/publish`, {
      headers: { Origin: "http://localhost:7777" },
    });
  });

  test("Full External Theme Flow: Upload real ZIP -> Validate -> Install -> Preview -> Activate -> Render Pages -> Customize Settings", async ({
    page,
    browser,
    request,
  }) => {
    expect(fs.existsSync(starterZipPath)).toBe(true);

    // 1. Admin login & navigate to Settings -> Site
    await loginOwner(page);
    await page.goto("http://localhost:7777/admin/settings/site");
    await page.waitForLoadState("networkidle");

    // 2. Open Themes Drawer
    const changeThemeBtn = page.locator('#site-themes button, button:has-text("Change theme")').first();
    await expect(changeThemeBtn).toBeVisible({ timeout: 15000 });
    await changeThemeBtn.click();

    // 3. Click "Upload ZIP" in Drawer
    const uploadZipBtn = page.locator('button:has-text("Upload ZIP")');
    await expect(uploadZipBtn).toBeVisible();
    await uploadZipBtn.click();

    // 4. Upload actual vibress-theme-starter.zip
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(starterZipPath);

    // 5. Click Install and verify validation & installation succeed
    const installButton = page.locator('button:has-text("Install")').last();
    await expect(installButton).toBeEnabled();
    await installButton.click();

    // Verify success banner appears
    await expect(page.locator('text=Theme Installed Successfully!')).toBeVisible({
      timeout: 10000,
    });

    // 6. Preview External Theme without activating
    await request.post("http://localhost:7777/api/admin/v1/auth/login", {
      headers: { "Content-Type": "application/json", Origin: "http://localhost:7777" },
      data: { email: "owner@example.com", password: "OwnerPass123!" },
    });

    const previewRes = await request.post(
      "http://localhost:7777/api/admin/v1/themes/vibress-starter-theme/preview",
      { headers: { Origin: "http://localhost:7777" } }
    );
    expect(previewRes.status()).toBe(200);
    const { token } = await previewRes.json();

    // Preview visitor session
    const previewPage = await browser.newPage();
    const previewNav = await previewPage.goto(`http://localhost:7777/preview/${token}/posts/${testPostSlug}`);
    expect(previewNav?.status()).toBe(200);
    const previewContent = await previewPage.content();
    expect(previewContent).toContain("Starter Theme Verified Post");
    expect(previewContent).toContain("Full liquid template rendering test body");

    // Public unauthenticated visitor on canonical URL remains on default theme
    const publicPage = await browser.newPage();
    const publicNav = await publicPage.goto(`http://localhost:7777/posts/${testPostSlug}`);
    expect(publicNav?.status()).toBe(200);
    await expect(publicPage.locator('[data-theme="vibress-default"]')).toBeAttached();

    // 7. Activate External Theme
    const activateRes = await request.post(
      "http://localhost:7777/api/admin/v1/themes/vibress-starter-theme/activate",
      { headers: { Origin: "http://localhost:7777" } }
    );
    expect(activateRes.status()).toBe(200);

    // 8. Verify Public Homepage
    await publicPage.goto("http://localhost:7777/");
    expect(await publicPage.title()).toBeTruthy();
    const homeHtml = await publicPage.content();
    expect(homeHtml).toContain("Starter Theme Verified Post");

    // 9. Verify Public Post Page
    await publicPage.goto(`http://localhost:7777/posts/${testPostSlug}`);
    const postHtml = await publicPage.content();
    expect(postHtml).toContain("Starter Theme Verified Post");
    expect(postHtml).toContain("Full liquid template rendering test body");

    // 10. Verify Public Tag Page
    await publicPage.goto(`http://localhost:7777/tags/${testTagSlug}`);
    const tagHtml = await publicPage.content();
    expect(tagHtml).toContain(testTagSlug);

    // 11. Verify Public Author Page
    await publicPage.goto(`http://localhost:7777/authors/${testAuthorSlug}`);
    const authorHtml = await publicPage.content();
    expect(authorHtml).toContain("Starter Theme Verified Post");

    // 12. Customize theme settings at runtime
    const patchSettingsRes = await request.patch(
      "http://localhost:7777/api/admin/v1/themes/vibress-starter-theme/settings",
      {
        headers: { Origin: "http://localhost:7777", "Content-Type": "application/json" },
        data: { heroHeadline: "Cutting Edge Architecture", typographyFamily: "serif" },
      }
    );
    expect(patchSettingsRes.status()).toBe(200);

    // Verify customized settings reflected immediately on public site
    await publicPage.goto("http://localhost:7777/");
    const customizedHtml = await publicPage.content();
    expect(customizedHtml).toContain("Cutting Edge Architecture");
    expect(customizedHtml).toContain("font-serif");

    // Clean up extra pages
    await previewPage.close();
    await publicPage.close();
  });
});
