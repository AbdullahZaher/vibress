import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const BASE = process.env.VIBRESS_E2E_BASE || "http://localhost:7777";
const headers = { Origin: BASE };
const textNode = (text: string, format = 0, style = "") => ({
  type: "text", version: 1, text, format, style, detail: 0, mode: "normal",
});
const element = (type: string, children: unknown[], direction: "rtl" | "ltr" | null = null) => ({
  type, version: 1, children, direction, format: "", indent: 0,
});
const studioDocument = (children: unknown[]) => ({
  schema: "vibress-studio", version: 1, root: element("root", children),
});

// Lexical 0.13 recalculates direction on structural table wrappers from
// their cells. Paragraph direction inside each cell remains an invariant.
function omitDerivedTableDirection(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(omitDerivedTableDirection);
  if (!node || typeof node !== "object") return node;
  const isTableWrapper = "type" in node &&
    (node.type === "table" || node.type === "tablerow" || node.type === "tablecell");
  return Object.fromEntries(Object.entries(node)
    .filter(([key]) => key !== "direction" || !isTableWrapper)
    .map(([key, value]) => [key, key === "root" || key === "children" ? omitDerivedTableDirection(value) : value]));
}

async function login(page: Page) {
  await page.goto(`${BASE}/admin/login`);
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill("OwnerPass123!");
  await page.locator('button[type="submit"]').click();
  await page.getByRole("button", { name: "Posts", exact: true }).waitFor();
  const me = await page.request.get(`${BASE}/api/admin/v1/auth/me`);
  expect(me.ok()).toBe(true);
  const { user } = await me.json();
  return user.id;
}

async function createPost(page: Page, title: string, primaryAuthorId: string, content: unknown) {
  const slug = `beta-${Date.now()}-${title.toLowerCase().replaceAll(" ", "-")}`;
  const created = await page.request.post(`${BASE}/api/admin/v1/posts`, {
    headers, data: { title, slug, primaryAuthorId, content },
  });
  expect(created.status()).toBe(201);
  const { post } = await created.json();
  if (typeof post.id !== "string") throw new Error("Create post did not return an ID");
  return { slug, id: post.id };
}

async function getContent(page: Page, id: string) {
  const res = await page.request.get(`${BASE}/api/admin/v1/posts/${id}`);
  expect(res.status()).toBe(200);
  const { post } = await res.json();
  return post.content;
}

test("mixed-direction article retains structured content across three host edit and reload cycles", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const ownerId = await login(page);
  const upload = await page.request.post(`${BASE}/api/admin/v1/media`, {
    headers,
    multipart: {
      file: {
        name: "beta-integrity.png",
        mimeType: "image/png",
        buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/afoAAAAASUVORK5CYII=", "base64"),
      },
    },
  });
  expect(upload.status()).toBe(201);
  const { media } = await upload.json();
  const legacyImage = {
    type: "react-studio-card", version: 1, cardType: "image",
    cardData: { assetId: media.id, src: media.url, alt: "صورة Article", caption: "صورة 123" },
  };
  const preservedBlocks = [
    { ...element("heading", [textNode("عنوان Beta")], "rtl"), tag: "h2" },
    element("paragraph", [textNode("العربية English 123", 1, "color: #123456;")], "rtl"),
    element("paragraph", [textNode("English "), {
      ...element("link", [textNode("مرجع 123", 2)], "rtl"),
      url: "https://example.com/reference", rel: null, target: null, title: null,
    }], "ltr"),
    element("quote", [textNode("A mixed quotation · اقتباس")], "ltr"),
    {
      ...element("list", [
        { ...element("listitem", [textNode("Item four")], "ltr"), value: 4 },
        { ...element("listitem", [{
          ...element("list", [{ ...element("listitem", [textNode("Nested")], "ltr"), indent: 1, value: 1 }], "ltr"),
          listType: "bullet", tag: "ul", start: 1,
        }], "ltr"), value: 5 },
        { ...element("listitem", [textNode("Item five")], "ltr"), value: 5 },
      ], "ltr"),
      listType: "number", tag: "ol", start: 4,
    },
    element("table", [
      element("tablerow", [{
        ...element("tablecell", [element("paragraph", [textNode("خلية 123", 1)], "rtl")], "rtl"),
        colSpan: 1, rowSpan: 1, headerState: 1, backgroundColor: "#e5f1ff",
      }], "rtl"),
    ], "rtl"),
    legacyImage,
    { type: "studio-card", cardType: "callout", version: 1, cardData: { text: "Editorial note", emoji: "💡" } },
    { type: "studio-card", cardType: "divider", version: 1, cardData: {} },
  ];
  let checkpoint = "Beta checkpoint";
  const initial = studioDocument([...preservedBlocks, element("paragraph", [textNode(checkpoint)], "ltr")]);
  const { id, slug } = await createPost(page, "Studio lifecycle", ownerId, initial);
  const before = await getContent(page, id);
  await testInfo.attach("canonical-before", { body: JSON.stringify(before, null, 2), contentType: "application/json" });

  const canonicalBlocks = preservedBlocks.map((block) => block === legacyImage ? { ...block, type: "studio-card" } : block);
  const editor = page.locator(".vibress-studio-editor [contenteditable='true']").first();
  const editorURL = `${BASE}/admin/posts/${id}`;
  await page.goto(editorURL);
  for (let cycle = 1; cycle <= 3; cycle++) {
    const paragraph = editor.getByText(checkpoint, { exact: true });
    await expect(paragraph).toBeVisible();
    await paragraph.click();
    await page.keyboard.press("End");
    const edit = ` · Cycle ${cycle}`;
    const autosave = page.waitForResponse((res) =>
      new URL(res.url()).pathname === `/api/admin/v1/posts/${id}` &&
      res.request().method() === "PUT" && res.request().postData()?.includes(edit) === true,
    );
    await page.keyboard.insertText(edit);
    checkpoint += edit;
    expect((await autosave).status()).toBe(200);
    const after = await getContent(page, id);
    await testInfo.attach(`canonical-cycle-${cycle}`, {
      body: JSON.stringify(after, null, 2), contentType: "application/json",
    });
    const expected = studioDocument([...canonicalBlocks, element("paragraph", [textNode(checkpoint)], "ltr")]);
    // Lexical derives the root direction from the first strong block.
    expected.root.direction = "rtl";
    expect(omitDerivedTableDirection(after)).toMatchObject(omitDerivedTableDirection(expected));
    await page.reload();
    await expect(editor.getByText(checkpoint, { exact: true })).toBeVisible();
  }

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unpublish", exact: true })).toBeVisible();
  await page.goto(`${BASE}/posts/${slug}`);
  const article = page.locator(".vb-content");
  await expect(article.getByRole("heading", { name: /عنوان Beta/ })).toBeVisible();
  await expect(article.getByText("العربية English 123")).toBeVisible();
  await expect(article.locator("p[dir='rtl']").getByText("العربية English 123")).toHaveCSS("color", "rgb(18, 52, 86)");
  await expect(article.getByRole("link", { name: "مرجع 123" })).toHaveAttribute("href", "https://example.com/reference");
  const list = article.locator("ol[start='4']");
  await expect(list.locator(":scope > li")).toHaveCount(2);
  await expect(list.locator(":scope > li").first().locator("ul")).toContainText("Nested");
  await expect(article.locator("table")).toContainText("خلية 123");
  await expect(article.getByRole("columnheader", { name: "خلية 123" })).toHaveCSS("background-color", "rgb(229, 241, 255)");
  await expect(article.locator("figcaption")).toContainText("صورة 123");
  await expect(article).toContainText(checkpoint);
});

for (const kind of ["post", "page"] as const) {
  test(`host preserves and exports a persisted unknown node from a ${kind}`, async ({ page }) => {
    const ownerId = await login(page);
    const future = studioDocument([
      element("paragraph", [textNode("Existing editorial content")]),
      { type: "beta-future-node", version: 2, payload: { html: "<section>Original</section>", data: [1, 2] } },
    ]);
    const api = `${BASE}/api/admin/v1/${kind}s`;
    const created = await page.request.post(api, {
      headers,
      data: {
        title: "Studio recovery", slug: `studio-recovery-${Date.now()}`,
        primaryAuthorId: ownerId, content: future,
      },
    });
    expect(created.status()).toBe(201);
    const id = (await created.json())[kind].id;
    const load = async () => {
      const res = await page.request.get(`${api}/${id}`);
      expect(res.ok()).toBe(true);
      return (await res.json())[kind].content;
    };
    const before = await load();
    expect(before).toEqual(future);

    await page.goto(`${BASE}/admin/${kind}s/${id}`);
    const recovery = page.getByRole("heading", { name: "Document recovery required" });
    await expect(recovery).toBeVisible();
    await expect(page.locator(".vibress-studio-editor [contenteditable='true']")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(Save Draft|Save Changes|Publish)$/ })).toHaveCount(0);
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export original document" }).click();
    expect(JSON.parse(await readFile(await (await downloaded).path(), "utf8"))).toEqual(before);
    await page.reload();
    await expect(recovery).toBeVisible();
    expect(await load()).toEqual(before);
  });
}

test("stored HTML and Markdown cards, paste, links, captions and styles cannot execute in the public article", async ({ page }) => {
  const ownerId = await login(page);
  const attack = "window.__betaStudioXss = true";
  const pasteMarker = "Safe clipboard paragraph";
  const { id, slug } = await createPost(page, "Studio security", ownerId, studioDocument([
    {
      type: "studio-card", version: 1, cardType: "html",
      cardData: { html: `<script>${attack}</script><p><b>Safe HTML</b></p><img src="/invalid-beta-image" onerror="${attack}">` },
    },
    {
      type: "studio-card", version: 1, cardType: "markdown",
      cardData: { markdown: "**Safe Markdown**\n\n[unsafe Markdown](javascript:window.__betaStudioXss=true)" },
    },
    {
      type: "studio-card", version: 1, cardType: "image",
      cardData: {
        src: "/invalid-beta-caption-image", alt: "Caption fixture",
        captionHtml: `<strong>Safe caption</strong><img src="/invalid-beta-image" onerror="${attack}">`,
      },
    },
    element("paragraph", [
      { ...element("link", [textNode("unsafe inline link")]), url: "javascript:window.__betaStudioXss=true" },
      textNode("Unsafe CSS", 1, "background-image: url(javascript:window.__betaStudioXss=true);"),
      textNode("Styled text", 2, "color: #123456;"),
    ]),
    element("paragraph", [textNode("Paste here")]),
  ]));

  await page.goto(`${BASE}/admin/posts/${id}`);
  const editor = page.locator(".vibress-studio-editor [contenteditable='true']").first();
  await editor.getByText("Paste here", { exact: true }).click();
  const saved = page.waitForResponse((res) =>
    new URL(res.url()).pathname === `/api/admin/v1/posts/${id}` &&
    res.request().method() === "PUT" && res.request().postData()?.includes(pasteMarker) === true,
  );
  await editor.evaluate((editable, { attack, pasteMarker }) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", pasteMarker);
    clipboardData.setData("text/html", `<p><strong>${pasteMarker}</strong><img src="/invalid-beta-paste" onerror="${attack}"></p><script>${attack}</script>`);
    editable.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  }, { attack, pasteMarker });
  expect((await saved).status()).toBe(200);
  const persisted = await getContent(page, id);
  expect(JSON.stringify(persisted)).toContain(pasteMarker);

  await page.reload();
  await expect(editor).toContainText(pasteMarker);
  expect(await getContent(page, id)).toEqual(persisted);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unpublish", exact: true })).toBeVisible();
  const publicResponse = await page.goto(`${BASE}/posts/${slug}`);
  expect(publicResponse?.status()).toBe(200);
  const article = page.locator(".vb-content");
  await expect(article.getByText("Safe HTML", { exact: true })).toBeVisible();
  await expect(article.getByText("Safe Markdown", { exact: true })).toBeVisible();
  await expect(article.getByText("Safe caption", { exact: true })).toBeVisible();
  await expect(article).toContainText(pasteMarker);
  await expect(article.locator("script, [onerror], [onload], [href^='javascript:' i], [src^='javascript:' i]")).toHaveCount(0);
  await expect(article.getByText("Styled text", { exact: true })).toHaveCSS("color", "rgb(18, 52, 86)");
  await expect(article.locator("[style*='javascript:' i]")).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "__betaStudioXss"))).toBeUndefined();
});
