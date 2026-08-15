import { test, expect, Page } from "@playwright/test";

/**
 * Studio public rendering — regression protection.
 *
 * Post: real Admin Studio UI — insert every supported card type (13) via the
 *       slash menu + media picker, save, publish, then verify the public page
 *       renders each card as semantic HTML.
 * Page: all 13 cards seeded via the admin API and published; verifies the
 *       shared public renderer on the Page endpoint.
 * Security: an HTML card with malicious payloads is sanitized on the public
 *       page (no script execution, safe content preserved).
 *
 * Base URL: VIBRESS_E2E_BASE overrides localhost (hosts with port conflicts).
 */

const BASE = process.env.VIBRESS_E2E_BASE || "http://localhost:7777";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
// Minimal valid containers (signature-detected by the media validator).
const MINI_MP4 = Buffer.from([
  0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0,
  0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32, 0x6d, 0x70, 0x34, 0x31,
]);
const MINI_MP3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]);
const MINI_PDF = Buffer.from(
  "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF",
);

const cardList = [
  "Image",
  "Gallery",
  "Video",
  "Audio",
  "File",
  "Bookmark",
  "Embed",
  "Button",
  "Callout",
  "Toggle",
  "Markdown",
  "Html",
  "Divider",
] as const;

async function login(page: Page) {
  await page.goto(`${BASE}/admin/login`);
  await page.fill("#email", "owner@example.com");
  await page.fill("#password", "OwnerPass123!");
  await page.click('button[type="submit"]');
  await page
    .getByRole("button", { name: "Posts", exact: true })
    .waitFor({ timeout: 25000 });
}

async function uploadAsset(
  request: Page["request"],
  name: string,
  mimeType: string,
  buffer: Buffer,
) {
  const res = await request.post(`${BASE}/api/admin/v1/media`, {
    headers: { Origin: "http://localhost:7777" },
    multipart: { file: { name, mimeType, buffer } },
  });
  expect(res.status(), `upload ${name}`).toBe(201);
  return (await res.json()).media.id;
}

/** Move the caret to the end of the document and trigger the slash menu.
 *  The main editor cannot be selected by CSS class (nested caption editors are
 *  also contenteditable), so we click the bottom of the editor container —
 *  after the last card there is always the trailing empty paragraph. */
// The main editor is the only contenteditable NOT nested inside a card
// (nested caption editors are also contenteditable elements).
function mainEditor(page: Page) {
  return page.locator(
    'xpath=//div[contains(@class,"vibress-studio-editor")]//div[@contenteditable="true" and not(ancestor::div[contains(@class,"-card")])]',
  );
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

async function insertCard(page: Page, label: string) {
  const editor = mainEditor(page);
  await editor.scrollIntoViewIfNeeded();
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
}

async function closePicker(page: Page) {
  const close = page.locator('button[aria-label="Close"]');
  if (await close.isVisible({ timeout: 3000 }).catch(() => false)) {
    await close.click();
    await page.waitForTimeout(400);
  }
}

async function pickAsset(page: Page, title: string) {
  await page.waitForSelector('h3:has-text("Select Media Asset")', {
    timeout: 10000,
  });
  const modal = page.locator("div.fixed.inset-0").first();
  await modal.waitFor({ timeout: 10000 });
  const asset = modal
    .locator(`[data-testid="media-picker-item"], div[title="${title}"], img[alt="${title}"]`)
    .filter({ hasText: title })
    .first();
  if (await asset.isVisible({ timeout: 4000 }).catch(() => false)) {
    await asset.click();
  } else {
    // Fallback if title text is in child or tooltip
    const fallback = modal.locator(`div:has-text("${title}"), [title*="${title}"], [alt*="${title}"]`).last();
    await fallback.click();
  }
  await page.waitForTimeout(600);
}

test.describe("Studio public rendering", () => {
  let postSlug = "";
  let pageSlug = "";
  // The 13-card Post flow inserts + configures every card through the real
  // Studio UI and publishes — allow it more time than the default 30s.
  test.setTimeout(180 * 1000);

  test.beforeAll(async ({ request }) => {
    await request.post(`${BASE}/api/admin/v1/auth/login`, {
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:7777",
      },
      data: { email: "owner@example.com", password: "OwnerPass123!" },
    });
    await uploadAsset(request, "e2e-img-a.png", "image/png", PNG_1x1);
    await uploadAsset(request, "e2e-img-b.png", "image/png", PNG_1x1);
    await uploadAsset(request, "e2e-video.mp4", "video/mp4", MINI_MP4);
    await uploadAsset(request, "e2e-audio.mp3", "audio/mpeg", MINI_MP3);
    await uploadAsset(request, "e2e-file.pdf", "application/pdf", MINI_PDF);
  });

  test("[Post] all 13 Studio cards render on the published public page", async ({
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
    await page.getByRole("button", { name: "Posts", exact: true }).click();
    await page.waitForTimeout(800);
    await page.click('button:has-text("Create Post")');
    await page.waitForTimeout(800);
    const title = `Studio Public Cards ${Date.now()}`;
    await page.locator('textarea[aria-label="Post Title"]').fill(title);

    await page.locator("div.vibress-studio-editor").waitFor({ timeout: 10000 });

    // --- image ---
    await insertCard(page, "Image");
    await pickAsset(page, "e2e-img-a.png");

    // --- gallery ---
    await insertCard(page, "Gallery");
    await page.waitForSelector('h3:has-text("Select Media Asset")', {
      timeout: 10000,
    });
    const modal = page.locator("div.fixed.inset-0").first();
    await modal.waitFor({ timeout: 10000 });
    await page.waitForFunction(
      () =>
        Array.from(
          document.querySelectorAll('div.fixed.inset-0 img[alt]:not([alt=""])'),
        ).length >= 2,
      null,
      { timeout: 10000 },
    );
    const pickerImgs = modal.locator('img[alt]:not([alt=""])');
    await pickerImgs.nth(0).click();
    await pickerImgs.nth(1).click();
    await page
      .locator('button:has-text("Asset(s)")')
      .first()
      .click({ timeout: 5000 });
    await page.waitForTimeout(800);

    // --- video / audio / file ---
    await insertCard(page, "Video");
    await pickAsset(page, "e2e-video.mp4");
    await insertCard(page, "Audio");
    await pickAsset(page, "e2e-audio.mp3");
    await insertCard(page, "File");
    await pickAsset(page, "e2e-file.pdf");

    // --- bookmark ---
    await insertCard(page, "Bookmark");
    await closePicker(page);
    await page
      .locator('input[type="url"], input[placeholder*="Paste link"]')
      .last()
      .fill("https://example.com/bookmark");
    await page.locator('button:has-text("Save")').last().click();
    await page.waitForTimeout(400);

    // --- embed (YouTube) ---
    await insertCard(page, "Embed");
    await closePicker(page);
    await page
      .locator('input[type="url"], input[placeholder*="Paste link"]')
      .last()
      .fill("https://www.youtube.com/watch?v=abc123def");
    await page.locator('button:has-text("Embed"), button:has-text("Save")').last().click();
    await page.waitForTimeout(400);

    // --- button (select the card → interactive form opens via the real UI) ---
    await insertCard(page, "Button");
    await closePicker(page);
    await selectCard(page, ".vb-button-card");
    await page
      .locator('.vb-button-card input[placeholder="Add button text"]')
      .fill("Buy now");
    await page
      .locator('.vb-button-card input[type="url"]')
      .fill("https://store.example/product");
    await page.waitForTimeout(300);

    // --- callout ---
    await insertCard(page, "Callout");
    await closePicker(page);
    await page
      .locator('textarea[placeholder="Type callout text here..."]')
      .last()
      .fill("Heads up — important note");
    await page.waitForTimeout(300);

    // --- toggle (heading + content textareas are rendered unconditionally) ---
    await insertCard(page, "Toggle");
    await closePicker(page);
    await page
      .locator('textarea[placeholder="Toggle heading..."]')
      .last()
      .fill("Common questions");
    await page
      .locator('textarea[placeholder="Toggle content..."]')
      .last()
      .fill("This is the answer.");
    await page.waitForTimeout(300);

    // --- markdown (selection-gated textarea — real UI flow) ---
    await insertCard(page, "Markdown");
    await closePicker(page);
    await selectCard(page, ".vb-markdown-card");
    await page
      .locator('textarea[placeholder="Type your markdown here..."]')
      .last()
      .fill("**bold text** and _italic_");
    await page.waitForTimeout(300);

    // --- html (selection-gated textarea — real UI flow) ---
    await insertCard(page, "Html");
    await closePicker(page);
    await selectCard(page, ".vb-html-card");
    await page
      .locator(".vb-html-card textarea")
      .last()
      .fill('<div class="widget">A <strong>safe</strong> widget</div>');
    await page.waitForTimeout(300);

    // --- divider (no configuration) ---
    await insertCard(page, "Divider");
    await closePicker(page);

    // Save through the real UI (creates the draft).
    await page
      .locator('button:has-text("Save Draft")')
      .scrollIntoViewIfNeeded();
    await page
      .locator('button:has-text("Save Draft")')
      .click({ force: true, timeout: 5000 });
    await page.waitForTimeout(4000);

    // Publish through the real UI.
    await page
      .locator('button:has-text("Publish Now")')
      .click({ timeout: 8000 });
    await page.waitForTimeout(3000);

    // Resolve the published post slug from the admin API.
    const list = await request.get(
      `${BASE}/api/admin/v1/posts?search=${encodeURIComponent(title)}`,
      { headers: { Origin: "http://localhost:7777" } },
    );
    expect(list.status()).toBe(200);
    const found = (await list.json()).posts.find(
      (p: { title: string }) => p.title === title,
    );
    expect(found).toBeTruthy();
    postSlug = found.slug;

    // Open the public page and assert every card renders semantically.
    await page.goto(`${BASE}/posts/${postSlug}`);
    await page.waitForSelector(".vb-content", { timeout: 15000 });

    await expect(page.locator("figure.kg-image-card img")).toBeVisible();
    await expect(page.locator("figure.kg-gallery-card")).toBeVisible();
    await expect(page.locator("figure.kg-gallery-card img")).toHaveCount(2);
    await expect(page.locator("video[controls]")).toBeVisible();
    await expect(page.locator("audio[controls]")).toBeVisible();
    await expect(page.locator(".kg-file-card a[download]")).toBeVisible();
    await expect(page.locator(".kg-bookmark-card a")).toHaveAttribute(
      "href",
      /example\.com\/bookmark/,
    );
    await expect(page.locator(".kg-bookmark-card")).toContainText(
      "example.com",
    );
    const embedIframe = page.locator(".kg-embed-card iframe");
    await expect(embedIframe).toBeVisible();
    await expect(embedIframe).toHaveAttribute(
      "src",
      /youtube-nocookie\.com\/embed\/abc123def/,
    );
    await expect(page.locator(".kg-button-card a")).toContainText("Buy now");
    await expect(page.locator(".kg-callout-card")).toContainText(
      "important note",
    );
    await expect(page.locator("details.kg-toggle-card summary")).toContainText(
      "Common questions",
    );
    await expect(page.locator(".kg-toggle-card")).toContainText(
      "This is the answer.",
    );
    await expect(
      page.locator('.studio-html-content strong:has-text("bold text")'),
    ).toBeVisible();
    await expect(page.locator(".studio-html-content div.widget")).toContainText(
      "safe",
    );
    await expect(page.locator("hr")).toHaveCount(1);
  });

  test("[Page] all 13 cards render on the published public page", async ({
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
    const me = await (
      await request.get(`${BASE}/api/admin/v1/auth/me`, {
        headers: { Origin: BASE },
      })
    ).json();

    const cards = [
      {
        type: "studio-card",
        cardType: "image",
        cardData: { src: `${BASE}/content/media/e2e-img.png`, alt: "p image" },
        version: 1,
      },
      {
        type: "studio-card",
        cardType: "gallery",
        cardData: {
          images: [
            { src: `${BASE}/g1.png`, alt: "one" },
            { src: `${BASE}/g2.png`, alt: "two" },
          ],
        },
        version: 1,
      },
      {
        type: "studio-card",
        cardType: "video",
        cardData: { src: `${BASE}/v.mp4`, caption: "vid" },
        version: 1,
      },
      {
        type: "studio-card",
        cardType: "audio",
        cardData: { src: `${BASE}/a.mp3`, title: "pod" },
        version: 1,
      },
      {
        type: "studio-card",
        cardType: "file",
        cardData: {
          src: `${BASE}/f.pdf`,
          fileName: "report.pdf",
          fileSize: "1.2 MB",
        },
        version: 1,
      },
      {
        type: "studio-card",
        cardType: "bookmark",
        cardData: {
          url: "https://example.com/a",
          title: "Example",
          description: "desc",
        },
        version: 1,
      },
      {
        type: "studio-card",
        cardType: "embed",
        cardData: {
          url: "https://www.youtube.com/watch?v=xyz789",
          embedType: "video",
        },
        version: 1,
      },
      {
        type: "studio-card",
        cardType: "button",
        cardData: { text: "Sign up", url: "https://store.example/signup" },
        version: 1,
      },
      {
        type: "studio-card",
        cardType: "callout",
        cardData: { text: "Page note", emoji: "💡" },
        version: 1,
      },
      {
        type: "studio-card",
        cardType: "toggle",
        cardData: { heading: "Page FAQ", content: "Page answer" },
        version: 1,
      },
      {
        type: "studio-card",
        cardType: "markdown",
        cardData: { markdown: "**page bold**" },
        version: 1,
      },
      {
        type: "studio-card",
        cardType: "html",
        cardData: { html: '<p class="page-safe">page safe html</p>' },
        version: 1,
      },
      { type: "studio-card", cardType: "divider", cardData: {}, version: 1 },
    ];

    const slug = `studio-page-cards-${Date.now()}`;
    const created = await request.post(`${BASE}/api/admin/v1/pages`, {
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:7777",
      },
      data: {
        title: "Studio Cards Page",
        slug,
        primaryAuthorId: me.user.id,
        content: {
          schema: "vibress-studio",
          version: 1,
          root: { type: "root", children: cards },
        },
      },
    });
    expect(created.status()).toBe(201);
    pageSlug = (await created.json()).page.slug;
    const pageId = (await created.json()).page.id;
    const pub = await request.post(
      `${BASE}/api/admin/v1/pages/${pageId}/publish`,
      {
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:7777",
        },
        data: {},
      },
    );
    expect(pub.status()).toBe(200);

    await page.goto(`${BASE}/pages/${pageSlug}`);
    await page.waitForSelector(".vb-content", { timeout: 15000 });
    await expect(page.locator("figure.kg-image-card img")).toBeVisible();
    await expect(page.locator("figure.kg-gallery-card")).toBeVisible();
    await expect(page.locator("video[controls]")).toBeVisible();
    await expect(page.locator("audio[controls]")).toBeVisible();
    await expect(page.locator(".kg-file-card a")).toBeVisible();
    await expect(page.locator(".kg-bookmark-card a")).toHaveAttribute(
      "href",
      /example\.com\/a/,
    );
    await expect(page.locator(".kg-embed-card iframe")).toHaveAttribute(
      "src",
      /youtube-nocookie\.com\/embed\/xyz789/,
    );
    await expect(page.locator(".kg-button-card a")).toContainText("Sign up");
    await expect(page.locator(".kg-callout-card")).toContainText("Page note");
    await expect(page.locator("details.kg-toggle-card summary")).toContainText(
      "Page FAQ",
    );
    await expect(
      page.locator('.studio-html-content strong:has-text("page bold")'),
    ).toBeVisible();
    await expect(page.locator("p.page-safe")).toContainText("page safe html");
    await expect(page.locator("hr")).toHaveCount(1);
  });

  test("[Security] malicious HTML card is sanitized on the public page", async ({
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
    const me = await (
      await request.get(`${BASE}/api/admin/v1/auth/me`, {
        headers: { Origin: BASE },
      })
    ).json();
    const slug = `studio-xss-${Date.now()}`;
    const payload =
      '<script>window.__xssE2E=1</script><img src=x onerror="window.__xssE2E=2"><a href="javascript:window.__xssE2E=3">bad</a><p class="safe-text">safe content survives</p>';
    const created = await request.post(`${BASE}/api/admin/v1/posts`, {
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:7777",
      },
      data: {
        title: "Studio XSS",
        slug,
        primaryAuthorId: me.user.id,
        content: {
          schema: "vibress-studio",
          version: 1,
          root: {
            type: "root",
            children: [
              {
                type: "studio-card",
                cardType: "html",
                cardData: { html: payload },
                version: 1,
              },
            ],
          },
        },
      },
    });
    expect(created.status()).toBe(201);
    const xssPostId = (await created.json()).post.id;
    await request.post(`${BASE}/api/admin/v1/posts/${xssPostId}/publish`, {
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:7777",
      },
      data: {},
    });

    await page.goto(`${BASE}/posts/${slug}`);
    await page.waitForSelector("p.safe-text", { timeout: 15000 });
    await expect(page.locator("p.safe-text")).toContainText(
      "safe content survives",
    );
    const html = await page.locator(".vb-content").innerHTML();
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
    // No script executed in the page.
    const executed = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__xssE2E,
    );
    expect(executed).toBeUndefined();
  });
});
