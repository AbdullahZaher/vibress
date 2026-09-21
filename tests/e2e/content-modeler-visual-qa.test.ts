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
  test("Desktop, Mobile, Dark Mode, and Arabic RTL visual capture", async ({ page }) => {
    test.setTimeout(90000);
    // 1. Login
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("http://localhost:7777/admin/login");
    await page.fill("#email", "owner@example.com");
    await page.fill("#password", "OwnerPass123!");
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => url.pathname.startsWith("/admin") && !url.pathname.includes("/login"));

    // Ensure Light Mode initially
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      document.documentElement.dir = "ltr";
      document.documentElement.lang = "en";
    });

    // 2. Navigate to Content Models
    await page.getByRole("button", { name: "Content Models", exact: true }).click();
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

    // 3. Open Model Builder (New Model)
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

    // Desktop Dark - Model Builder (Critical for button text contrast check!)
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(200);
    await saveScreenshot(page, "cm-builder-desktop-dark");

    // Arabic RTL Desktop - Model Builder
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      document.documentElement.dir = "rtl";
      document.documentElement.lang = "ar";
    });
    await page.waitForTimeout(300);
    await saveScreenshot(page, "cm-builder-arabic-desktop");

    // Arabic RTL Mobile (390px)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await saveScreenshot(page, "cm-builder-arabic-mobile");

    // Mobile Light (390px, LTR)
    await page.evaluate(() => {
      document.documentElement.dir = "ltr";
      document.documentElement.lang = "en";
    });
    await page.waitForTimeout(300);
    await saveScreenshot(page, "cm-builder-mobile-light");

    // Mobile Dark (390px, LTR)
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(200);
    await saveScreenshot(page, "cm-builder-mobile-dark");

    // Reset to Desktop Light & Save Model
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      document.documentElement.dir = "ltr";
      document.documentElement.lang = "en";
    });
    await page.click('button:has-text("Save Model")');
    await page.waitForURL("**/admin/models");
    await page.waitForTimeout(500);

    // 4. Open Dynamic Collection List
    await page.click(`button:has-text("View Entries")`);
    await page.waitForURL(new RegExp(`/admin/collections/${testSlug}`));
    await page.waitForTimeout(300);

    // Desktop Light - Collection List (Empty State)
    await saveScreenshot(page, "cm-collection-list-desktop-light");

    // Desktop Dark - Collection List
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(200);
    await saveScreenshot(page, "cm-collection-list-desktop-dark");

    // 5. Open Dynamic Collection Entry Editor (New Entry)
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
    await page.click('button:has-text("New Entry"), button:has-text("Create Entry")');
    await page.waitForURL(new RegExp(`/admin/collections/${testSlug}/new`));
    await page.waitForTimeout(300);

    await page.fill('input[placeholder="Entry Title"]', "Summer Catalog Showcase");
    await page.fill('input[placeholder="entry-slug"]', "summer-catalog-showcase");

    // Desktop Light - Entry Editor
    await saveScreenshot(page, "cm-entry-editor-desktop-light");

    // Desktop Dark - Entry Editor
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(200);
    await saveScreenshot(page, "cm-entry-editor-desktop-dark");

    // Mobile Light - Entry Editor
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
    await page.waitForTimeout(300);
    await saveScreenshot(page, "cm-entry-editor-mobile-light");

    // Mobile Dark - Entry Editor
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(200);
    await saveScreenshot(page, "cm-entry-editor-mobile-dark");

    // Arabic RTL Mobile (390px) - Entry Editor
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      document.documentElement.dir = "rtl";
      document.documentElement.lang = "ar";
    });
    await page.waitForTimeout(300);
    await saveScreenshot(page, "cm-entry-editor-arabic-mobile");

    // Arabic RTL Desktop - Entry Editor
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(300);
    await saveScreenshot(page, "cm-entry-editor-arabic-desktop");

    // Save Entry to complete lifecycle
    await page.evaluate(() => {
      document.documentElement.dir = "ltr";
      document.documentElement.lang = "en";
    });
    await page.click('button:has-text("Save Entry")');
    await page.waitForURL(new RegExp(`/admin/collections/${testSlug}`));
    await page.waitForTimeout(500);

    // Desktop Light - Collection List with Saved Entry
    await saveScreenshot(page, "cm-collection-list-with-entry");

    // Mobile Light - Collection List with Saved Entry (tests stacked card view!)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    await saveScreenshot(page, "cm-collection-list-mobile-cards");
  });
});
