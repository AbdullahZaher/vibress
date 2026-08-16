import { test, expect, Page } from "@playwright/test";

/**
 * Studio card selection — real UI flows for the cards whose editing forms
 * require the card to be selected (previously broken: clicking a card never
 * activated isSelected, so these could only be configured via API fixtures).
 *
 * Flows: insert → select card chrome → editing UI appears → edit → save →
 * reload editor → values preserved → publish → public page renders.
 * HTML card additionally proves sanitization survives on the public page.
 */

const BASE = process.env.VIBRESS_E2E_BASE || "http://localhost:7777";

test.setTimeout(150 * 1000);

async function login(page: Page) {
  await page.goto(`${BASE}/admin/login`);
  await page.fill("#email", "owner@example.com");
  await page.fill("#password", "OwnerPass123!");
  await page.click('button[type="submit"]');
  await page
    .getByRole("button", { name: "Posts", exact: true })
    .waitFor({ timeout: 25000 });
}

function mainEditor(page: Page) {
  return page.locator(
    'xpath=//div[contains(@class,"vibress-studio-editor")]//div[@contenteditable="true" and not(ancestor::div[contains(@class,"-card")])]',
  );
}

async function insertCard(page: Page, label: string) {
  const editor = mainEditor(page);
  await editor.click({ position: { x: 100, y: 8 } });
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(" /");
  const item = page
    .locator(".studio-slash-item")
    .filter({
      has: page.locator(".studio-slash-title", {
        hasText: new RegExp(`^${label}$`, "i"),
      }),
    })
    .first();
  await item.waitFor({ timeout: 8000 });
  await item.click();
  await page.waitForTimeout(600);
  const close = page.locator('button[aria-label="Close"]');
  if (await close.isVisible({ timeout: 3000 }).catch(() => false)) {
    await close.click();
    await page.waitForTimeout(400);
  }
}

/** Click the non-interactive chrome of the last card of a type to select it. */
async function selectCard(page: Page, cardSelector: string) {
  const card = page.locator(cardSelector).last();
  await card.scrollIntoViewIfNeeded();
  if (cardSelector === ".vb-button-card") {
    const input = card.locator('input[placeholder="Add button text"]');
    if (await input.isVisible().catch(() => false)) {
      return;
    }
    const trigger = card.locator('button[data-testid="vb-button-trigger"], button').first();
    if (await trigger.isVisible()) {
      await trigger.click({ force: true });
      await page.waitForTimeout(400);
      return;
    }
  }
  const box = await card.boundingBox();
  if (!box) throw new Error(`card not visible: ${cardSelector}`);
  await page.mouse.click(box.x + box.width - 15, box.y + box.height - 10);
  await page.waitForTimeout(400);
}

async function createDraft(page: Page, title: string): Promise<string> {
  await page.getByRole("button", { name: "Posts", exact: true }).click();
  await page.waitForTimeout(800);
  await page.click('button:has-text("Create Post")');
  await page.waitForTimeout(1000);
  await page.locator('textarea[aria-label="Post Title"]').fill(title);
  return title;
}

async function saveDraft(page: Page) {
  // Deselect the card so the floating card-action popup (top-right overlay)
  // does not cover the header's Save button.
  const editor = mainEditor(page);
  await editor.click({ position: { x: 100, y: 8 } });
  await page.keyboard.press("Control+End");
  await page.waitForTimeout(300);
  const btn = page.locator('button:has-text("Save Draft")');
  await btn.scrollIntoViewIfNeeded();
  await btn.click({ timeout: 8000 });
  await page.waitForTimeout(4000);
}

async function publish(page: Page) {
  // Deselect the card so the floating card-action popup does not cover the
  // header's Publish button.
  const editor = mainEditor(page);
  await editor.click({ position: { x: 100, y: 8 } });
  await page.keyboard.press("Control+End");
  await page.waitForTimeout(300);
  await page.locator('button:has-text("Publish Now")').click({ timeout: 8000 });
  await page.waitForTimeout(3000);
}

async function openEditorFor(
  page: Page,
  request: Page["request"],
  title: string,
) {
  const list = await request.get(
    `${BASE}/api/admin/v1/posts?search=${encodeURIComponent(title)}`,
    {
      headers: { Origin: "http://localhost:7777" },
    },
  );
  expect(list.status()).toBe(200);
  const found = (await list.json()).posts.find(
    (p: { title: string }) => p.title === title,
  );
  expect(found).toBeTruthy();
  await page.goto(`${BASE}/admin/posts/${found.id}`);
  await page.waitForTimeout(1800);
  await page.locator("div.vibress-studio-editor").waitFor({ timeout: 10000 });
}

test.describe("Studio card selection (real UI)", () => {
  test("[Button] select, edit, save, reload, publish — no fixtures", async ({
    page,
    request,
  }) => {
    await request.post(`${BASE}/api/admin/v1/auth/login`, {
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:7777",
      },
      data: { email: "owner@example.com", password: "OwnerPass123!" },
    });
    await login(page);
    const title = `Studio Select Button ${Date.now()}`;
    await createDraft(page, title);

    await insertCard(page, "Button");
    await selectCard(page, ".vb-button-card");

    // Editing UI appears (form gated on isSelected).
    const labelInput = page.locator(
      '.vb-button-card input[placeholder="Add button text"]',
    );
    await expect(labelInput).toBeVisible();
    await labelInput.fill("Buy now");
    await page
      .locator('.vb-button-card input[type="url"]')
      .fill("https://store.example/product");

    await saveDraft(page);

    // Re-open the saved post from the list — values must survive.
    await openEditorFor(page, request, title);
    await page.locator(".vb-button-card").last().waitFor({ timeout: 10000 });
    await selectCard(page, ".vb-button-card");
    await expect(
      page.locator('.vb-button-card input[placeholder="Add button text"]'),
    ).toHaveValue("Buy now");
    await expect(page.locator('.vb-button-card input[type="url"]')).toHaveValue(
      "https://store.example/product",
    );

    await publish(page);

    // Resolve slug + open the public page.
    const list = await request.get(
      `${BASE}/api/admin/v1/posts?search=${encodeURIComponent(title)}`,
      { headers: { Origin: "http://localhost:7777" } },
    );
    const found = (await list.json()).posts.find(
      (p: { title: string }) => p.title === title,
    );
    expect(found).toBeTruthy();
    await page.goto(`${BASE}/posts/${found.slug}`);
    await page.waitForSelector(".vb-content", { timeout: 15000 });
    await expect(page.locator(".kg-button-card a")).toHaveText("Buy now");
    await expect(page.locator(".kg-button-card a")).toHaveAttribute(
      "href",
      "https://store.example/product",
    );
  });

  test("[Markdown] select, edit, save, reload, publish — no fixtures", async ({
    page,
    request,
  }) => {
    await request.post(`${BASE}/api/admin/v1/auth/login`, {
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:7777",
      },
      data: { email: "owner@example.com", password: "OwnerPass123!" },
    });
    await login(page);
    const title = `Studio Select Markdown ${Date.now()}`;
    await createDraft(page, title);

    await insertCard(page, "Markdown");
    await page.waitForTimeout(500);
    const card = page.locator(".vb-markdown-card").last();
    await card.scrollIntoViewIfNeeded();
    await selectCard(page, ".vb-markdown-card");
    const md = page
      .locator('textarea[placeholder="Type your markdown here..."]')
      .last();
    await expect(md).toBeVisible({ timeout: 10000 });
    await md.fill(
      "## A Heading\n\nSome **bold text** and a [link](https://example.com/a)",
    );

    await saveDraft(page);

    await openEditorFor(page, request, title);
    await page.locator(".vb-markdown-card").last().waitFor({ timeout: 10000 });
    await selectCard(page, ".vb-markdown-card");
    await expect(
      page.locator('textarea[placeholder="Type your markdown here..."]').last(),
    ).toHaveValue(/## A Heading/);

    await publish(page);

    const list = await request.get(
      `${BASE}/api/admin/v1/posts?search=${encodeURIComponent(title)}`,
      { headers: { Origin: "http://localhost:7777" } },
    );
    const found = (await list.json()).posts.find(
      (p: { title: string }) => p.title === title,
    );
    expect(found).toBeTruthy();
    await page.goto(`${BASE}/posts/${found.slug}`);
    await page.waitForSelector(".vb-content", { timeout: 15000 });
    await expect(page.locator(".studio-html-content h2")).toHaveText(
      "A Heading",
    );
    await expect(page.locator(".studio-html-content strong")).toHaveText(
      "bold text",
    );
    await expect(
      page.locator('.studio-html-content a[href="https://example.com/a"]'),
    ).toHaveText("link");
  });

  test("[HTML] select, edit, save, reload, publish + sanitization — no fixtures", async ({
    page,
    request,
  }) => {
    await request.post(`${BASE}/api/admin/v1/auth/login`, {
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:7777",
      },
      data: { email: "owner@example.com", password: "OwnerPass123!" },
    });
    await login(page);
    const title = `Studio Select HTML ${Date.now()}`;
    await createDraft(page, title);

    await insertCard(page, "Html");
    await selectCard(page, ".vb-html-card");
    const ta = page.locator(".vb-html-card textarea").last();
    await expect(ta).toBeVisible();
    await ta.fill(
      '<p class="safe-html">Safe visible content</p><script>window.__selXss = 1</script><img src=x onerror="window.__selXss=2">',
    );

    await saveDraft(page);

    await openEditorFor(page, request, title);
    await page.locator(".vb-html-card").last().waitFor({ timeout: 10000 });
    await selectCard(page, ".vb-html-card");
    await expect(page.locator(".vb-html-card textarea").last()).toHaveValue(
      /Safe visible content/,
    );

    await publish(page);

    const list = await request.get(
      `${BASE}/api/admin/v1/posts?search=${encodeURIComponent(title)}`,
      { headers: { Origin: "http://localhost:7777" } },
    );
    const found = (await list.json()).posts.find(
      (p: { title: string }) => p.title === title,
    );
    expect(found).toBeTruthy();
    await page.goto(`${BASE}/posts/${found.slug}`);
    await page.waitForSelector("p.safe-html", { timeout: 15000 });
    await expect(page.locator("p.safe-html")).toHaveText(
      "Safe visible content",
    );
    const html = await page.locator(".vb-content").innerHTML();
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    const executed = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__selXss,
    );
    expect(executed).toBeUndefined();
  });
});
