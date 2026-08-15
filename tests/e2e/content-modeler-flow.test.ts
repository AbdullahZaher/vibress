import { test, expect } from "@playwright/test";

test.describe("Content Modeler & Dynamic Collections E2E Flow", () => {
  test("Full model creation, schema building, and dynamic collection entry management flow", async ({
    page,
  }) => {
    // 1. Login as owner
    await page.goto("http://localhost:7777/admin/login");
    await page.fill("#email", "owner@example.com");
    await page.fill("#password", "OwnerPass123!");
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => url.pathname === "/admin" || (url.pathname.startsWith("/admin") && !url.pathname.includes("/login")));

    // 2. Navigate to Content Models
    await page.getByRole("button", { name: "Content Models", exact: true }).click();
    await page.waitForURL("**/admin/models");
    await expect(page.locator("h1")).toContainText("Content Modeler");

    // 3. Click Create Model
    await page.click('button:has-text("Create Model"), button:has-text("Create First Model")');
    await page.waitForURL("**/admin/models/new");
    await expect(page.locator("h1")).toContainText("Create Content Model");

    // 4. Fill Model Details
    const modelSlug = `projects-${Date.now()}`;
    await page.fill('input[placeholder="e.g. Portfolio Project"]', "Portfolio Projects");
    await page.fill('input[placeholder="e.g. portfolio-projects"]', modelSlug);
    await page.fill('textarea[placeholder="Brief description of this content structure..."]', "Custom structured projects collection");

    // 5. Add custom field
    await page.click('button:has-text("Add Field")');
    await page.fill('input[value="Field 1"]', "Client Name");

    // 6. Save Model
    await page.click('button:has-text("Save Model")');
    await page.waitForURL("**/admin/models");

    // 7. Open Collection Entries
    await page.click(`button:has-text("View Entries")`);
    await page.waitForURL(new RegExp(`/admin/collections/${modelSlug}`));

    // 8. Create Entry in Dynamic Collection
    await page.click('button:has-text("New Entry"), button:has-text("Create Entry")');
    await page.waitForURL(new RegExp(`/admin/collections/${modelSlug}/new`));

    await page.fill('input[placeholder="Entry Title"]', "Vibress Platform Redesign");
    await page.fill('input[placeholder="entry-slug"]', "vibress-platform-redesign");

    // Save Entry
    await page.click('button:has-text("Save Entry")');
    await page.waitForURL(new RegExp(`/admin/collections/${modelSlug}`));

    // 9. Verify Entry in Listing
    await expect(page.locator("body")).toContainText("Vibress Platform Redesign");
  });
});
