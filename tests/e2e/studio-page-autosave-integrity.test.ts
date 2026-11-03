import { expect, test } from "@playwright/test";

const BASE = process.env.VIBRESS_E2E_BASE || "http://localhost:7777";

test("page autosave persists the latest content without remounting Lexical", async ({
  page,
}) => {
  test.setTimeout(90_000);

  await page.goto(`${BASE}/admin/login`);
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill("OwnerPass123!");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(
    (url) => url.pathname.startsWith("/admin") && !url.pathname.includes("/login"),
  );

  await page.getByRole("button", { name: "Pages", exact: true }).click();
  await page.waitForURL("**/admin/pages");
  await page.getByRole("button", { name: "Create Page", exact: true }).click();
  await page.waitForURL("**/admin/pages/new");

  await page.locator('textarea[aria-label="Page Title"]').fill(
    `Autosave continuity ${Date.now()}`,
  );
  const editor = page.locator(
    '.vibress-studio-editor [contenteditable="true"]',
  ).first();
  await editor.click();
  await page.keyboard.type("Initial page content. ");

  await page.getByRole("button", { name: "Create Page", exact: true }).click();
  await page.waitForURL(
    (url) => /^\/admin\/pages\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith("/new"),
  );
  await expect(editor).toBeVisible();

  const editorBeforeSave = await editor.elementHandle();
  expect(editorBeforeSave).not.toBeNull();

  const marker = `Latest editor draft ${Date.now()} مرحبا`;
  const savedResponse = page.waitForResponse((response) => {
    if (
      !response.url().includes("/api/admin/v1/pages/") ||
      response.request().method() !== "PUT" ||
      response.status() !== 200
    ) {
      return false;
    }
    // This checks the exact state submitted, not a stale closure that may
    // have been scheduled before React committed the latest document.
    return response.request().postData()?.includes(marker) ?? false;
  });

  await editor.click();
  await page.keyboard.type(marker);
  await savedResponse;

  // A version bump must not destroy the current editor, selection or history.
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(await editorBeforeSave?.evaluate((node) => node.isConnected)).toBe(
    true,
  );

  await page.reload();
  await expect(editor).toContainText(marker);
});
