/**
 * Theme Studio authenticated screenshot matrix for manual visual review.
 *
 * Use only against an owned staging/local publication. Requires:
 * THEME_STUDIO_BASE_URL (default http://localhost:7777)
 * THEME_STUDIO_ADMIN_EMAIL, THEME_STUDIO_ADMIN_PASSWORD
 * Optional THEME_STUDIO_OUTPUT (default artifacts/theme-studio)
 *
 * Examples:
 * THEME_STUDIO_ADMIN_EMAIL=... THEME_STUDIO_ADMIN_PASSWORD=... pnpm exec tsx scripts/capture-theme-studio-qa.ts
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const base = process.env.THEME_STUDIO_BASE_URL || "http://localhost:7777";
const email = process.env.THEME_STUDIO_ADMIN_EMAIL;
const password = process.env.THEME_STUDIO_ADMIN_PASSWORD;
const output = process.env.THEME_STUDIO_OUTPUT || "artifacts/theme-studio";
const sizes = [320, 390, 768, 1024, 1440];

async function capture() {
  if (!email || !password) throw new Error("Set THEME_STUDIO_ADMIN_EMAIL and THEME_STUDIO_ADMIN_PASSWORD.");
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of sizes) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      await page.goto(new URL("/admin/login", base).toString());
      await page.locator('input[type="email"]').fill(email);
      await page.locator('input[type="password"]').fill(password);
      await page.locator('button[type="submit"]').click();
      await page.waitForURL((url) => !url.pathname.includes("/admin/login"));
      await page.goto(new URL("/admin/settings/site", base).toString());
      const open = page.getByRole("button", { name: "Change theme" });
      await open.waitFor({ state: "visible" });
      await page.screenshot({ path: path.join(output, `settings-site-${width}.png`), fullPage: true });
      await open.click();
      await page.getByRole("dialog", { name: "Themes Manager" }).waitFor({ state: "visible" });
      await page.getByRole("heading", { name: "Your themes" }).waitFor({ state: "visible" });
      await page.screenshot({ path: path.join(output, `theme-studio-${width}.png`) });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

capture().catch((error) => { console.error(error); process.exitCode = 1; });
