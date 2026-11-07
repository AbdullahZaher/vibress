/**
 * Phase 07 Independent Verification Harness:
 * 1. Host WCAG 2.2 AA Automated axe-core Audit (LTR, Arabic RTL, Slash Menu, Recovery UI, Mobile 390x844)
 * 2. Arabic / Bidi / Punctuation / List / Table / Code-Block Isolation Verification
 * 3. Laboratory Performance & Event-Timing (INP methodology), Long-Task, Heap, & 2-Peer Yjs Latency
 * 4. Live Local Ghost (http://localhost:2368) Empirical Task-Equivalent Benchmark
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const VIBRESS_URL = "http://localhost:7777";
const GHOST_URL = "http://localhost:2368";
const AXE_SOURCE = fs.readFileSync(
  path.resolve("/Users/abdullahzaher/vibress/node_modules/axe-core/axe.min.js"),
  "utf8",
);

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Number(sorted[Math.max(0, idx)].toFixed(2));
}

function summarizeMs(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    minMs: sorted.length ? Number(sorted[0].toFixed(2)) : 0,
    p50Ms: percentile(sorted, 50),
    p75Ms: percentile(sorted, 75),
    p95Ms: percentile(sorted, 95),
    maxMs: sorted.length ? Number(sorted[sorted.length - 1].toFixed(2)) : 0,
  };
}

function buildWordParagraphs(targetWords) {
  const sentence =
    "Editorial publishing demands deterministic persistence, responsive typography, accessible controls, and resilient synchronization across collaborative sessions.";
  const wordsPerPara = 68;
  const count = Math.ceil(targetWords / wordsPerPara);
  const children = [];
  for (let i = 0; i < count; i++) {
    children.push({
      type: "paragraph",
      version: 1,
      direction: "ltr",
      format: "",
      indent: 0,
      children: [
        {
          type: "text",
          version: 1,
          detail: 0,
          format: 0,
          mode: "normal",
          style: "",
          text: `Section ${i + 1}. ${sentence} ${sentence} ${sentence} ${sentence}`,
        },
      ],
    });
  }
  return {
    schema: "vibress-studio",
    version: 1,
    editor: { lexicalVersion: "0.13.1" },
    root: {
      type: "root",
      version: 1,
      direction: "ltr",
      format: "",
      indent: 0,
      children,
    },
  };
}

async function runAxe(page, label) {
  await page.addScriptTag({ content: AXE_SOURCE });
  const results = await page.evaluate(async () => {
    // @ts-expect-error axe injected globally
    return await window.axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    });
  });
  return {
    surface: label,
    passesCount: results.passes.length,
    incompleteCount: results.incomplete.length,
    violationsCount: results.violations.length,
    violations: results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      nodes: v.nodes.length,
      targets: v.nodes.slice(0, 3).map((n) => n.target),
    })),
  };
}

async function main() {
  const report = {
    generatedAtUtc: new Date().toISOString(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      measurementClass: "Controlled Chromium Laboratory Benchmark (NOT Real-User Field RUM)",
    },
    accessibility: [],
    arabicRtl: {},
    performance: {},
    ghostComparison: {},
  };

  const browser = await chromium.launch({ headless: true });

  try {
    // Authenticate via API once to create clean benchmark posts
    const authCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await authCtx.newPage();

    await page.goto(`${VIBRESS_URL}/admin/login`);
    await page.fill("#email", "owner@example.com");
    await page.fill("#password", "OwnerPass123!");
    await page.click('button[type="submit"]');
    await page.waitForURL(
      (u) => u.pathname.startsWith("/admin") && !u.pathname.includes("/login"),
      { timeout: 15000 },
    );

    const meRes = await authCtx.request.get(`${VIBRESS_URL}/api/admin/v1/auth/me`, {
      headers: { Origin: VIBRESS_URL },
    });
    const meJson = await meRes.json();
    const authorId = meJson.user.id;

    // Create 1,000-word and 5,000-word posts
    const createPost = async (title, content) => {
      const res = await authCtx.request.post(`${VIBRESS_URL}/api/admin/v1/posts`, {
        headers: { "Content-Type": "application/json", Origin: VIBRESS_URL },
        data: {
          title,
          slug: `bench-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          primaryAuthorId: authorId,
          content,
        },
      });
      return (await res.json()).post;
    };

    const post1k = await createPost("Phase07 Benchmark 1k Words", buildWordParagraphs(1000));
    const post5k = await createPost("Phase07 Benchmark 5k Words", buildWordParagraphs(5000));

    // -------------------------------------------------------------------------
    // 1. Cold Editor Initialization + WCAG 2.2 AA Axe Scan (LTR + Slash Menu)
    // -------------------------------------------------------------------------
    const initSamples = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await page.goto(`${VIBRESS_URL}/admin/posts/${post1k.id}`);
      await page
        .locator('div.vibress-studio-editor div[contenteditable="true"]')
        .waitFor({ state: "visible", timeout: 15000 });
      initSamples.push(performance.now() - t0);
    }
    report.performance.editorInitialization1kWords = summarizeMs(initSamples);

    // Axe scan 1: Default LTR Editor
    report.accessibility.push(await runAxe(page, "Host PostEditor (Desktop 1440x900 LTR)"));

    // Open Slash Menu and scan
    const editorLoc = page.locator('div.vibress-studio-editor div[contenteditable="true"]');
    await editorLoc.click();
    await page.keyboard.press("Enter");
    await page.keyboard.type("/");
    await page.locator(".notion-slash-menu").waitFor({ state: "visible", timeout: 5000 });
    report.accessibility.push(await runAxe(page, "Host PostEditor + Slash Menu Open"));

    // Verify slash menu item touch-target height >= 36px
    const slashTargetHeights = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.notion-slash-menu [role="option"]')).map(
        (el) => Math.round(el.getBoundingClientRect().height),
      );
    });
    const minSlashTargetPx = Math.min(...slashTargetHeights);

    // Type non-matching query to verify accessible empty state
    await page.keyboard.type("zzzznonexistent");
    const emptyStatusVisible = await page
      .locator('.notion-slash-menu [role="status"][aria-live="polite"]')
      .isVisible();
    report.accessibility.push(await runAxe(page, "Host PostEditor + Slash Menu Empty Status"));
    for (let i = 0; i < 16; i++) await page.keyboard.press("Backspace");

    // -------------------------------------------------------------------------
    // 2. Arabic RTL, Mixed Script, Bilingual Slash Search, & Mobile 390x844
    // -------------------------------------------------------------------------
    const rtlPost = await createPost("مقالة اختبار العربية واتجاه النص", {
      schema: "vibress-studio",
      version: 1,
      editor: { lexicalVersion: "0.13.1" },
      root: {
        type: "root",
        version: 1,
        direction: "rtl",
        format: "",
        indent: 0,
        children: [
          {
            type: "paragraph",
            version: 1,
            direction: "rtl",
            format: "",
            indent: 0,
            children: [
              {
                type: "text",
                version: 1,
                detail: 0,
                format: 0,
                mode: "normal",
                style: "",
                text: "تُعدّ منصة فايبرس (Vibress Studio v1.2) بيئة تحرير احترافية تدعم العربية والإنجليزية بسلاسة، وعلامات الترقيم مثل: الفاصلة (،) والمنقوطة (؛) وعلامة الاستفهام (؟).",
              },
            ],
          },
        ],
      },
    });

    await page.goto(`${VIBRESS_URL}/admin/posts/${rtlPost.id}`);
    await editorLoc.waitFor({ state: "visible", timeout: 15000 });
    await editorLoc.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");

    // Test Arabic slash keyword `/جدول` -> inserts Table!
    await page.keyboard.type("/جدول");
    await page.locator('.notion-slash-menu [role="option"]').first().waitFor({ state: "visible" });
    const arabicTableMatched = await page
      .locator('.notion-slash-menu [role="option"]')
      .filter({ hasText: "Table" })
      .isVisible();
    await page.keyboard.press("Enter");

    // Insert Code block via `/كود` and verify LTR bidi isolation
    await editorLoc.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/كود");
    const arabicCodeMatched = await page
      .locator('.notion-slash-menu [role="option"]')
      .filter({ hasText: "Code Block" })
      .isVisible();
    await page.keyboard.press("Enter");
    await page.keyboard.type("const total = items.length;");

    const rtlDiagnostics = await page.evaluate(() => {
      const codeEl = document.querySelector(".vibress-studio-editor code, .vibress-studio-editor pre");
      const codeStyle = codeEl ? window.getComputedStyle(codeEl) : null;
      const firstPara = document.querySelector(".vibress-studio-editor p");
      return {
        firstParaDir: firstPara?.getAttribute("dir") || window.getComputedStyle(firstPara).direction,
        hasTable: Boolean(document.querySelector(".vibress-studio-editor table")),
        codeDirection: codeStyle?.direction || null,
      };
    });

    report.accessibility.push(await runAxe(page, "Host PostEditor (Arabic Mixed-Script + Table + Code)"));

    // Mobile 390x844 viewport check
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileOverflow = await page.evaluate(() => ({
      docOverflowPx: document.documentElement.scrollWidth - window.innerWidth,
    }));
    report.accessibility.push(await runAxe(page, "Host PostEditor (Mobile 390x844 Viewport)"));
    await page.setViewportSize({ width: 1440, height: 900 });

    report.arabicRtl = {
      minSlashTouchTargetHeightPx: minSlashTargetPx,
      emptySlashStatusPoliteVisible: emptyStatusVisible,
      arabicKeywordTableMatched: arabicTableMatched,
      arabicKeywordCodeMatched: arabicCodeMatched,
      ...rtlDiagnostics,
      mobile390HorizontalOverflowPx: mobileOverflow.docOverflowPx,
    };

    // -------------------------------------------------------------------------
    // 3. Laboratory Event-Timing (INP methodology), Long-Tasks & 5k-Word Stress
    // -------------------------------------------------------------------------
    const measureEditingSession = async (targetPostId, label, charCount) => {
      await page.goto(`${VIBRESS_URL}/admin/posts/${targetPostId}`);
      await editorLoc.waitFor({ state: "visible", timeout: 15000 });
      const cdp = await authCtx.newCDPSession(page);
      await cdp.send("Performance.enable");
      const heapBefore = (await cdp.send("Performance.getMetrics")).metrics.find(
        (m) => m.name === "JSHeapUsedSize",
      )?.value ?? 0;

      await page.evaluate(() => {
        window.__perfEvents = [];
        window.__longTasks = [];
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (e.name === "keydown" || e.name === "input" || e.name === "keyup" || e.name === "pointerup") {
              window.__perfEvents.push({
                name: e.name,
                duration: e.duration,
                processingMs: e.processingEnd - e.processingStart,
              });
            }
          }
        }).observe({ type: "event", durationThreshold: 0, buffered: false });

        new PerformanceObserver((list) => {
          for (const lt of list.getEntries()) {
            window.__longTasks.push(lt.duration);
          }
        }).observe({ type: "longtask", buffered: false });
      });

      await editorLoc.click();
      const textToType = "Benchmarking interactive keystroke latency in Vibress Studio. ".repeat(
        Math.ceil(charCount / 60),
      ).slice(0, charCount);

      const wallSamples = [];
      for (const ch of textToType) {
        const t0 = performance.now();
        await page.keyboard.type(ch);
        wallSamples.push(performance.now() - t0);
      }
      await page.waitForTimeout(250);

      const collected = await page.evaluate(() => ({
        events: window.__perfEvents,
        longTasks: window.__longTasks,
      }));
      const heapAfter = (await cdp.send("Performance.getMetrics")).metrics.find(
        (m) => m.name === "JSHeapUsedSize",
      )?.value ?? 0;

      const durations = collected.events.map((e) => e.duration);
      const processing = collected.events.map((e) => e.processingMs);

      return {
        scenario: label,
        typedCharacters: charCount,
        eventDurationInpStyle: summarizeMs(durations),
        eventHandlerProcessing: summarizeMs(processing),
        playwrightDispatchRoundTrip: summarizeMs(wallSamples),
        longTaskCountOver50Ms: collected.longTasks.length,
        maxLongTaskMs: collected.longTasks.length ? Math.max(...collected.longTasks) : 0,
        jsHeapBeforeMiB: Number((heapBefore / (1024 * 1024)).toFixed(2)),
        jsHeapAfterMiB: Number((heapAfter / (1024 * 1024)).toFixed(2)),
        jsHeapDeltaMiB: Number(((heapAfter - heapBefore) / (1024 * 1024)).toFixed(2)),
      };
    };

    report.performance.typing1kWords = await measureEditingSession(post1k.id, "1,000-word post editing", 60);
    report.performance.typing5kWords = await measureEditingSession(post5k.id, "5,000-word post editing", 60);

    // -------------------------------------------------------------------------
    // 4. Real Two-Peer WebSocket Yjs Propagation Latency
    // -------------------------------------------------------------------------
    const peerCtxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageB = await peerCtxB.newPage();
    await pageB.goto(`${VIBRESS_URL}/admin/login`);
    await pageB.fill("#email", "owner@example.com");
    await pageB.fill("#password", "OwnerPass123!");
    await pageB.click('button[type="submit"]');
    await pageB.waitForURL((u) => u.pathname.startsWith("/admin") && !u.pathname.includes("/login"));

    const collabPost = await createPost("Phase07 Yjs Latency Probe", buildWordParagraphs(200));
    await page.goto(`${VIBRESS_URL}/admin/posts/${collabPost.id}`);
    await pageB.goto(`${VIBRESS_URL}/admin/posts/${collabPost.id}`);
    await editorLoc.waitFor({ state: "visible" });
    const editorLocB = pageB.locator('div.vibress-studio-editor div[contenteditable="true"]');
    await editorLocB.waitFor({ state: "visible" });
    await page.waitForTimeout(800);

    await editorLoc.click();
    const collabLatencies = [];
    for (let i = 1; i <= 12; i++) {
      const token = `SYNC_PROBE_${i}_X`;
      const t0 = performance.now();
      await page.keyboard.type(` ${token}`);
      await pageB.waitForFunction(
        (tok) => document.querySelector(".vibress-studio-editor")?.textContent?.includes(tok),
        token,
        { timeout: 5000 },
      );
      collabLatencies.push(performance.now() - t0);
    }
    report.performance.twoPeerYjsPropagation = summarizeMs(collabLatencies);
    await peerCtxB.close();

    // -------------------------------------------------------------------------
    // 5. Empirical Local Ghost Probe (http://localhost:2368)
    // -------------------------------------------------------------------------
    const ghostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ghostPage = await ghostCtx.newPage();
    try {
      const ghostSiteRes = await ghostCtx.request.get(`${GHOST_URL}/ghost/api/admin/site/`);
      const ghostSiteJson = await ghostSiteRes.json().catch(() => ({}));
      await ghostPage.goto(`${GHOST_URL}/ghost/`, { waitUntil: "domcontentloaded", timeout: 10000 });
      await ghostPage.waitForTimeout(1500);
      const ghostUrlAfterGoto = ghostPage.url();
      const ghostAxe = await runAxe(ghostPage, `Ghost Admin (${ghostUrlAfterGoto})`);
      report.ghostComparison = {
        reachable: true,
        ghostSiteMetadata: ghostSiteJson?.site || ghostSiteJson,
        landingUrl: ghostUrlAfterGoto,
        requiresInteractiveOwnerSetupOrAuth:
          ghostUrlAfterGoto.includes("setup") || ghostUrlAfterGoto.includes("signin"),
        ghostAdminShellAxe: ghostAxe,
      };
    } catch (err) {
      report.ghostComparison = {
        reachable: false,
        error: String(err),
      };
    } finally {
      await ghostCtx.close();
    }

    await authCtx.close();
  } finally {
    await browser.close();
  }

  const outPath =
    "/Users/abdullahzaher/.gemini/antigravity/brain/c8529503-0c8b-4733-b7bf-b45f89d0d935/scratch/phase07-results.json";
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log("Saved Phase 07 results to", outPath);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
