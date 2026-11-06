import {
  test,
  expect,
  chromium,
  type Page,
  type BrowserContext,
} from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDbPool, closeDbPool } from "@vibress/database";
import { hashPassword } from "@vibress/security";
import { DrizzleUserRepository, UsersService } from "@vibress/users";
import { DrizzleRoleRepository, RolesService } from "@vibress/roles";
import { createDefaultStudioDocument, migrateDocument } from "@vibress/studio-core";

const BASE_URL = "http://localhost:7777";

interface CreatedPostInfo {
  id: string;
  version: number;
  title: string;
}

describeOrTestSuite();

function describeOrTestSuite() {
  let publicationId = "";
  let authorId = "";
  let staffEmail = "";
  let staffPassword = "";
  let apiCookie = "";
  const tempDirs: string[] = [];

  test.describe("CR-03 — Production-Grade Offline Draft Durability (14 Mandatory Real-Browser Scenarios)", () => {
    test.beforeAll(async ({ request }) => {
      const pool = getDbPool();
      const pubRes = await pool.query<{ id: string }>(
        "SELECT id FROM publications WHERE slug = 'default' LIMIT 1",
      );
      expect(pubRes.rows[0]).toBeDefined();
      publicationId = pubRes.rows[0]!.id;

      staffEmail = `cr03-durability-${randomUUID()}@vibress.local`;
      staffPassword = `Cr03Pass-${randomUUID()}!`;

      const user = await new UsersService(new DrizzleUserRepository()).createUser({
        email: staffEmail,
        passwordHash: await hashPassword(staffPassword),
        name: "CR-03 Durability Engineer",
        role: "owner",
        publicationId,
      });
      authorId = user.id;

      const roles = new RolesService(new DrizzleRoleRepository());
      const ownerRole = await roles.findByKey("owner");
      expect(ownerRole).not.toBeNull();
      await roles.assignRoleToUser(authorId, ownerRole!.id);
      await pool.query(
        "INSERT INTO publication_memberships (id, publication_id, user_id, role, created_at) VALUES ($1, $2, $3, 'owner', NOW()) ON CONFLICT DO NOTHING",
        [randomUUID(), publicationId, authorId],
      );

      const loginRes = await request.post(`${BASE_URL}/api/admin/v1/auth/login`, {
        data: { email: staffEmail, password: staffPassword },
        headers: { origin: BASE_URL },
      });
      expect(loginRes.ok()).toBe(true);
      const setCookie = loginRes.headers()["set-cookie"] || "";
      apiCookie = setCookie.split(";")[0] || "";
      expect(apiCookie).toContain("vibress_session=");
    });

    test.afterAll(async () => {
      for (const dir of tempDirs) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup warning
        }
      }
      await closeDbPool();
    });

    async function createFreshPost(
      request: Parameters<Parameters<typeof test>[2]>[0]["request"],
      tag: string,
    ): Promise<CreatedPostInfo> {
      const doc = createDefaultStudioDocument(`[${tag}] Initial Server Paragraph`);
      const res = await request.post(`${BASE_URL}/api/admin/v1/posts`, {
        headers: {
          cookie: apiCookie,
          origin: BASE_URL,
          "x-publication-id": publicationId,
        },
        data: {
          title: `${tag} Server Title`,
          slug: `cr03-${tag.toLowerCase()}-${randomUUID().slice(0, 8)}`,
          content: doc,
          primaryAuthorId: authorId,
          authorIds: [authorId],
        },
      });
      expect(res.status()).toBe(201);
      const json = (await res.json()) as { post: CreatedPostInfo };
      return json.post;
    }

    async function fetchServerPost(
      request: Parameters<Parameters<typeof test>[2]>[0]["request"],
      postId: string,
    ): Promise<{ version: number; title: string; content: unknown }> {
      const res = await request.get(`${BASE_URL}/api/admin/v1/posts/${postId}`, {
        headers: {
          cookie: apiCookie,
          "x-publication-id": publicationId,
        },
      });
      expect(res.ok()).toBe(true);
      const json = (await res.json()) as {
        post: { version: number; title: string; content: unknown };
      };
      return json.post;
    }

    async function loginOnPage(page: Page): Promise<void> {
      await page.goto(`${BASE_URL}/admin`);
      if (page.url().includes("/login")) {
        await page.fill("#email", staffEmail);
        await page.fill("#password", staffPassword);
        await page.click('button[type="submit"]');
        await page.waitForURL(
          (u) => u.pathname.startsWith("/admin") && !u.pathname.includes("/login"),
          { timeout: 15000 },
        );
      } else {
        const emailField = page.locator("#email");
        if (await emailField.isVisible({ timeout: 3000 }).catch(() => false)) {
          await emailField.fill(staffEmail);
          await page.fill("#password", staffPassword);
          await page.click('button[type="submit"]');
          await page.waitForURL(
            (u) => u.pathname.startsWith("/admin") && !u.pathname.includes("/login"),
            { timeout: 15000 },
          );
        }
      }
    }

    async function openPostEditor(page: Page, postId: string): Promise<void> {
      await page.goto(`${BASE_URL}/admin/posts/${postId}`);
      await expect(page.locator('textarea[aria-label="Post Title"]')).toBeVisible({
        timeout: 15000,
      });
      await expect(
        page.locator('div.vibress-studio-editor div[contenteditable="true"]'),
      ).toBeVisible({ timeout: 15000 });
    }

    async function readRawIndexedDbDrafts(page: Page): Promise<
      Array<{
        key: string;
        postId: string;
        title: string;
        updatedAt: number;
        baseVersion: number;
        durability?: string;
      }>
    > {
      return page.evaluate(async () => {
        return new Promise((resolve, reject) => {
          const req = window.indexedDB.open("vibress_drafts", 2);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("drafts")) {
              db.close();
              resolve([]);
              return;
            }
            const tx = db.transaction("drafts", "readonly");
            const store = tx.objectStore("drafts");
            const getAllReq = store.getAll();
            getAllReq.onsuccess = () => {
              const items = getAllReq.result as Array<{
                key: string;
                postId: string;
                title: string;
                updatedAt: number;
                baseVersion: number;
                durability?: string;
              }>;
              db.close();
              resolve(items);
            };
            getAllReq.onerror = () => {
              db.close();
              reject(getAllReq.error);
            };
          };
        });
      });
    }

    // -------------------------------------------------------------------------
    // SCENARIO 1 & 14: Draft saving followed by page reload + status verification
    // -------------------------------------------------------------------------
    test("1 & 14. Saves offline draft durably in real IndexedDB across page reload, surfaces Recovery required, and syncs on recovery", async ({
      browser,
      request,
    }) => {
      const post = await createFreshPost(request, "S1Reload");
      const context: BrowserContext = await browser.newContext();
      const page = await context.newPage();

      await loginOnPage(page);
      await openPostEditor(page, post.id);

      // Disconnect network and edit both title and Lexical body
      await context.setOffline(true);

      const titleInput = page.locator('textarea[aria-label="Post Title"]');
      await titleInput.fill("S1Reload Offline Durable Title");

      const editor = page.locator(
        'div.vibress-studio-editor div[contenteditable="true"]',
      );
      await editor.click();
      await page.keyboard.type(" S1_OFFLINE_BODY_SURVIVOR");

      const durabilityBadge = page.getByTestId("local-durability-status");
      await expect(durabilityBadge).toHaveAttribute("data-durability-mode", "durable");
      await expect(durabilityBadge).toContainText(
        "Recoverable locally · Offline (pending sync)",
      );

      // Inspect real browser IndexedDB directly
      const draftsInIdb = await readRawIndexedDbDrafts(page);
      const matchingDraft = draftsInIdb.find((d) => d.postId === post.id);
      expect(matchingDraft).toBeDefined();
      expect(matchingDraft!.durability).toBe("durable");
      expect(matchingDraft!.title).toBe("S1Reload Offline Durable Title");

      // Re-enable network so page.reload() can load the app from server (server still has v1)
      await context.setOffline(false);
      await page.reload();
      await expect(titleInput).toBeVisible({ timeout: 15000 });

      // Recovery banner + Recovery required badge MUST be displayed
      await expect(page.getByTestId("offline-recovery-banner")).toBeVisible();
      await expect(page.getByTestId("recovery-required-badge")).toContainText(
        "Recovery required",
      );

      // Click Recover draft -> syncs to server & updates title + body
      await page
        .getByTestId("offline-recovery-banner")
        .getByRole("button", { name: "Recover draft" })
        .click();

      await expect(page.getByTestId("editor-save-status")).toContainText(
        "Draft - Saved",
        { timeout: 15000 },
      );
      await expect(titleInput).toHaveValue("S1Reload Offline Durable Title");
      await expect(editor).toContainText("S1_OFFLINE_BODY_SURVIVOR");

      const persisted = await fetchServerPost(request, post.id);
      expect(persisted.title).toBe("S1Reload Offline Durable Title");
      expect(JSON.stringify(migrateDocument(persisted.content))).toContain(
        "S1_OFFLINE_BODY_SURVIVOR",
      );

      await context.close();
    });

    // -------------------------------------------------------------------------
    // SCENARIO 2 & 3: Draft recovery after browser context recreation AND real
    // OS browser process restart (`chromium.launchPersistentContext`)
    // -------------------------------------------------------------------------
    test("2 & 3. Survives real Chromium process termination and relaunch using persistent profile directory on disk", async ({
      request,
    }) => {
      test.setTimeout(90000);
      const post = await createFreshPost(request, "S2S3ProcessRestart");
      const profileDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "vibress-cr03-profile-"),
      );
      tempDirs.push(profileDir);

      // Process #1: Launch real persistent Chromium profile, login, write unsynced local draft
      const persistentCtx1 = await chromium.launchPersistentContext(profileDir, {
        headless: true,
        viewport: { width: 1280, height: 800 },
      });
      const page1 = persistentCtx1.pages()[0] || (await persistentCtx1.newPage());
      await loginOnPage(page1);
      await openPostEditor(page1, post.id);

      // Block server PUT so draft is saved ONLY in real on-disk IndexedDB
      await page1.route(`**/api/admin/v1/posts/${post.id}**`, async (route) => {
        if (route.request().method() === "PUT") {
          await route.abort("failed");
          return;
        }
        await route.continue();
      });

      await page1
        .locator('textarea[aria-label="Post Title"]')
        .fill("Real Process Restart Recovered Title");
      const editor1 = page1.locator(
        'div.vibress-studio-editor div[contenteditable="true"]',
      );
      await editor1.click();
      await page1.keyboard.type(" REAL_PROCESS_RESTART_PARAGRAPH");

      await expect(page1.getByTestId("local-durability-status")).toHaveAttribute(
        "data-durability-mode",
        "durable",
      );

      // Terminate Browser Process #1 completely (flushes LevelDB/IndexedDB to profileDir)
      await persistentCtx1.close();

      // Process #2: Launch a brand-new Chromium OS process pointing to the same profileDir
      const persistentCtx2 = await chromium.launchPersistentContext(profileDir, {
        headless: true,
        viewport: { width: 1280, height: 800 },
      });
      const page2 = persistentCtx2.pages()[0] || (await persistentCtx2.newPage());
      await loginOnPage(page2);
      await openPostEditor(page2, post.id);

      await expect(page2.getByTestId("offline-recovery-banner")).toBeVisible({
        timeout: 15000,
      });
      await expect(page2.getByTestId("recovery-required-badge")).toContainText(
        "Recovery required",
      );

      await page2
        .getByTestId("offline-recovery-banner")
        .getByRole("button", { name: "Recover draft" })
        .click();

      await expect(page2.getByTestId("editor-save-status")).toContainText(
        "Draft - Saved",
        { timeout: 15000 },
      );
      await expect(page2.locator('textarea[aria-label="Post Title"]')).toHaveValue(
        "Real Process Restart Recovered Title",
      );

      const serverAfter = await fetchServerPost(request, post.id);
      expect(serverAfter.title).toBe("Real Process Restart Recovered Title");
      expect(JSON.stringify(migrateDocument(serverAfter.content))).toContain(
        "REAL_PROCESS_RESTART_PARAGRAPH",
      );

      await persistentCtx2.close();
    });

    // -------------------------------------------------------------------------
    // SCENARIO 4: Offline editing followed by reconnection (automatic sync)
    // -------------------------------------------------------------------------
    test("4. Offline editing automatically synchronizes with the server upon network reconnection", async ({
      browser,
      request,
    }) => {
      const post = await createFreshPost(request, "S4Reconnect");
      const context = await browser.newContext();
      const page = await context.newPage();

      await loginOnPage(page);
      await openPostEditor(page, post.id);

      await context.setOffline(true);
      await page
        .locator('textarea[aria-label="Post Title"]')
        .fill("S4 Auto-Synced On Reconnect");
      await page
        .locator('div.vibress-studio-editor div[contenteditable="true"]')
        .click();
      await page.keyboard.type(" S4_AUTO_SYNC_BODY");

      await expect(page.getByTestId("local-durability-status")).toContainText(
        "Recoverable locally · Offline (pending sync)",
      );

      // Restore network -> `online` event triggers automatic server sync!
      await context.setOffline(false);

      await expect(page.getByTestId("editor-save-status")).toContainText(
        "Draft - Saved",
        { timeout: 15000 },
      );

      const serverPost = await fetchServerPost(request, post.id);
      expect(serverPost.title).toBe("S4 Auto-Synced On Reconnect");
      expect(JSON.stringify(migrateDocument(serverPost.content))).toContain(
        "S4_AUTO_SYNC_BODY",
      );

      // IndexedDB checkpoint is cleaned up once synchronized with server
      await expect
        .poll(async () => {
          const items = await readRawIndexedDbDrafts(page);
          return items.filter((d) => d.postId === post.id).length;
        })
        .toBe(0);

      await context.close();
    });

    // -------------------------------------------------------------------------
    // SCENARIO 5 & 13: Browser/editor termination before transaction completion
    // AND recovery after unexpected editor termination (`runBeforeUnload: false`)
    // -------------------------------------------------------------------------
    test("5 & 13. Never claims durable save before tx.oncomplete and recovers committed checkpoint after abrupt tab kill", async ({
      browser,
      request,
    }) => {
      const post = await createFreshPost(request, "S5S13Kill");
      const context = await browser.newContext();
      const page1 = await context.newPage();

      await loginOnPage(page1);
      await openPostEditor(page1, post.id);

      // Block server PUT so autosave stays local
      await context.route(`**/api/admin/v1/posts/${post.id}**`, async (route) => {
        if (route.request().method() === "PUT") {
          await new Promise((r) => setTimeout(r, 10000));
          await route.abort("timedout");
          return;
        }
        await route.continue();
      });

      // Step A (Scenario 13): Commit a durable checkpoint and abruptly terminate tab (`runBeforeUnload: false`)
      await page1
        .locator('textarea[aria-label="Post Title"]')
        .fill("Committed Checkpoint Before Crash");
      await expect(page1.getByTestId("local-durability-status")).toHaveAttribute(
        "data-durability-mode",
        "durable",
      );
      await expect(page1.getByTestId("local-durability-status")).toContainText(
        "Recoverable locally · Pending sync",
      );

      // Step B (Scenario 5): Hold the real IndexedDB readwrite transaction open mid-flight
      // so `tx.oncomplete` has NOT fired yet, verify UI stays `"Unsaved changes"` (`pending`)
      // rather than falsely claiming `"durable"`, and abruptly kill the tab mid-transaction!
      await page1.evaluate(() => {
        const origPut = IDBObjectStore.prototype.put;
        const origGet = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.put = function (...args: Parameters<typeof origPut>) {
          const store = this as IDBObjectStore;
          const req = origPut.apply(store, args);
          // Keep the real IndexedDB readwrite transaction continuously active with
          // chained requests so Chromium cannot commit (`tx.oncomplete`) before abrupt termination
          const keepTxUncommitted = () => {
            try {
              const spinReq = origGet.call(store, "__uncommitted_spin_lock__");
              spinReq.onsuccess = keepTxUncommitted;
            } catch {
              // Page closing or transaction aborted on termination
            }
          };
          keepTxUncommitted();
          return req;
        };
      });

      await page1
        .locator('textarea[aria-label="Post Title"]')
        .fill("Uncommitted Pre-Termination Edit");
      await expect(page1.getByTestId("local-durability-status")).toHaveAttribute(
        "data-durability-mode",
        "pending",
      );
      await expect(page1.getByTestId("local-durability-status")).toContainText(
        "Unsaved changes",
      );

      // Abruptly terminate editor page without unload handlers!
      await page1.close({ runBeforeUnload: false });
      await context.unroute(`**/api/admin/v1/posts/${post.id}**`);

      // Open fresh tab in same browser context -> durable checkpoint #1 is intact & uncorrupted!
      const page2 = await context.newPage();
      await openPostEditor(page2, post.id);

      await expect(page2.getByTestId("offline-recovery-banner")).toBeVisible();
      await page2
        .getByTestId("offline-recovery-banner")
        .getByRole("button", { name: "Recover draft" })
        .click();

      await expect(page2.locator('textarea[aria-label="Post Title"]')).toHaveValue(
        "Committed Checkpoint Before Crash",
      );
      await expect(page2.getByTestId("editor-save-status")).toContainText(
        "Draft - Saved",
        { timeout: 15000 },
      );

      await context.close();
    });

    // -------------------------------------------------------------------------
    // SCENARIO 6: IndexedDB unavailable -> Temporary memory-only protection
    // -------------------------------------------------------------------------
    test("6. Reports 'Temporary memory-only protection' (never 'Saved locally') when IndexedDB is unavailable", async ({
      browser,
      request,
    }) => {
      const post = await createFreshPost(request, "S6NoIdb");
      const context = await browser.newContext();
      const page = await context.newPage();

      await loginOnPage(page);

      // Disable IndexedDB prior to editor navigation (simulating restricted private/webview storage)
      await page.addInitScript(() => {
        Object.defineProperty(window, "indexedDB", {
          configurable: true,
          get() {
            return undefined;
          },
        });
      });

      await context.route(`**/api/admin/v1/posts/${post.id}**`, async (route) => {
        if (route.request().method() === "PUT") {
          await new Promise((r) => setTimeout(r, 8000));
          await route.abort("failed");
          return;
        }
        await route.continue();
      });

      await openPostEditor(page, post.id);
      await page
        .locator('textarea[aria-label="Post Title"]')
        .fill("Volatile Memory Only Draft");

      const badge = page.getByTestId("local-durability-status");
      await expect(badge).toHaveAttribute("data-durability-mode", "memory-only");
      await expect(badge).toContainText("Temporary memory-only protection");
      await expect(badge).not.toContainText("Recoverable locally");
      await expect(badge).not.toContainText("Saved");

      await context.close();
    });

    // -------------------------------------------------------------------------
    // SCENARIO 7: IndexedDB quota exceeded -> Persistence unavailable (quota exceeded)
    // -------------------------------------------------------------------------
    test("7. Surfaces accessible alert 'Persistence unavailable (quota exceeded)' on QuotaExceededError", async ({
      browser,
      request,
    }) => {
      const post = await createFreshPost(request, "S7Quota");
      const context = await browser.newContext();
      const page = await context.newPage();

      await loginOnPage(page);
      await openPostEditor(page, post.id);

      await context.route(`**/api/admin/v1/posts/${post.id}**`, async (route) => {
        if (route.request().method() === "PUT") {
          await new Promise((r) => setTimeout(r, 8000));
          await route.abort("failed");
          return;
        }
        await route.continue();
      });

      await page.evaluate(() => {
        IDBObjectStore.prototype.put = function () {
          throw new DOMException(
            "The quota has been exceeded.",
            "QuotaExceededError",
          );
        };
      });

      await page
        .locator('textarea[aria-label="Post Title"]')
        .fill("Quota Exceeded Draft");

      const badge = page.getByTestId("local-durability-status");
      await expect(badge).toHaveAttribute("data-durability-mode", "quota-exceeded");
      await expect(badge).toHaveAttribute("role", "alert");
      await expect(badge).toContainText("Persistence unavailable (quota exceeded)");
      await expect(badge).not.toContainText("Recoverable locally");
      await expect(badge).not.toContainText("Saved");

      await context.close();
    });

    // -------------------------------------------------------------------------
    // SCENARIO 8: Transaction abort -> Local save failed · Temporary memory-only protection
    // -------------------------------------------------------------------------
    test("8. Handles IDBTransaction.abort() cleanly and warns 'Local save failed · Temporary memory-only protection'", async ({
      browser,
      request,
    }) => {
      const post = await createFreshPost(request, "S8TxAbort");
      const context = await browser.newContext();
      const page = await context.newPage();

      await loginOnPage(page);
      await openPostEditor(page, post.id);

      await context.route(`**/api/admin/v1/posts/${post.id}**`, async (route) => {
        if (route.request().method() === "PUT") {
          await new Promise((r) => setTimeout(r, 8000));
          await route.abort("failed");
          return;
        }
        await route.continue();
      });

      await page.evaluate(() => {
        const origPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args: Parameters<typeof origPut>) {
          const req = origPut.apply(this, args);
          this.transaction.abort();
          return req;
        };
      });

      await page
        .locator('textarea[aria-label="Post Title"]')
        .fill("Aborted Transaction Draft");

      const badge = page.getByTestId("local-durability-status");
      await expect(badge).toHaveAttribute("data-durability-mode", "aborted");
      await expect(badge).toHaveAttribute("role", "alert");
      await expect(badge).toContainText(
        "Local save failed · Temporary memory-only protection",
      );

      await context.close();
    });

    // -------------------------------------------------------------------------
    // SCENARIO 9: Multiple-tab editing (BroadcastChannel coordination & conflict safety)
    // -------------------------------------------------------------------------
    test("9. Coordinates multiple open browser tabs via BroadcastChannel and prevents silent cross-tab overwrite", async ({
      browser,
      request,
    }) => {
      const post = await createFreshPost(request, "S9MultiTab");
      const context = await browser.newContext();
      const tab1 = await context.newPage();
      const tab2 = await context.newPage();

      await loginOnPage(tab1);
      await openPostEditor(tab1, post.id);
      await openPostEditor(tab2, post.id);

      // Hold Tab 2's PUT so Tab 2 has unsaved local edits while Tab 1 saves to the server
      await tab2.route(`**/api/admin/v1/posts/${post.id}**`, async (route) => {
        if (route.request().method() === "PUT") {
          await new Promise((r) => setTimeout(r, 10000));
          await route.abort("failed");
          return;
        }
        await route.continue();
      });

      await tab2
        .locator('textarea[aria-label="Post Title"]')
        .fill("Tab 2 Unsaved Local Title");

      // Tab 1 receives BroadcastChannel notice that another tab is actively editing a local draft!
      await expect(tab1.getByTestId("multi-tab-draft-notice")).toContainText(
        "Another open browser tab is actively editing a local draft",
      );

      // Tab 1 edits and syncs to server (`v1 -> v2`)
      await tab1
        .locator('textarea[aria-label="Post Title"]')
        .fill("Tab 1 Committed Server Title");
      await expect(tab1.getByTestId("editor-save-status")).toContainText(
        "Draft - Saved",
        { timeout: 15000 },
      );

      // Tab 2 immediately transitions to Version conflict (`conflict`) without overwriting Tab 1's server save!
      await expect(tab2.getByTestId("editor-save-status")).toContainText(
        "Version conflict",
      );
      await expect(tab2.locator('textarea[aria-label="Post Title"]')).toHaveValue(
        "Tab 2 Unsaved Local Title",
      );

      const serverPost = await fetchServerPost(request, post.id);
      expect(serverPost.title).toBe("Tab 1 Committed Server Title");

      await context.close();
    });

    // -------------------------------------------------------------------------
    // SCENARIO 10: Local/server version conflicts on recovery
    // -------------------------------------------------------------------------
    test("10. Detects server-ahead version conflict on offline draft recovery and never silently overwrites newer server content", async ({
      browser,
      request,
    }) => {
      const post = await createFreshPost(request, "S10Conflict");
      const context = await browser.newContext();
      const page = await context.newPage();

      await loginOnPage(page);
      await openPostEditor(page, post.id);

      // Create offline draft based on v1
      await context.setOffline(true);
      await page
        .locator('textarea[aria-label="Post Title"]')
        .fill("Stale Base v1 Offline Title");
      await expect(page.getByTestId("local-durability-status")).toHaveAttribute(
        "data-durability-mode",
        "durable",
      );

      // Meanwhile, another author updates the server post to v2!
      const v2Doc = createDefaultStudioDocument("Newer Server V2 Authoritative Text");
      const updateRes = await request.put(
        `${BASE_URL}/api/admin/v1/posts/${post.id}`,
        {
          headers: {
            cookie: apiCookie,
            origin: BASE_URL,
            "x-publication-id": publicationId,
          },
          data: {
            title: "Server V2 Authoritative Title",
            content: v2Doc,
            expectedVersion: post.version,
          },
        },
      );
      expect(updateRes.ok()).toBe(true);

      // Reconnect & reload editor -> server loads v2 AND warns that local draft base (v1) < server (v2)
      await context.setOffline(false);
      await page.reload();
      await expect(page.locator('textarea[aria-label="Post Title"]')).toHaveValue(
        "Server V2 Authoritative Title",
      );
      await expect(page.getByTestId("offline-recovery-banner")).toBeVisible();
      await expect(page.getByTestId("recovery-version-conflict")).toContainText(
        "Server version (v2) is newer than this offline draft's base (v1)",
      );

      // Author chooses "Keep server version" -> server v2 is preserved and stale local draft is purged
      await page
        .getByTestId("offline-recovery-banner")
        .getByRole("button", { name: "Keep server version" })
        .click();
      await expect(page.getByTestId("offline-recovery-banner")).toBeHidden();

      const draftsRemaining = await readRawIndexedDbDrafts(page);
      expect(draftsRemaining.filter((d) => d.postId === post.id)).toHaveLength(0);

      await context.close();
    });

    // -------------------------------------------------------------------------
    // SCENARIO 11: Temporary network failure + manual Retry
    // -------------------------------------------------------------------------
    test("11. Handles temporary network failure with 'Save failed' + 'Saved locally · Pending sync' and recovers on Retry", async ({
      browser,
      request,
    }) => {
      const post = await createFreshPost(request, "S11NetFail");
      const context = await browser.newContext();
      const page = await context.newPage();

      await loginOnPage(page);
      await openPostEditor(page, post.id);

      let failPut = true;
      await page.route(`**/api/admin/v1/posts/${post.id}**`, async (route) => {
        if (failPut && route.request().method() === "PUT") {
          await route.abort("failed");
          return;
        }
        await route.continue();
      });

      await page
        .locator('textarea[aria-label="Post Title"]')
        .fill("S11 Transient Network Failure Title");

      const status = page.getByTestId("editor-save-status");
      await expect(status).toContainText("Save failed", { timeout: 10000 });
      await expect(page.getByTestId("local-durability-status")).toContainText(
        "Recoverable locally · Pending sync",
      );

      // Heal network fault and click Retry
      failPut = false;
      await page.getByTestId("retry-autosave-btn").click();

      await expect(status).toContainText("Draft - Saved", { timeout: 15000 });
      const serverPost = await fetchServerPost(request, post.id);
      expect(serverPost.title).toBe("S11 Transient Network Failure Title");

      await context.close();
    });

    // -------------------------------------------------------------------------
    // SCENARIO 12: Repeated rapid autosave operations (monotonicity & completeness)
    // -------------------------------------------------------------------------
    test("12. Preserves monotonic updatedAt and complete final content across repeated rapid autosave bursts", async ({
      browser,
      request,
    }) => {
      const post = await createFreshPost(request, "S12Rapid");
      const context = await browser.newContext();
      const page = await context.newPage();

      await loginOnPage(page);
      await openPostEditor(page, post.id);

      await context.setOffline(true);
      const titleInput = page.locator('textarea[aria-label="Post Title"]');
      const observedTimestamps: number[] = [];

      for (let i = 1; i <= 12; i++) {
        await titleInput.fill(`S12 Rapid Burst Iteration #${i}`);
        const drafts = await readRawIndexedDbDrafts(page);
        const rec = drafts.find((d) => d.postId === post.id);
        if (rec) {
          observedTimestamps.push(rec.updatedAt);
        }
      }

      expect(observedTimestamps.length).toBeGreaterThan(0);
      for (let i = 1; i < observedTimestamps.length; i++) {
        expect(observedTimestamps[i]!).toBeGreaterThanOrEqual(
          observedTimestamps[i - 1]!,
        );
      }

      const finalDrafts = await readRawIndexedDbDrafts(page);
      const finalRec = finalDrafts.find((d) => d.postId === post.id);
      expect(finalRec).toBeDefined();
      expect(finalRec!.title).toBe("S12 Rapid Burst Iteration #12");

      // Reconnect and verify final burst syncs cleanly
      await context.setOffline(false);
      await expect(page.getByTestId("editor-save-status")).toContainText(
        "Draft - Saved",
        { timeout: 15000 },
      );
      const serverPost = await fetchServerPost(request, post.id);
      expect(serverPost.title).toBe("S12 Rapid Burst Iteration #12");

      await context.close();
    });
  });
}
