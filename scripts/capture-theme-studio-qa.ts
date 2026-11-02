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

        // 1. Site Settings screen across breakpoints
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          await page.screenshot({ path: path.join(output, "settings-site-" + width + "-" + locale + "-" + appearance + ".png"), fullPage: true });
        }

        // 2. Open Theme Studio Drawer
        await open.click();
        const dialog = page.locator('[role="dialog"][aria-modal="true"]').first();
        await dialog.waitFor({ state: "visible" });

        // Gallery across breakpoints
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          await page.screenshot({ path: path.join(output, "theme-studio-" + width + "-" + locale + "-" + appearance + ".png") });
        }

        // 3. 200% text zoom stress test
        await page.setViewportSize({ width: 320, height: 900 });
        await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
        await page.screenshot({ path: path.join(output, "theme-studio-320-" + locale + "-" + appearance + "-text-stress.png") });
        await page.evaluate(() => { document.documentElement.style.fontSize = ""; });

        // 4. Upload ZIP modal
        await page.setViewportSize({ width: 1440, height: 900 });
        const uploadBtn = dialog.locator('button:has-text("ZIP")').first();
        if (await uploadBtn.isVisible()) {
          await uploadBtn.click();
          const uploadDialog = page.locator('[role="dialog"]').filter({ hasText: /Upload Theme Package|رفع حزمة القالب|ZIP/i }).last();
          await uploadDialog.waitFor({ state: "visible", timeout: 3000 }).catch(() => null);
          if (await uploadDialog.isVisible()) {
            await page.screenshot({ path: path.join(output, "theme-upload-dialog-" + locale + "-" + appearance + ".png") });
            const closeUploadBtn = page.locator('[data-theme-upload-close="true"]');
            if (await closeUploadBtn.isVisible()) {
              await closeUploadBtn.click();
            } else {
              await page.keyboard.press("Escape");
            }
            await page.waitForTimeout(200);
          }
        }

        // 5. Theme Settings Editor & Schema Validation
        const customizeBtn = dialog.locator('button:has-text("Customize"), button:has-text("تخصيص")').first();
        if (await customizeBtn.isVisible()) {
          await customizeBtn.click();
          await page.locator('h3:has-text("Customize"), h3:has-text("تخصيص")').waitFor({ state: "visible", timeout: 3000 }).catch(() => null);
          await page.waitForTimeout(300);

          // Editor Desktop (1440px)
          await page.setViewportSize({ width: 1440, height: 900 });
          await page.screenshot({ path: path.join(output, "theme-editor-1440-" + locale + "-" + appearance + ".png") });

          // Editor Mobile (390px)
          await page.setViewportSize({ width: 390, height: 900 });
          await page.screenshot({ path: path.join(output, "theme-editor-390-" + locale + "-" + appearance + ".png") });

          // Trigger validation error state (type invalid hex in first text input)
          await page.setViewportSize({ width: 1440, height: 900 });
          const textInput = dialog.locator('input[type="text"]').first();
          if (await textInput.isVisible()) {
            await textInput.fill("invalid-hex-color");
            await page.waitForTimeout(300);
            await page.screenshot({ path: path.join(output, "theme-editor-validation-" + locale + "-" + appearance + ".png") });

            // Discard changes
            const discardBtn = dialog.locator('button:has-text("Discard"), button:has-text("تراجع")').first();
            if (await discardBtn.isVisible()) {
              await discardBtn.click();
              await page.waitForTimeout(200);
            }
          }

          // Return to gallery
          const backBtn = dialog.locator('button:has-text("Back to themes"), button:has-text("العودة إلى القوالب")').first();
          if (await backBtn.isVisible()) {
            await backBtn.click();
            await page.waitForTimeout(200);
          }
        }

        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
capture().catch((error) => { console.error(error); process.exitCode = 1; });
