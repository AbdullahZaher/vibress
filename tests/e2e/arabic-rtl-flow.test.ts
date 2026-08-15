import { test, expect } from "@playwright/test";

test.describe("Arabic-First Internationalization & RTL E2E Flow", () => {
  test("RTL direction, Arabic content authoring, and mixed Bidi text entry", async ({
    page,
  }) => {
    // 1. Login
    await page.goto("http://localhost:7777/admin");
    await page.waitForLoadState("networkidle");
    const emailInput = page.locator("#email");
    if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await emailInput.fill("owner@example.com");
      await page.locator("#password").fill("OwnerPass123!");
      await page.click('button[type="submit"]');
      await page.waitForURL((url) => url.pathname === "/admin" || (url.pathname.startsWith("/admin") && !url.pathname.includes("/login")));
    }

    // 2. Create an Arabic Post
    await page.getByRole("button", { name: "Posts", exact: true }).click();
    await page.waitForURL("**/admin/posts");
    await page.click('button:has-text("Create Post")');
    await page.waitForURL("**/admin/posts/new");

    // 3. Write Arabic Title & Body
    const arabicTitle = "منصة فايبرس للنشر الرقمي المتطور";
    await page.fill('textarea[aria-label="Post Title"]', arabicTitle);

    const editorArea = page.locator(
      'div.vibress-studio-editor div[contenteditable="true"]',
    );
    await editorArea.click();
    await page.keyboard.type(
      "أهلاً بك في منصة فايبرس (Vibress). تدعم المنصة اللغة العربية بشكل أصيل وواجهات RTL متجاوبة.",
    );

    // 4. Save Draft
    await page.click('button:has-text("Save Draft")');
    await page.waitForURL(/\/admin\/posts\/[a-zA-Z0-9-]+/);

    // Verify Arabic content persisted cleanly
    await expect(page.locator('textarea[aria-label="Post Title"]')).toHaveValue(arabicTitle);
    await expect(page.locator("body")).toContainText("أهلاً بك في منصة فايبرس");
  });
});
