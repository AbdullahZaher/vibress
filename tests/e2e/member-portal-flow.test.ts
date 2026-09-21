import { test, expect } from "@playwright/test";

const API = "http://localhost:7777";

test.describe("Phase 1-10: Member Portal End-to-End Certification Flow", () => {
  test.beforeEach(async () => {
    await fetch("http://127.0.0.1:8025/api/v1/messages", {
      method: "DELETE",
    }).catch(() => {});
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

  test("Scanner Safety, Arabic RTL, Newsletter Preferences, Email Change & Self-Deletion", async ({
    page,
    request,
  }) => {
    const initialEmail = `portal-e2e-${Date.now()}@example.com`;
    const newEmail = `portal-new-${Date.now()}@example.com`;

    // ----------------------------------------------------
    // 1. Sign In / Request Magic Link
    // ----------------------------------------------------
    await page.goto(`${API}/portal/`);
    await expect(page.locator("h1")).toContainText("Vibress");
    await page.fill("#email", initialEmail);
    await page.click('button[type="submit"]');
    await expect(page.locator("h1")).toContainText("Check your email");

    // ----------------------------------------------------
    // 2. Scanner Safety: Scanner GET requests
    // ----------------------------------------------------
    const magicLinkUrl = await extractTokenFromMail(initialEmail);
    const token = magicLinkUrl.includes("token=")
      ? magicLinkUrl.split("token=")[1]!.split("&")[0]!
      : "";

    // Antivirus scanner GET simulation
    const scannerGet = await request.get(
      `${API}/api/members/v1/auth/verify?token=${token}`,
      { maxRedirects: 0 },
    );
    expect(scannerGet.status()).toBe(302);
    expect(scannerGet.headers()["location"]).toContain("/portal/#/auth/verify?token=");

    // Token must NOT be consumed by scanner
    // Real browser navigation to verification page
    await page.goto(`${API}/portal/#/auth/verify?token=${token}`);
    await expect(page.locator("h1")).toContainText("Your account", {
      timeout: 15000,
    });
    await expect(page.locator("#member-email-display")).toContainText(initialEmail);

    // ----------------------------------------------------
    // 3. Portal Localization: Arabic RTL Switch
    // ----------------------------------------------------
    // Switch to Arabic via modern select menu
    await page.click("#portal-language-selector");
    await page.click("#portal-lang-ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("h1")).toContainText("حسابك");
    await expect(page.locator("body")).toContainText("معلومات الملف الشخصي");

    // Switch back to English via modern select menu
    await page.click("#portal-language-selector");
    await page.click("#portal-lang-en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("h1")).toContainText("Your account");

    // ----------------------------------------------------
    // 4. Newsletter Preferences with Clean Metadata
    // ----------------------------------------------------
    // Check if newsletters section is rendered
    const newsletterSection = page.locator("#newsletter-preferences-section");
    await expect(newsletterSection).toBeVisible();
    // Verify no raw UUID keys displayed as titles
    const textContent = await newsletterSection.innerText();
    expect(textContent).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}/i);

    // ----------------------------------------------------
    // 5. Member Verified Email Change
    // ----------------------------------------------------
    await page.click("#btn-open-change-email");
    await expect(page.locator("#modal-change-email")).toBeVisible();
    await page.fill("#new-email", newEmail);
    await page.click("#btn-confirm-email-change");
    await expect(page.locator("#email-change-status")).toBeVisible();

    // Verify verification email was sent to new email
    const changeLinkUrl = await extractTokenFromMail(newEmail);
    const changeToken = changeLinkUrl.includes("token=")
      ? changeLinkUrl.split("token=")[1]!.split("&")[0]!
      : "";

    // Confirm email change via API
    const confirmRes = await request.post(
      `${API}/api/members/v1/auth/confirm-email-change`,
      {
        data: { token: changeToken },
      },
    );
    expect(confirmRes.status()).toBe(200);

    // Reload account page to verify email changed
    await page.reload();
    await expect(page.locator("#member-email-display")).toContainText(newEmail);

    // ----------------------------------------------------
    // 6. Member Account Self-Deletion
    // ----------------------------------------------------
    await page.click("#btn-open-delete-account");
    await expect(page.locator("#modal-delete-account")).toBeVisible();
    await page.click("#btn-confirm-delete-account");

    // Should redirect to sign-in page
    await expect(page.locator("h1")).toContainText("Vibress", { timeout: 10000 });

    // Visiting account should show session expired
    await page.goto(`${API}/portal/#/account`);
    await expect(page.locator("h1")).toContainText("Your session is no longer valid");
  });
});
