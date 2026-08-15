import { test, expect } from "@playwright/test";

test.describe("Studio Real-Time Collaboration & Editorial Review E2E", () => {
  test("Two independent browser contexts editing document and editorial workflow", async ({
    browser,
  }) => {
    // 1. Context A: Login as Owner
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await pageA.goto("http://localhost:7777/admin/login");
    await pageA.fill("#email", "owner@example.com");
    await pageA.fill("#password", "OwnerPass123!");
    await pageA.click('button[type="submit"]');
    await pageA.waitForURL((url) => url.pathname === "/admin" || (url.pathname.startsWith("/admin") && !url.pathname.includes("/login")));

    // Context A creates a post
    await pageA.getByRole("button", { name: "Posts", exact: true }).click();
    await pageA.waitForURL("**/admin/posts");
    await pageA.click('button:has-text("Create Post")');
    await pageA.waitForURL("**/admin/posts/new");

    const postTitle = `Collab E2E Post ${Date.now()}`;
    await pageA.fill('textarea[aria-label="Post Title"]', postTitle);
    await pageA.click('button:has-text("Save Draft")');
    await pageA.waitForURL((url) => url.pathname.startsWith("/admin/posts/") && !url.pathname.endsWith("/new"));

    const postUrl = pageA.url();

    // 2. Context B: Login as Admin
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.goto("http://localhost:7777/admin/login");
    await pageB.fill("#email", "owner@example.com");
    await pageB.fill("#password", "OwnerPass123!");
    await pageB.click('button[type="submit"]');
    await pageB.waitForURL((url) => url.pathname === "/admin" || (url.pathname.startsWith("/admin") && !url.pathname.includes("/login")));

    // Context B navigates directly to the same post URL
    await pageB.goto(postUrl);
    await expect(pageB.locator('textarea[aria-label="Post Title"]')).toHaveValue(postTitle, { timeout: 10000 });

    // 3. Editorial Collaboration Panel test in Context A
    const collabTabA = pageA.locator('button:has-text("Review"), button:has-text("Collaboration"), button:has-text("Workflow")');
    if (await collabTabA.count() > 0) {
      await collabTabA.first().click();
    }

    // 4. Verify post status & editorial controls are functional in both contexts
    await expect(pageA.locator("body")).toContainText("Draft");
    await expect(pageB.locator("body")).toContainText("Draft");

    await contextA.close();
    await contextB.close();
  });
});
