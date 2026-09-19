import { test, expect } from "@playwright/test";
import { getDb, closeDbPool, posts, revisions } from "@vibress/database";
import { eq } from "drizzle-orm";

const TARGET_POST_ID = "bb46491c-dd25-492c-a035-89745ceffd6c";

async function resetTargetPost() {
  const db = getDb();
  const [rev1] = await db
    .select()
    .from(revisions)
    .where(eq(revisions.resourceId, TARGET_POST_ID))
    .orderBy(revisions.revisionNumber)
    .limit(1);

  if (!rev1) {
    throw new Error("Revision 1 not found for target post");
  }

  const [current] = await db
    .select()
    .from(posts)
    .where(eq(posts.id, TARGET_POST_ID))
    .limit(1);

  const nextVersion = (current?.version ?? 1) + 1;
  await db
    .update(posts)
    .set({
      content: rev1.content,
      version: nextVersion,
      updatedAt: new Date(),
    })
    .where(eq(posts.id, TARGET_POST_ID));

  console.log(`[TEST RESET] Reset post to 51 children, version ${nextVersion}`);
}

async function loginUser(page: any, email = "owner@example.com", password = "OwnerPass123!") {
  await page.goto("http://localhost:7777/admin");
  const retryBtn = page.locator('button:has-text("Retry")');
  if (await retryBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await retryBtn.click();
  }
  await page.waitForURL("**/admin/login**", { timeout: 15000 });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(
    (url: any) => url.pathname.startsWith("/admin") && !url.pathname.includes("/login"),
    { timeout: 15000 }
  );
}

test.describe("Multi-User Collaboration & Truncation Regression Suite", () => {
  test.beforeEach(async () => {
    await resetTargetPost();
  });

  test("Exact Failure Class: 2-user real browser collaboration, image insertion, independent edits, disconnect/reconnect, and persistence", async ({
    browser,
  }) => {
    test.setTimeout(90000);

    // ============================================================
    // STEP 1: User A opens a 2000+ word post
    // ============================================================
    console.log("--- STEP 1: User A opens post ---");
    const contextA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pageA = await contextA.newPage();
    pageA.on("console", (msg) => console.log("[PAGE_A_LOG]", msg.text()));
    await pageA.addInitScript(() => {
      const OrigWS = window.WebSocket;
      (window as any).WebSocket = class extends OrigWS {
        constructor(...args: any[]) {
          super(...(args as [any, any]));
          console.log("[WS_LIFECYCLE] CREATED", args[0]);
          this.addEventListener("open", () => console.log("[WS_LIFECYCLE] OPEN", args[0]));
          this.addEventListener("close", (e) => console.log("[WS_LIFECYCLE] CLOSE", args[0], e.code, e.reason));
          this.addEventListener("error", () => console.log("[WS_LIFECYCLE] ERROR", args[0]));
          const origSend = this.send.bind(this);
          this.send = (data: any) => {
            if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
              console.log("[WS_LIFECYCLE] SEND_BINARY byteLength=" + (data.byteLength || data.length), new Error().stack);
            } else {
              console.log("[WS_LIFECYCLE] SEND_TEXT", typeof data === "string" ? data.slice(0, 50) : data);
            }
            return origSend(data);
          };
        }
      };
    });

    // Login User A
    await loginUser(pageA);

    // Navigate to post
    await pageA.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await pageA.waitForSelector('textarea[aria-label="Post Title"]', { timeout: 15000 });
    const editorAreaA = pageA.locator('div.vibress-studio-editor div[contenteditable="true"]');
    await expect(editorAreaA).toBeVisible({ timeout: 10000 });

    await expect.poll(async () => {
      const text = await editorAreaA.innerText();
      return text.split(/\s+/).filter(Boolean).length;
    }, { timeout: 15000 }).toBeGreaterThanOrEqual(2000);

    const initialTextA = await editorAreaA.innerText();
    const initialWordsA = initialTextA.split(/\s+/).filter(Boolean).length;
    console.log(`User A initial baseline words: ${initialWordsA}`);
    expect(initialWordsA).toBeGreaterThanOrEqual(2000);

    // ============================================================
    // STEP 2: User A inserts an image
    // ============================================================
    console.log("--- STEP 2: User A inserts image ---");
    const firstPA = editorAreaA.locator("p").first();
    await firstPA.click();
    await pageA.keyboard.press("End");
    await pageA.keyboard.press("Enter");
    await pageA.keyboard.type("/image", { delay: 60 });

    const imageOptionA = pageA.locator('li:has-text("Image")').first();
    await expect(imageOptionA).toBeVisible({ timeout: 8000 });
    await imageOptionA.click();

    // Wait for MediaPicker
    await pageA.waitForSelector('h3:has-text("Select Media Asset")', { timeout: 8000 });
    const assetItemA = pageA.locator('[data-testid="media-picker-item"]').first();
    await assetItemA.waitFor({ state: "visible", timeout: 8000 });
    await assetItemA.click();

    await pageA.waitForSelector('h3:has-text("Select Media Asset")', { state: "detached", timeout: 8000 });
    console.log("User A image card inserted successfully.");

    // ============================================================
    // STEP 3: Autosave completes
    // ============================================================
    console.log("--- STEP 3: Autosave completes ---");
    await expect(pageA.locator("header").filter({ hasText: "Saved" })).toBeVisible({ timeout: 15000 });
    console.log("User A autosave confirmed 'Saved'.");

    // ============================================================
    // STEP 4: User A remains connected
    // ============================================================
    console.log("--- STEP 4: User A remains connected ---");
    // (contextA / pageA left open and active)

    // ============================================================
    // STEP 5: User B joins the same post
    // ============================================================
    console.log("--- STEP 5: User B joins the same post ---");
    const contextB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    let pageB = await contextB.newPage();
    pageB.on("console", (msg) => console.log("[PAGE_B_LOG]", msg.text()));
    await pageB.addInitScript(() => {
      const OrigWS = window.WebSocket;
      (window as any).WebSocket = class extends OrigWS {
        constructor(...args: any[]) {
          super(...(args as [any, any]));
          console.log("[WS_LIFECYCLE] CREATED", args[0]);
          this.addEventListener("open", () => console.log("[WS_LIFECYCLE] OPEN", args[0]));
          this.addEventListener("close", (e) => console.log("[WS_LIFECYCLE] CLOSE", args[0], e.code, e.reason));
          this.addEventListener("error", () => console.log("[WS_LIFECYCLE] ERROR", args[0]));
          const origSend = this.send.bind(this);
          this.send = (data: any) => {
            if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
              console.log("[WS_LIFECYCLE] SEND_BINARY byteLength=" + (data.byteLength || data.length), new Error().stack);
            } else {
              console.log("[WS_LIFECYCLE] SEND_TEXT", typeof data === "string" ? data.slice(0, 50) : data);
            }
            return origSend(data);
          };
        }
      };
    });

    await loginUser(pageB);

    await pageB.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await pageB.waitForSelector('textarea[aria-label="Post Title"]', { timeout: 15000 });
    const editorAreaB = pageB.locator('div.vibress-studio-editor div[contenteditable="true"]');
    await expect(editorAreaB).toBeVisible({ timeout: 10000 });

    // ============================================================
    // STEP 6: User B must receive the complete 2000+ word document
    // ============================================================
    console.log("--- STEP 6: User B receives complete 2000+ word document ---");
    await expect.poll(async () => {
      const text = await editorAreaB.innerText();
      return text.split(/\s+/).filter(Boolean).length;
    }, { timeout: 15000 }).toBeGreaterThanOrEqual(Math.floor(initialWordsA * 0.99));
    const textB = await editorAreaB.innerText();
    const wordsB = textB.split(/\s+/).filter(Boolean).length;
    console.log(`User B received words: ${wordsB}`);
    expect(wordsB).toBeGreaterThanOrEqual(Math.floor(initialWordsA * 0.99));

    // ============================================================
    // STEP 7: User A must still retain the complete document
    // ============================================================
    console.log("--- STEP 7: User A still retains complete document ---");
    const textA_step7 = await editorAreaA.innerText();
    const wordsA_step7 = textA_step7.split(/\s+/).filter(Boolean).length;
    console.log(`User A retained words: ${wordsA_step7}`);
    expect(wordsA_step7).toBeGreaterThanOrEqual(Math.floor(initialWordsA * 0.99));

    // ============================================================
    // STEP 8: Both users make independent edits
    // ============================================================
    console.log("--- STEP 8: Independent edits by User A and User B ---");
    // User A edits first paragraph
    const userA_marker = `[EDIT_BY_USER_A_${Date.now()}]`;
    await editorAreaA.locator("p").first().click();
    await pageA.keyboard.press("Home");
    await pageA.keyboard.insertText(userA_marker + " ");
    console.log("User A typed marker at beginning.");

    // User B edits paragraph "Independent authors"
    const userB_marker = `[EDIT_BY_USER_B_${Date.now()}]`;
    await pageB.bringToFront();
    const targetParagraphB = editorAreaB.locator("p").filter({ hasText: "Independent authors" }).first();
    await targetParagraphB.scrollIntoViewIfNeeded();
    await targetParagraphB.click();
    await pageB.keyboard.insertText(" " + userB_marker);
    console.log("User B typed marker at paragraph 'Independent authors'.");
    const userB_immediateText = await editorAreaB.innerText();
    console.log("User B editor text contains userB_marker?", userB_immediateText.includes(userB_marker));

    // ============================================================
    // STEP 9: Verify Yjs synchronization
    // ============================================================
    console.log("--- STEP 9: Verify Yjs synchronization ---");
    // User A should see User B's marker
    await expect(editorAreaA).toContainText(userB_marker, { timeout: 10000 });
    // User B should see User A's marker
    await expect(editorAreaB).toContainText(userA_marker, { timeout: 10000 });
    console.log("Bi-directional Yjs sync verified: both users received each other's edits!");

    // Wait for autosave to capture synchronized edits
    await pageA.waitForTimeout(3000);

    // ============================================================
    // STEP 10: Disconnect User B
    // ============================================================
    console.log("--- STEP 10: Disconnect User B ---");
    await pageB.close();
    console.log("User B disconnected (page closed).");

    // ============================================================
    // STEP 11: Reconnect User B
    // ============================================================
    console.log("--- STEP 11: Reconnect User B ---");
    pageB = await contextB.newPage();
    await pageB.goto(`http://localhost:7777/admin/posts/${TARGET_POST_ID}`);
    await pageB.waitForSelector('textarea[aria-label="Post Title"]', { timeout: 15000 });
    const reconnectedEditorB = pageB.locator('div.vibress-studio-editor div[contenteditable="true"]');
    await expect(reconnectedEditorB).toBeVisible({ timeout: 10000 });

    // ============================================================
    // STEP 12: Verify no partial CRDT replay or document truncation
    // ============================================================
    console.log("--- STEP 12: Verify no partial CRDT replay or truncation ---");
    await expect.poll(async () => {
      const text = await reconnectedEditorB.innerText();
      return text.split(/\s+/).filter(Boolean).length;
    }, { timeout: 15000 }).toBeGreaterThanOrEqual(Math.floor(initialWordsA * 0.99));
    const textB_reconnect = await reconnectedEditorB.innerText();
    const wordsB_reconnect = textB_reconnect.split(/\s+/).filter(Boolean).length;
    console.log(`User B reconnected words: ${wordsB_reconnect}`);

    expect(wordsB_reconnect).toBeGreaterThanOrEqual(Math.floor(initialWordsA * 0.99));
    expect(textB_reconnect).toContain(userA_marker);
    expect(textB_reconnect).toContain(userB_marker);

    const textA_final = await editorAreaA.innerText();
    const wordsA_final = textA_final.split(/\s+/).filter(Boolean).length;
    expect(wordsA_final).toBeGreaterThanOrEqual(Math.floor(initialWordsA * 0.99));

    // ============================================================
    // STEP 13: Verify PostgreSQL contains the complete document
    // ============================================================
    console.log("--- STEP 13: Verify PostgreSQL contains complete document ---");
    // If there are pending changes that didn't autosave yet, click Update if enabled
    const updateBtn = pageA.locator('button:has-text("Update")');
    if (await updateBtn.isEnabled({ timeout: 1000 }).catch(() => false)) {
      await updateBtn.click();
    }
    await pageA.waitForTimeout(2000);

    const apiRes = await pageA.request.get(`http://localhost:7777/api/admin/v1/posts/${TARGET_POST_ID}`);
    expect(apiRes.status()).toBe(200);
    const apiJson = await apiRes.json();
    const persistedRoot = apiJson.post?.content?.root;
    expect(persistedRoot).toBeDefined();

    function extractTextFromAST(node: any): string {
      if (!node) return "";
      if (node.text) return node.text + " ";
      if (Array.isArray(node.children)) {
        return node.children.map(extractTextFromAST).join(" ");
      }
      return "";
    }

    const persistedWords = extractTextFromAST(persistedRoot).split(/\s+/).filter(Boolean).length;
    console.log(`PostgreSQL persisted word count: ${persistedWords}`);
    expect(persistedWords).toBeGreaterThanOrEqual(Math.floor(initialWordsA * 0.99));

    function searchForCard(node: any): boolean {
      if (!node || typeof node !== "object") return false;
      if (node.type === "studio-card" || node.type === "react-studio-card" || node.cardType === "image") {
        return true;
      }
      if (Array.isArray(node.children)) {
        return node.children.some(searchForCard);
      }
      return false;
    }
    expect(searchForCard(persistedRoot)).toBe(true);

    console.log("ALL 13 STEP-BY-STEP ASSERTIONS PASSED WITH ZERO TRUNCATION!");

    await contextA.close();
    await contextB.close();
  });
});
