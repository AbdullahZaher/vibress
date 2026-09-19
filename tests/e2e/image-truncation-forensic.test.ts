import { test, expect } from "@playwright/test";
import { seedFixturePost } from "@vibress/database";

test.describe("Vibress Studio Image Truncation Forensic E2E", () => {
  test("Reproduce and trace real image insertion flow on 2000+ word article", async ({ page }) => {
    await seedFixturePost();
    const logs: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("[FORENSIC]") || text.includes("Studio") || text.includes("Autosave") || text.includes("error")) {
        logs.push(text);
        console.log("BROWSER LOG:", text);
      }
    });
    page.on("response", async (res) => {
      if (res.url().includes("/posts/bb46491c")) {
        try {
          const body = await res.json();
          console.log("FETCH POST RESPONSE:", res.status(), body?.post ? {
            id: body.post.id,
            version: body.post.version,
            contentChildren: body.post.content?.root?.children?.length,
          } : body);
        } catch {}
      }
    });

    test.setTimeout(60000);

    await page.setViewportSize({ width: 1280, height: 900 });

    // 1. Visit /admin while logged out
    await page.goto("http://localhost:7777/admin");

    // If retry button appears (transient API preflight error), click Retry
    const retryBtn = page.locator('button:has-text("Retry")');
    if (await retryBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await retryBtn.click();
    }

    // Should redirect to /admin/login
    await page.waitForURL("**/admin/login**", { timeout: 15000 });
    await expect(page.locator("h1")).toContainText("Vibress");

    // Fill login form
    await page.fill("#email", "owner@example.com");
    await page.fill("#password", "OwnerPass123!");
    await page.click('button[type="submit"]');

    await page.waitForURL((url) => url.pathname === "/admin" || (url.pathname.startsWith("/admin") && !url.pathname.includes("/login")), { timeout: 15000 });


    // 2. Navigate to target post
    const targetPostId = "bb46491c-dd25-492c-a035-89745ceffd6c";
    await page.goto(`http://localhost:7777/admin/posts/${targetPostId}`);

    // Wait for post to load
    await page.waitForSelector('textarea[aria-label="Post Title"]', { timeout: 10000 });
    const title = await page.locator('textarea[aria-label="Post Title"]').inputValue();
    console.log("Post Title Loaded:", title);

    // Wait for studio content to be populated
    const editorArea = page.locator('div.vibress-studio-editor div[contenteditable="true"]');
    await expect(editorArea).toBeVisible();

    // Check baseline word count in UI
    const wordCountIndicator = page.locator('header, div').filter({ hasText: /words/i }).first();
    console.log("Header text:", await page.locator("header").last().innerText());

    // Evaluate content in DOM
    const initialParagraphs = await editorArea.locator("p, figure, h1, h2, h3, blockquote, ul, ol").count();
    console.log("Initial root DOM children count in editor:", initialParagraphs);
    expect(initialParagraphs).toBeGreaterThan(40);

    // Get initial plain text
    const initialText = await editorArea.innerText();
    const initialWords = initialText.split(/\s+/).filter(Boolean).length;
    console.log("Initial DOM word count in editor:", initialWords);
    expect(initialWords).toBeGreaterThan(1500);

    // 3. Place cursor inside the first paragraph (or at end of first paragraph)
    const firstP = editorArea.locator("p").first();
    await firstP.click();
    console.log("Clicked first paragraph");

    // Move to end of first paragraph and press Enter
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    console.log("Pressed Enter to create newline");

    // Type /image with realistic keystroke delay so Typeahead trigger fires
    await page.keyboard.type("/image", { delay: 60 });
    console.log("Typed /image with delay");

    // Wait for slash menu option and click it directly
    const imageOption = page.locator('li:has-text("Image")').first();
    await expect(imageOption).toBeVisible({ timeout: 8000 });
    console.log("Slash menu Image option visible, clicking...");
    await imageOption.click();

    // 4. MediaPicker modal should appear
    await page.waitForSelector('h3:has-text("Select Media Asset")', { timeout: 8000 });
    console.log("MediaPicker modal opened!");

    // Check if assets are available in picker
    const assetItem = page.locator('[data-testid="media-picker-item"]').first();
    await assetItem.waitFor({ state: "visible", timeout: 8000 });
    console.log("MediaPicker item found, clicking...");
    await assetItem.click();

    // Wait for MediaPicker modal to close
    await page.waitForSelector('h3:has-text("Select Media Asset")', { state: "detached", timeout: 8000 });
    console.log("MediaPicker modal closed, asset selected!");

    // Wait for "Saved" indicator in header (autosave debounce is 2000ms)
    console.log("Waiting for 'Saved' status in header...");
    await expect(page.locator("header").filter({ hasText: "Saved" })).toBeVisible({ timeout: 12000 });
    console.log("Post status shows 'Saved'!");

    // Check autosave state in UI
    const headerTextAfter = await page.locator("header").last().innerText();
    console.log("Header text after autosave:", headerTextAfter);

    // Check DOM children count in editor after insertion and autosave
    const paragraphsAfter = await editorArea.locator("p, figure, h1, h2, h3, blockquote, ul, ol").count();
    const textAfter = await editorArea.innerText();
    const wordsAfter = textAfter.split(/\s+/).filter(Boolean).length;
    console.log("DOM children count in editor AFTER autosave:", paragraphsAfter);
    console.log("DOM word count in editor AFTER autosave:", wordsAfter);

    // CRITICAL ASSERTION 1: Word retention >= 99% after image insertion and autosave
    expect(wordsAfter).toBeGreaterThanOrEqual(Math.floor(initialWords * 0.99));
    expect(paragraphsAfter).toBeGreaterThanOrEqual(initialParagraphs);

    // 5. Reload page to test hydration
    console.log("Reloading page to test hydration...");
    await page.reload();
    await page.waitForSelector('textarea[aria-label="Post Title"]', { timeout: 10000 });
    await expect(editorArea).toBeVisible();
    await page.waitForTimeout(2000);

    const paragraphsAfterReload = await editorArea.locator("p, figure, h1, h2, h3, blockquote, ul, ol").count();
    const textAfterReload = await editorArea.innerText();
    const wordsAfterReload = textAfterReload.split(/\s+/).filter(Boolean).length;
    console.log("DOM children count in editor AFTER reload:", paragraphsAfterReload);
    console.log("DOM word count in editor AFTER reload:", wordsAfterReload);

    // CRITICAL ASSERTION 2: Word retention >= 99% after reload & hydration
    expect(wordsAfterReload).toBeGreaterThanOrEqual(Math.floor(initialWords * 0.99));
    expect(paragraphsAfterReload).toBeGreaterThanOrEqual(initialParagraphs);

    // 6. Verify Persisted API Content
    console.log("Fetching persisted post directly from API...");
    const apiRes = await page.request.get(`http://localhost:7777/api/admin/v1/posts/${targetPostId}`);
    expect(apiRes.status()).toBe(200);
    const apiJson = await apiRes.json();
    const persistedChildren = apiJson.post?.content?.root?.children || [];
    console.log("Persisted API root children count:", persistedChildren.length);
    expect(persistedChildren.length).toBeGreaterThanOrEqual(initialParagraphs);

    // Check card presence in persisted AST recursively
    function searchForCard(node: any): boolean {
      if (!node || typeof node !== "object") return false;
      if (
        node.type === "studio-card" ||
        node.type === "react-studio-card" ||
        node.cardType === "image"
      ) {
        return true;
      }
      if (Array.isArray(node.children)) {
        return node.children.some(searchForCard);
      }
      return false;
    }
    const hasCard = searchForCard(apiJson.post?.content?.root);
    console.log("Persisted API contains inserted image card:", hasCard);
    expect(hasCard).toBe(true);

    // Summary of logs
    console.log("Total forensic logs captured:", logs.length);
    console.log("ALL FORENSIC ASSERTIONS PASSED: No content loss detected (>= 99% words preserved across all boundaries).");
  });
});
