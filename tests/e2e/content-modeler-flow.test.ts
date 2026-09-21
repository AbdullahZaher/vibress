import { test, expect } from "@playwright/test";

test.describe("Content Modeler & Dynamic Collections E2E Flow", () => {
  test("Relocated navigation into Settings -> Advanced and full model/entry flow", async ({
    page,
  }) => {
    // 1. Login as owner
    await page.goto("http://localhost:7777/admin/login");
    await page.fill("#email", "owner@example.com");
    await page.fill("#password", "OwnerPass123!");
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => url.pathname === "/admin" || (url.pathname.startsWith("/admin") && !url.pathname.includes("/login")));

    // 2. Verify Content Models is REMOVED from the primary sidebar
    const sidebar = page.locator("aside");
    await expect(sidebar.getByRole("button", { name: "Content Models", exact: true })).toHaveCount(0);

    // 3. Navigate to Settings -> Advanced via sidebar
    await page.click('button:has-text("Settings")');
    await page.click('button:has-text("Advanced")');
    await page.waitForURL("**/admin/settings/advanced");

    // 4. Verify Content Modeler card in Settings -> Advanced
    const modelerCard = page.locator("#advanced-content-modeler");
    await expect(modelerCard).toBeVisible();
    await expect(modelerCard).toContainText("Content Modeler");
    await expect(modelerCard).toContainText("Design custom structured content models, fields, relations, and collection APIs.");
    const manageBtn = modelerCard.getByRole("button", { name: "Manage models" });
    await expect(manageBtn).toBeVisible();

    // 5. Click "Manage models" and verify navigation to /admin/models
    await manageBtn.click();
    await page.waitForURL("**/admin/models");
    await expect(page.locator("h1")).toContainText("Content Modeler");

    // 6. Verify deep link direct access still works
    await page.goto("http://localhost:7777/admin/models");
    await expect(page.locator("h1")).toContainText("Content Modeler");

    // 7. Verify Command Palette discovery (⌘K / Ctrl+K)
    await page.keyboard.press("Meta+k");
    const cmdInput = page.locator('input[placeholder*="Search commands"]');
    if (await cmdInput.isVisible()) {
      await cmdInput.fill("Content Modeler");
      const cmdItem = page.locator('button:has-text("Content Modeler")');
      await expect(cmdItem).toBeVisible();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }

    // 8. Click Create Model
    await page.click('button:has-text("Create Model"), button:has-text("Create First Model")');
    await page.waitForURL("**/admin/models/new");
    await expect(page.locator("h1")).toContainText("Create Content Model");

    // 9. Fill Model Details
    const modelSlug = `projects-${Date.now()}`;
    await page.fill('input[placeholder="e.g. Portfolio Project"]', "Portfolio Projects");
    await page.fill('input[placeholder="e.g. portfolio-projects"]', modelSlug);
    await page.fill('textarea[placeholder="Brief description of this content structure..."]', "Custom structured projects collection");

    // 10. Add custom field
    await page.click('button:has-text("Add Field")');
    await page.fill('input[value="Field 1"]', "Client Name");

    // 11. Save Model
    await page.click('button:has-text("Save Model")');
    await page.waitForURL("**/admin/models");

    // 12. Open Collection Entries
    await page.click(`button:has-text("View Entries")`);
    await page.waitForURL(new RegExp(`/admin/collections/${modelSlug}`));

    // 13. Create Entry in Dynamic Collection
    await page.click('button:has-text("New Entry"), button:has-text("Create Entry")');
    await page.waitForURL(new RegExp(`/admin/collections/${modelSlug}/new`));

    await page.fill('input[placeholder="Entry Title"]', "Vibress Platform Redesign");
    await page.fill('input[placeholder="entry-slug"]', "vibress-platform-redesign");

    // Save Entry
    await page.click('button:has-text("Save Entry")');
    await page.waitForURL(new RegExp(`/admin/collections/${modelSlug}`));

    // 14. Verify Entry in Listing
    await expect(page.locator("body")).toContainText("Vibress Platform Redesign");
  });
});
