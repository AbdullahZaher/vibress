/**
 * Authenticated, deterministic, and verifiable visual review matrix for Theme Studio.
 * Captures EN/AR, light/dark, breakpoints 320/390/768/1024/1440, 200% text scaling,
 * Editor, Schema Validation error states, and Upload Dialog.
 *
 * Guarantees exactly 60 non-empty verified screenshots with explicit assertions
 * (zero silent conditional skips) and generates a machine-readable manifest.json.
 */
import { chromium } from "playwright";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";

const base = process.env.THEME_STUDIO_BASE_URL || "http://localhost:7777";
const email = process.env.THEME_STUDIO_ADMIN_EMAIL;
const password = process.env.THEME_STUDIO_ADMIN_PASSWORD;
const output = process.env.THEME_STUDIO_OUTPUT || "artifacts/theme-studio";
const widths = [320, 390, 768, 1024, 1440];

interface CapturedEntry {
  filename: string;
  viewport: { width: number; height: number };
  locale: "en" | "ar";
  appearance: "dark" | "light";
  scenario: string;
  sizeBytes?: number;
}

async function capture() {
  if (!email || !password) {
    throw new Error("Missing authorized staging admin credentials (THEME_STUDIO_ADMIN_EMAIL / THEME_STUDIO_ADMIN_PASSWORD).");
  }
  await mkdir(output, { recursive: true });

  const capturedEntries: CapturedEntry[] = [];
  const browser = await chromium.launch({ headless: true });

  try {
    for (const locale of ["en", "ar"] as const) {
      for (const appearance of ["dark", "light"] as const) {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          reducedMotion: "reduce",
        });

        await context.addInitScript({
          content:
            'try { localStorage.setItem("vibress-admin-ui-locale", ' +
            JSON.stringify(locale) +
            '); localStorage.setItem("vibress-admin-theme", ' +
            JSON.stringify(appearance) +
            "); } catch {}",
        });

        const page = await context.newPage();
        await page.goto(new URL("/admin/login", base).toString());
        await page.locator("#email").fill(email);
        await page.locator("#password").fill(password);
        await page.locator('button[type="submit"]').click();
        await page.waitForURL((url) => !url.pathname.includes("/admin/login"));
        await page.goto(new URL("/admin/settings/site", base).toString());

        const open = page.getByRole("button", { name: /Change theme|تغيير القالب/ });
        await open.waitFor({ state: "visible", timeout: 15000 });

        // 1. Site Settings screen across 5 breakpoints (20 total across matrix)
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          const filename = `settings-site-${width}-${locale}-${appearance}.png`;
          await page.screenshot({
            path: path.join(output, filename),
            fullPage: true,
          });
          capturedEntries.push({
            filename,
            viewport: { width, height: 900 },
            locale,
            appearance,
            scenario: `Site Settings Page at ${width}px`,
          });
        }

        // 2. Open Theme Studio Drawer
        await open.click();
        const dialog = page.locator('[role="dialog"][aria-modal="true"]').first();
        await dialog.waitFor({ state: "visible", timeout: 15000 });

        // Theme Studio Gallery across 5 breakpoints (20 total across matrix)
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          const filename = `theme-studio-${width}-${locale}-${appearance}.png`;
          await page.screenshot({ path: path.join(output, filename) });
          capturedEntries.push({
            filename,
            viewport: { width, height: 900 },
            locale,
            appearance,
            scenario: `Theme Studio Gallery at ${width}px`,
          });
        }

        // 3. 200% root text zoom stress test at 320px (4 total across matrix)
        await page.setViewportSize({ width: 320, height: 900 });
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "200%";
        });
        const textStressFilename = `theme-studio-320-${locale}-${appearance}-text-stress.png`;
        await page.screenshot({ path: path.join(output, textStressFilename) });
        capturedEntries.push({
          filename: textStressFilename,
          viewport: { width: 320, height: 900 },
          locale,
          appearance,
          scenario: "Theme Studio 320px with 200% root text scaling",
        });
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "";
        });

        // 4. Upload ZIP modal dialog (4 total across matrix)
        await page.setViewportSize({ width: 1440, height: 900 });
        const uploadBtn = dialog.locator('button:has-text("ZIP")').first();
        await uploadBtn.waitFor({ state: "visible", timeout: 10000 });
        await uploadBtn.click();

        const uploadDialog = page
          .locator('[role="dialog"]')
          .filter({ has: page.locator('[data-theme-upload-close="true"]') });
        await uploadDialog.waitFor({ state: "visible", timeout: 10000 });

        const uploadFilename = `theme-upload-dialog-${locale}-${appearance}.png`;
        await page.screenshot({ path: path.join(output, uploadFilename) });
        capturedEntries.push({
          filename: uploadFilename,
          viewport: { width: 1440, height: 900 },
          locale,
          appearance,
          scenario: "Theme ZIP Upload Modal Dialog",
        });

        const closeUploadBtn = page.locator('[data-theme-upload-close="true"]');
        await closeUploadBtn.waitFor({ state: "visible", timeout: 10000 });
        await closeUploadBtn.click();
        await uploadDialog.waitFor({ state: "detached", timeout: 10000 });

        // 5. Theme Settings Editor across viewports (8 total across matrix)
        const customizeBtn = dialog
          .locator('button:has-text("Customize"), button:has-text("تخصيص")')
          .first();
        await customizeBtn.waitFor({ state: "visible", timeout: 10000 });
        await customizeBtn.click();

        const backBtn = dialog
          .locator('button[aria-label*="Back to themes"], button[aria-label*="العودة إلى القوالب"]')
          .first();
        await backBtn.waitFor({ state: "visible", timeout: 10000 });

        // Editor Desktop (1440px)
        await page.setViewportSize({ width: 1440, height: 900 });
        const editor1440Filename = `theme-editor-1440-${locale}-${appearance}.png`;
        await page.screenshot({ path: path.join(output, editor1440Filename) });
        capturedEntries.push({
          filename: editor1440Filename,
          viewport: { width: 1440, height: 900 },
          locale,
          appearance,
          scenario: "Theme Settings Customization Editor Desktop 1440px",
        });

        // Editor Mobile (390px)
        await page.setViewportSize({ width: 390, height: 900 });
        const editor390Filename = `theme-editor-390-${locale}-${appearance}.png`;
        await page.screenshot({ path: path.join(output, editor390Filename) });
        capturedEntries.push({
          filename: editor390Filename,
          viewport: { width: 390, height: 900 },
          locale,
          appearance,
          scenario: "Theme Settings Customization Editor Mobile 390px",
        });

        // 6. Schema Validation Error State with Accessible Alerts (4 total across matrix)
        await page.setViewportSize({ width: 1440, height: 900 });
        const textInput = dialog.locator('input[id$="-text"]').first();
        await textInput.waitFor({ state: "visible", timeout: 10000 });
        await textInput.fill("invalid-hex-color");

        const errorAlert = dialog
          .locator('[role="alert"]')
          .filter({ hasText: /HEX|صالح/i })
          .first();
        await errorAlert.waitFor({ state: "visible", timeout: 10000 });

        const saveBtn = dialog
          .locator('button:has-text("Save"), button:has-text("حفظ")')
          .first();
        await saveBtn.waitFor({ state: "visible", timeout: 10000 });
        if (!(await saveBtn.isDisabled())) {
          throw new Error("Validation invariant failed: Save button must be disabled when errors exist");
        }

        const validationFilename = `theme-editor-validation-${locale}-${appearance}.png`;
        await page.screenshot({ path: path.join(output, validationFilename) });
        capturedEntries.push({
          filename: validationFilename,
          viewport: { width: 1440, height: 900 },
          locale,
          appearance,
          scenario: "Theme Settings Editor Accessible Validation Error State",
        });

        // Discard changes & restore state
        const discardBtn = dialog
          .locator('button:has-text("Discard"), button:has-text("تجاهل"), button:has-text("تراجع")')
          .first();
        await discardBtn.waitFor({ state: "visible", timeout: 10000 });
        await discardBtn.click();
        await errorAlert.waitFor({ state: "hidden", timeout: 10000 });

        // Return to gallery
        await backBtn.waitFor({ state: "visible", timeout: 10000 });
        await backBtn.click();
        await backBtn.waitFor({ state: "detached", timeout: 10000 });

        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  // Exact inventory assertion: strictly 60 screenshots
  if (capturedEntries.length !== 60) {
    throw new Error(
      `Visual QA inventory assertion failed: expected exactly 60 screenshots, captured ${capturedEntries.length}`,
    );
  }

  // Verify all files exist and are non-empty
  for (const entry of capturedEntries) {
    const fullPath = path.join(output, entry.filename);
    const fileStat = await stat(fullPath);
    if (!fileStat.isFile() || fileStat.size === 0) {
      throw new Error(`Invalid or empty screenshot file: ${entry.filename} (${fileStat.size} bytes)`);
    }
    entry.sizeBytes = fileStat.size;
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    commitSha:
      process.env.GITHUB_SHA ||
      execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(),
    environment: {
      baseUrl: base,
      nodeEnv: process.env.NODE_ENV || "development",
    },
    totalScreenshots: capturedEntries.length,
    expectedCount: 60,
    status: "verified_production_ready",
    screenshots: capturedEntries,
  };

  const manifestPath = path.join(output, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`Visual QA matrix complete: 60/60 valid screenshots verified. Manifest written to ${manifestPath}`);
}

capture().catch((error) => {
  console.error("Visual QA capture failed:", error);
  process.exitCode = 1;
});
