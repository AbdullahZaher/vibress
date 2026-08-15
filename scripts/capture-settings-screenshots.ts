import { chromium } from "playwright";
import path from "path";

const BASE_URL = "http://localhost:7777";
const ARTIFACT_DIR =
  "/Users/abdullahzaher/.gemini/antigravity-ide/brain/7e3a5649-ee18-4dd9-b68a-113e795512b1";

async function capture() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  console.log("1. Logging in to Admin...");
  await page.goto(`${BASE_URL}/admin`);
  await page.waitForTimeout(500);

  const emailInput = page.locator("#email");
  if (await emailInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.fill("#email", "owner@example.com");
    await page.fill("#password", "OwnerPass123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/admin", { timeout: 10000 });
  }

  console.log("2. Capturing General Settings...");
  await page.goto(`${BASE_URL}/admin/settings/general#general`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, "settings_general_tab.png"),
    fullPage: true,
  });

  console.log("3. Capturing Site Settings...");
  await page.click('button:has-text("Site")');
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, "settings_site_tab.png"),
    fullPage: true,
  });

  console.log("4. Capturing Membership Settings...");
  await page.click('button:has-text("Membership")');
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, "settings_membership_tab.png"),
    fullPage: true,
  });

  console.log("5. Capturing Growth Settings...");
  await page.click('button:has-text("Growth")');
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, "settings_growth_tab.png"),
    fullPage: true,
  });

  console.log("6. Capturing Advanced Settings...");
  await page.click('button:has-text("Advanced")');
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, "settings_advanced_tab.png"),
    fullPage: true,
  });

  console.log("7. Capturing Public Web Home...");
  const publicPage = await context.newPage();
  await publicPage.goto(`${BASE_URL}/`);
  await publicPage.waitForLoadState("networkidle");
  await publicPage.screenshot({
    path: path.join(ARTIFACT_DIR, "public_web_home.png"),
    fullPage: true,
  });

  await browser.close();
  console.log("All screenshots captured successfully!");
}

capture().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
