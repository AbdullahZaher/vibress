import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const API = "http://localhost:7777";
const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots/portal");

test.describe("Portal Visual Redesign & Responsiveness QA Suite", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }
  });

  async function getLatestMail(to: string): Promise<any> {
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch("http://127.0.0.1:8025/api/v1/messages");
        const data = await res.json();
        const matches = (data.messages || [])
          .filter((m: any) => {
            return (
              m.To?.some(
                (t: any) => t.Address?.toLowerCase() === to.toLowerCase(),
              ) || m.To?.[0]?.Address?.toLowerCase() === to.toLowerCase()
            );
          })
          .sort(
            (a: any, b: any) =>
              new Date(b.Created).getTime() - new Date(a.Created).getTime(),
          );
        if (matches.length > 0) {
          const detail = await (
            await fetch(`http://127.0.0.1:8025/api/v1/message/${matches[0].ID}`)
          ).json();
          return detail;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`expected an email to ${to}`);
  }

  async function extractTokenFromMail(to: string): Promise<string> {
    const detail = await getLatestMail(to);
    const html = detail.HTML || "";
    const text = detail.Text || "";
    const raw =
      html.match(/href="([^"]*token=[^"]*)"/i)?.[1] ||
      text.match(/(https?:\/\/[^\s]+token=[^\s]+)/i)?.[1];
    if (raw && raw.includes("token=")) {
      return raw.replace(/&amp;/g, "&").replace(/[">]+$/, "");
    }
    throw new Error(`could not extract token from email to ${to}`);
  }

  async function selectLanguage(page: any, lang: "en" | "ar") {
    const selector = page.locator("#portal-language-selector");
    if (await selector.isVisible()) {
      await selector.click();
      await page.waitForTimeout(60);
    }
    await page.click(lang === "en" ? "#portal-lang-en" : "#portal-lang-ar");
    await page.waitForTimeout(100);
  }

  // 1. Sign In Page: Viewport & Locale Matrix
  test("1. Sign In Page Visual & Responsive Matrix (EN/AR, Light/Dark, 320/390/768/1280/1920)", async ({
    page,
  }) => {
    const viewports = [
      { name: "mobile-320", width: 320, height: 844 },
      { name: "mobile-390", width: 390, height: 844 },
      { name: "tablet-768", width: 768, height: 1024 },
      { name: "desktop-1280", width: 1280, height: 800 },
      { name: "wide-1920", width: 1920, height: 1080 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      // English Light
      await page.goto(`${API}/portal/#/sign-in`);
      await selectLanguage(page, "en");
      await expect(page.locator("h1")).toContainText("Vibress");
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `signin-en-light-${vp.name}.png`),
        fullPage: true,
      });

      // Assert no horizontal scroll overflow
      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(hasOverflow).toBe(false);

      // Arabic RTL
      await selectLanguage(page, "ar");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `signin-ar-light-${vp.name}.png`),
        fullPage: true,
      });

      // Arabic Dark Mode
      await page.evaluate(() => document.documentElement.classList.add("dark"));
      await page.waitForTimeout(100);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `signin-ar-dark-${vp.name}.png`),
        fullPage: true,
      });

      // English Dark Mode
      await selectLanguage(page, "en");
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `signin-en-dark-${vp.name}.png`),
        fullPage: true,
      });

      // Reset dark mode
      await page.evaluate(() => document.documentElement.classList.remove("dark"));
    }
  });

  // 2. Check Email Page Visual Matrix
  test("2. Check Email Page Visual Matrix", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const email = `qa-check-${Date.now()}@example.com`;

    await page.goto(`${API}/portal/#/sign-in`);
    await page.fill("#email", email);
    await page.click('button[type="submit"]');
    await expect(page.locator("h1")).toContainText("Check your email");

    // EN Light
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "check-email-en-light-mobile.png"),
      fullPage: true,
    });

    // AR Light
    await selectLanguage(page, "ar");
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "check-email-ar-light-mobile.png"),
      fullPage: true,
    });

    // AR Dark
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "check-email-ar-dark-mobile.png"),
      fullPage: true,
    });

    // Desktop View
    await page.setViewportSize({ width: 1280, height: 800 });
    await selectLanguage(page, "en");
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "check-email-en-light-desktop.png"),
      fullPage: true,
    });
  });

  // 3. Verify Error & Invalid Link Page Visual Matrix
  test("3. Verify Error & Invalid Link Visual Matrix", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${API}/portal/#/auth/verify?token=invalid_expired_token_12345`);
    await expect(page.locator("h1")).toContainText("Sign-in link is invalid or has expired.");

    // EN Light
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "verify-error-en-light-mobile.png"),
      fullPage: true,
    });

    // AR Light
    await selectLanguage(page, "ar");
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "verify-error-ar-light-mobile.png"),
      fullPage: true,
    });

    // AR Dark
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "verify-error-ar-dark-mobile.png"),
      fullPage: true,
    });

    await page.evaluate(() => document.documentElement.classList.remove("dark"));
  });

  // 4. Authenticated Account Page & Modals Visual Matrix
  test("4. Authenticated Account Page & Modals Visual Matrix", async ({ page }) => {
    const email = `qa-account-${Date.now()}@example.com`;

    // Sign in
    await page.goto(`${API}/portal/#/sign-in`);
    await page.fill("#email", email);
    await page.click('button[type="submit"]');

    const magicLinkUrl = await extractTokenFromMail(email);
    const token = magicLinkUrl.includes("token=")
      ? magicLinkUrl.split("token=")[1]!.split("&")[0]!
      : "";

    await page.goto(`${API}/portal/#/auth/verify?token=${token}`);
    await expect(page.locator("h1")).toContainText("Your account", { timeout: 15000 });

    const viewports = [
      { name: "mobile-390", width: 390, height: 844 },
      { name: "tablet-768", width: 768, height: 1024 },
      { name: "desktop-1280", width: 1280, height: 800 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      // EN Light Account
      await selectLanguage(page, "en");
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `account-en-light-${vp.name}.png`),
        fullPage: true,
      });

      // AR Light Account
      await selectLanguage(page, "ar");
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `account-ar-light-${vp.name}.png`),
        fullPage: true,
      });

      // AR Dark Account
      await page.evaluate(() => document.documentElement.classList.add("dark"));
      await page.waitForTimeout(100);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `account-ar-dark-${vp.name}.png`),
        fullPage: true,
      });

      // Reset dark mode
      await page.evaluate(() => document.documentElement.classList.remove("dark"));
      await page.waitForTimeout(100);
    }

    // Modal Visual QA
    await page.setViewportSize({ width: 390, height: 844 });

    // Open Change Email Modal in AR
    await page.click("#btn-open-change-email");
    await expect(page.locator("#modal-change-email")).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "modal-change-email-ar-mobile.png"),
    });

    // Close Modal via Escape key
    await page.keyboard.press("Escape");
    await expect(page.locator("#modal-change-email")).toBeHidden();

    // Open Delete Account Modal in EN
    await selectLanguage(page, "en");
    await page.click("#btn-open-delete-account");
    await expect(page.locator("#modal-delete-account")).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "modal-delete-account-en-mobile.png"),
    });
    await page.keyboard.press("Escape");
    await expect(page.locator("#modal-delete-account")).toBeHidden();
  });

  // 5. Plans Page Visual Matrix
  test("5. Plans Page Visual Matrix (EN/AR, Light/Dark, 390/768/1280)", async ({ page }) => {
    const viewports = [
      { name: "mobile-390", width: 390, height: 844 },
      { name: "tablet-768", width: 768, height: 1024 },
      { name: "desktop-1280", width: 1280, height: 800 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${API}/portal/#/plans`);

      // EN Light
      await selectLanguage(page, "en");
      await expect(page.locator("h1")).toContainText("Membership Plans");
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `plans-en-light-${vp.name}.png`),
        fullPage: true,
      });

      // AR Light
      await selectLanguage(page, "ar");
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `plans-ar-light-${vp.name}.png`),
        fullPage: true,
      });

      // AR Dark
      await page.evaluate(() => document.documentElement.classList.add("dark"));
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `plans-ar-dark-${vp.name}.png`),
        fullPage: true,
      });

      // Reset dark
      await page.evaluate(() => document.documentElement.classList.remove("dark"));
    }
  });
});
