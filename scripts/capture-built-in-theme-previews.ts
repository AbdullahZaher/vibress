/**
 * Capture genuine screenshots of built-in themes with real staging-publication
 * content. Never commit captures before reviewing content/privacy and quality.
 *
 * THEME_STUDIO_ADMIN_EMAIL=... THEME_STUDIO_ADMIN_PASSWORD=... \
 *   pnpm exec tsx scripts/capture-built-in-theme-previews.ts
 *
 * Optional: THEME_STUDIO_BASE_URL, THEME_STUDIO_PREVIEW_OUTPUT.
 * Default output: artifacts/theme-studio/previews/*.jpg (private/untracked).
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const origin = process.env.THEME_STUDIO_BASE_URL || "http://localhost:7777";
const email = process.env.THEME_STUDIO_ADMIN_EMAIL;
const password = process.env.THEME_STUDIO_ADMIN_PASSWORD;
const output = resolve(process.env.THEME_STUDIO_PREVIEW_OUTPUT || "artifacts/theme-studio/previews");
const themeIds = ["vibress-default", "vibress-minimal", "vibress-molten"];

async function main() {
  if (!email || !password) throw new Error("Set authorized staging credentials; do not use production users.");
  if (!/^https?:\/\//.test(origin)) throw new Error("Expected an HTTP(S) staging origin.");
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
      locale: "en-US",
    });
    const admin = await context.newPage();
    await admin.goto(new URL("/admin/login", origin).toString());
    await admin.locator('input[type="email"]').fill(email);
    await admin.locator('input[type="password"]').fill(password);
    await admin.locator('button[type="submit"]').click();
    await admin.waitForURL((url) => !url.pathname.includes("/admin/login"));
    await admin.goto(new URL("/admin/settings/site", origin).toString());
    await admin.getByRole("button", { name: /Change theme|تغيير القالب/ }).click();
    await admin.locator('[role="dialog"][aria-label]').waitFor();
    for (const id of themeIds) {
      const card = admin.locator('article[data-theme-id="' + id + '"]');
      await card.waitFor({ state: "visible", timeout: 10000 });
      if (await card.count() !== 1) throw new Error("Built-in theme missing from catalog: " + id);
      await card.locator("button").first().click();
      const frame = admin.locator('iframe[src^="/preview/"]');
      await frame.waitFor({ state: "attached" });
      const previewPath = await frame.getAttribute("src");
      if (!previewPath?.startsWith("/preview/")) throw new Error("Scoped preview failed for " + id);
      const page = await context.newPage();
      try {
        await page.setViewportSize({ width: 1200, height: 750 });
        const response = await page.goto(new URL(previewPath, origin).toString(), { waitUntil: "domcontentloaded" });
        if (!response?.ok()) throw new Error(id + " preview returned " + response?.status());
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.evaluate(async () => { await document.fonts.ready; });
        await page.screenshot({
          path: resolve(output, id + ".jpg"),
          type: "jpeg",
          quality: 88,
          fullPage: false,
          animations: "disabled",
        });
      } finally {
        await page.close();
      }
      await admin.getByRole("button", { name: /Back to themes|العودة إلى القوالب/ }).first().click();
    }
    await context.close();
  } finally {
    await browser.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
