/**
 * Authenticated, privacy-conscious visual review matrix for Theme Studio.
 * Captures EN/AR, light/dark and widths 320/390/768/1024/1440. An additional
 * 200%-root-text stress capture is provided at 320px. Manual browser text-zoom
 * and VoiceOver/NVDA verification are still required before release approval.
 *
 * Use an owned, seeded staging/local publication, never commit personal data
 * captured in previews. Credentials are passed through environment variables.
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const base = process.env.THEME_STUDIO_BASE_URL || "http://localhost:7777";
const email = process.env.THEME_STUDIO_ADMIN_EMAIL;
const password = process.env.THEME_STUDIO_ADMIN_PASSWORD;
const output = process.env.THEME_STUDIO_OUTPUT || "artifacts/theme-studio";
const widths = [320, 390, 768, 1024, 1440];

async function capture() {
  if (!email || !password) throw new Error("Missing authorized staging admin credentials.");
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const locale of ["en", "ar"] as const) {
      for (const appearance of ["dark", "light"] as const) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
        await context.addInitScript({
          content:
            'try { localStorage.setItem("vibress-admin-ui-locale", ' + JSON.stringify(locale) +
            '); localStorage.setItem("vibress-admin-theme", ' + JSON.stringify(appearance) + '); } catch {}',
        });
        const page = await context.newPage();
        await page.goto(new URL("/admin/login", base).toString());
        await page.locator("#email").fill(email);
        await page.locator("#password").fill(password);
        await page.locator('button[type="submit"]').click();
        await page.waitForURL((url) => !url.pathname.includes("/admin/login"));
        await page.goto(new URL("/admin/settings/site", base).toString());
        const open = page.getByRole("button", { name: /Change theme|تغيير القالب/ });
        await open.waitFor({ state: "visible" });
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          await page.screenshot({ path: path.join(output, "settings-site-" + width + "-" + locale + "-" + appearance + ".png"), fullPage: true });
        }
        await open.click();
        await page.locator('[role="dialog"][aria-modal="true"]').waitFor({ state: "visible" });
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          await page.screenshot({ path: path.join(output, "theme-studio-" + width + "-" + locale + "-" + appearance + ".png") });
        }
        await page.setViewportSize({ width: 320, height: 900 });
        await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
        await page.screenshot({ path: path.join(output, "theme-studio-320-" + locale + "-" + appearance + "-text-stress.png") });
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
capture().catch((error) => { console.error(error); process.exitCode = 1; });
