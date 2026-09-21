import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const ARTIFACT_SCREENSHOT_DIR = "/Users/abdullahzaher/.gemini/antigravity-ide/brain/f0ab80fb-ccf2-40c4-83bd-be7be2055e99/screenshots";
const LOCAL_SCREENSHOT_DIR = path.resolve(__dirname, "screenshots/content-modeler");

async function saveScreenshot(page: any, name: string) {
  if (!fs.existsSync(ARTIFACT_SCREENSHOT_DIR)) {
    fs.mkdirSync(ARTIFACT_SCREENSHOT_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOCAL_SCREENSHOT_DIR)) {
    fs.mkdirSync(LOCAL_SCREENSHOT_DIR, { recursive: true });
  }

  const artifactPath = path.join(ARTIFACT_SCREENSHOT_DIR, `${name}.png`);
  const localPath = path.join(LOCAL_SCREENSHOT_DIR, `${name}.png`);

  await page.screenshot({ path: artifactPath, fullPage: true });
  await page.screenshot({ path: localPath, fullPage: true });
}

test.describe("Content Modeler Visual QA Suite", () => {
  test("Navigation restructure, Settings Advanced card, Desktop, Mobile, Dark Mode, and Arabic RTL", async ({ page }) => {
    test.setTimeout(120000);
    // 1. Login
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("http://localhost:7777/admin/login");
    await page.fill("#email", "owner@example.com");
    await page.fill("#password", "OwnerPass123!");
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => url.pathname.startsWith("/admin") && !url.pathname.includes("/login"));

    // Switch to Light Mode via header button
    const themeBtn = page.locator('aside button:has(svg.lucide-sun), aside button:has(svg.lucide-moon)').first();
    if (await themeBtn.isVisible()) {
      await themeBtn.click();
      await page.waitForTimeout(300);
    }

    // Verify sidebar has NO "Content Models" button
    const sidebar = page.locator("aside");
    await expect(sidebar.getByRole("button", { name: "Content Models", exact: true })).toHaveCount(0);

    // Capture Desktop Light Sidebar (No Content Models)
    await saveScreenshot(page, "nav-sidebar-desktop-light");

    // Capture Desktop Dark Sidebar (No Content Models)
    if (await themeBtn.isVisible()) {
      await themeBtn.click();
      await page.waitForTimeout(300);
    }
    await saveScreenshot(page, "nav-sidebar-desktop-dark");

    // 2. Navigate to Settings -> Advanced
    await page.goto("http://localhost:7777/admin/settings/advanced");
    await page.waitForTimeout(500);

    // Toggle to Light Mode
    const advThemeBtn = page.locator('aside button:has(svg.lucide-sun), aside button:has(svg.lucide-moon)').first();
    if (await advThemeBtn.isVisible()) {
      await advThemeBtn.click();
      await page.waitForTimeout(300);
    }

    // Verify Content Modeler card in Settings -> Advanced
    const modelerCard = page.locator("#advanced-content-modeler");
    await expect(modelerCard).toBeVisible();
    await expect(modelerCard).toContainText("Content Modeler");

    // Scroll card into view in the scrollable main container
    await modelerCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    // Capture Settings Advanced Desktop Light (scrolled viewport showing surrounding cards)
    const artifactLight = path.join(ARTIFACT_SCREENSHOT_DIR, "settings-advanced-desktop-light.png");
    const localLight = path.join(LOCAL_SCREENSHOT_DIR, "settings-advanced-desktop-light.png");
    await page.screenshot({ path: artifactLight });
    await page.screenshot({ path: localLight });

    // Capture Settings Advanced Desktop Dark
    if (await advThemeBtn.isVisible()) {
      await advThemeBtn.click();
      await page.waitForTimeout(300);
    }
    await modelerCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const artifactDark = path.join(ARTIFACT_SCREENSHOT_DIR, "settings-advanced-desktop-dark.png");
    const localDark = path.join(LOCAL_SCREENSHOT_DIR, "settings-advanced-desktop-dark.png");
    await page.screenshot({ path: artifactDark });
    await page.screenshot({ path: localDark });

    // Capture Settings Advanced Arabic RTL Desktop
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      document.documentElement.dir = "rtl";
      document.documentElement.lang = "ar";
    });
    await page.waitForTimeout(300);
    await expect(modelerCard).toContainText("نمذجة المحتوى");
    await modelerCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const artifactAr = path.join(ARTIFACT_SCREENSHOT_DIR, "settings-advanced-arabic-desktop.png");
    const localAr = path.join(LOCAL_SCREENSHOT_DIR, "settings-advanced-arabic-desktop.png");
    await page.screenshot({ path: artifactAr });
    await page.screenshot({ path: localAr });

    // Responsive checks: 320, 375, 390, 430, 768, 1024, 1280, 1440, 1920
    const testViewports = [
      { width: 320, height: 600, name: "320" },
      { width: 375, height: 667, name: "375" },
      { width: 390, height: 844, name: "390" },
      { width: 430, height: 932, name: "430" },
      { width: 768, height: 1024, name: "768" },
      { width: 1024, height: 768, name: "1024" },
      { width: 1280, height: 800, name: "1280" },
      { width: 1440, height: 900, name: "1440" },
      { width: 1920, height: 1080, name: "1920" },
    ];

    for (const vp of testViewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.evaluate(() => {
        document.documentElement.dir = "ltr";
        document.documentElement.lang = "en";
      });
      await modelerCard.scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      await expect(modelerCard).toBeVisible();
    }

    // Capture Mobile (390px) Settings Advanced
    await page.setViewportSize({ width: 390, height: 844 });
    await modelerCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const artifactMob = path.join(ARTIFACT_SCREENSHOT_DIR, "settings-advanced-mobile-390.png");
    const localMob = path.join(LOCAL_SCREENSHOT_DIR, "settings-advanced-mobile-390.png");
    await page.screenshot({ path: artifactMob });
    await page.screenshot({ path: localMob });

    // Reset to Desktop 1280
    await page.setViewportSize({ width: 1280, height: 800 });

    // 3. Click "Manage models" to enter Content Modeler
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      document.documentElement.dir = "ltr";
      document.documentElement.lang = "en";
    });
    const manageBtn = modelerCard.getByRole("button", { name: "Manage models" });
    await manageBtn.click();
    await page.waitForURL("**/admin/models");
    await page.waitForTimeout(500);

    // Desktop Light - Model List
    await saveScreenshot(page, "cm-list-desktop-light");

    // Desktop Dark - Model List
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(200);
    await saveScreenshot(page, "cm-list-desktop-dark");

    // Arabic RTL Desktop - Model List
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      document.documentElement.dir = "rtl";
      document.documentElement.lang = "ar";
    });
    await page.waitForTimeout(200);
    await saveScreenshot(page, "cm-list-arabic-desktop");

    // Mobile Light - Model List (390px)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      document.documentElement.dir = "ltr";
      document.documentElement.lang = "en";
    });
    await page.waitForTimeout(200);
    await saveScreenshot(page, "cm-list-mobile-light");

    // 4. Open Model Builder (New Model)
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.click('button:has-text("Create Model"), button:has-text("Create First Model")');
    await page.waitForURL("**/admin/models/new");
    await page.waitForTimeout(300);

    // Populate model builder with fields including relation & relation_list
    const testSlug = `qa-catalog-${Date.now()}`;
    await page.fill('input[placeholder="e.g. Portfolio Project"]', "Catalog Items");
    await page.fill('input[placeholder="e.g. portfolio-projects"]', testSlug);
    await page.fill('textarea[placeholder="Brief description of this content structure..."]', "A rich content catalog model for testing");

    // Add field 1 (Text)
    await page.click('button:has-text("Add Field")');
    await page.fill('input[value="Field 1"]', "Item Title");

    // Add field 2 (Relation List)
    await page.click('button:has-text("Add Field")');
    await page.fill('input[value="Field 2"]', "Related Products");
    const fieldTypeSelects = page.locator('select:has(option[value="relation_list"])');
    await fieldTypeSelects.nth(1).selectOption("relation_list");

    await page.waitForTimeout(300);

    // Desktop Light - Model Builder
    await saveScreenshot(page, "cm-builder-desktop-light");

    // Desktop Dark - Model Builder
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(200);
    await saveScreenshot(page, "cm-builder-desktop-dark");

    // Arabic RTL Desktop - Model Builder
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      document.documentElement.dir = "rtl";
      document.documentElement.lang = "ar";
    });
    await page.waitForTimeout(200);
    await saveScreenshot(page, "cm-builder-arabic-desktop");

    // Mobile - Model Builder
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      document.documentElement.dir = "ltr";
      document.documentElement.lang = "en";
    });
    await page.waitForTimeout(200);
    await saveScreenshot(page, "cm-builder-mobile-light");

    // 5. Save Model and navigate to Collection List
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.click('button:has-text("Save Model")');
    await page.waitForURL("**/admin/models");
    await page.waitForTimeout(500);

    // Click View Entries
    const viewEntriesBtn = page.locator(`button:has-text("View Entries")`).first();
    await viewEntriesBtn.click();
    await page.waitForURL(new RegExp(`/admin/collections/${testSlug}`));
    await page.waitForTimeout(500);

    // Desktop Light - Collection Empty State
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      document.documentElement.dir = "ltr";
      document.documentElement.lang = "en";
    });
    await saveScreenshot(page, "cm-collection-desktop-light");

    // Desktop Dark - Collection
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(200);
    await saveScreenshot(page, "cm-collection-desktop-dark");

    // 6. Create New Entry in Collection
    await page.click('button:has-text("New Entry"), button:has-text("Create Entry")');
    await page.waitForURL(new RegExp(`/admin/collections/${testSlug}/new`));
    await page.waitForTimeout(400);

    await page.fill('input[placeholder="Entry Title"]', "Featured Catalog Item");
    await page.fill('input[placeholder="entry-slug"]', "featured-catalog-item");

    // Desktop Light - Entry Editor
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      document.documentElement.dir = "ltr";
      document.documentElement.lang = "en";
    });
    await saveScreenshot(page, "cm-entry-editor-desktop-light");

    // Desktop Dark - Entry Editor
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(200);
    await saveScreenshot(page, "cm-entry-editor-desktop-dark");

    // Arabic RTL Desktop - Entry Editor
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      document.documentElement.dir = "rtl";
      document.documentElement.lang = "ar";
    });
    await page.waitForTimeout(200);
    await saveScreenshot(page, "cm-entry-editor-arabic-desktop");

    // Mobile - Entry Editor
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      document.documentElement.dir = "ltr";
      document.documentElement.lang = "en";
    });
    await page.waitForTimeout(200);
    await saveScreenshot(page, "cm-entry-editor-mobile-light");
  });
});
