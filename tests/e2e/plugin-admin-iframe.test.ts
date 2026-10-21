import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const BASE = "http://localhost:7777";
const pluginId = "operator-demo";
const link = {
  pluginId, viewId: "courses", routeId: "course-list",
  label: { en: "Courses", ar: "الدورات" },
  title: { en: "Courses", ar: "الدورات" },
  permission: "plugins.read",
};
const ticket = "a".repeat(64);
const ticketPath = `/api/admin/v1/extensions/${pluginId}/views/courses/frame?ticket=${ticket}`;

async function mockPluginNavigation(page: Page) {
  await page.route("**/api/admin/v1/extensions/navigation", (route) =>
    route.fulfill({
      status: 200, contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({ items: [link] }),
    }));
}

async function login(page: Page) {
  await page.goto(`${BASE}/admin`);
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill("OwnerPass123!");
  await page.locator('button[type="submit"]').click();
  await expect(page.locator("#email")).toHaveCount(0);
}

test.describe("EXT-301B2B isolated Admin plugin UI", () => {
  test("renders independently reviewed HTML with keyboard interaction in opaque-origin iframe", async ({ page }) => {
    await mockPluginNavigation(page);
    await page.route(`**/api/admin/v1/extensions/${pluginId}/views/courses/frame-ticket`,
      (route) => route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ src: ticketPath }),
      }));
    await page.route(`**/api/admin/v1/extensions/${pluginId}/v1/course-list`,
      (route) => route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ total: 7 }),
      }));
    await page.route(`**/api/admin/v1/extensions/${pluginId}/views/courses/frame?ticket=*`,
      (route) => route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        headers: {
          "content-security-policy":
            "default-src 'none'; script-src 'unsafe-inline'; script-src-attr 'none'; " +
            "style-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; " +
            "frame-src 'none'; frame-ancestors 'self'; sandbox allow-scripts",
          "x-frame-options": "SAMEORIGIN",
          "cache-control": "private, no-store",
          "referrer-policy": "no-referrer",
        },
        body: `<!doctype html><html lang="ar" dir="rtl"><body>
          <button id="courses" type="button">الدورات</button>
          <output id="result">0</output>
          <button id="load" type="button">اقرأ البيانات</button>
          <output id="remote">waiting</output>
          <script>
            let count = 0;
            document.querySelector('#courses').addEventListener('click', () => {
              document.querySelector('#result').textContent = String(++count);
              let isolated = false;
              try { void window.parent.document.body; }
              catch { isolated = true; }
              document.body.dataset.isolated = String(isolated);
            });
            window.addEventListener('message', (event) => {
              if (event.source !== window.parent ||
                  event.data?.type !== 'vibress:extension:connect' ||
                  event.ports.length !== 1) return;
              const port = event.ports[0];
              port.onmessage = ({ data }) => {
                if (data?.type === 'vibress:extension:response' &&
                    data.requestId === 'request-1') {
                  document.querySelector('#remote').textContent =
                    data.ok ? String(data.data.total) : 'denied';
                }
              };
              document.querySelector('#load').addEventListener('click', () =>
                port.postMessage({ type: 'vibress:extension:read', version: 1,
                  requestId: 'request-1' }));
            });
          </script></body></html>`,
      }));
    await login(page);
    await page.goto(`${BASE}/admin/extensions/${pluginId}/courses`);
    const iframe = page.locator('iframe[title="Courses"]');
    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
    await expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");
    const view = page.frameLocator('iframe[title="Courses"]');
    await expect(view.locator("html")).toHaveAttribute("dir", "rtl");
    await view.locator("#courses").focus();
    await page.keyboard.press("Enter");
    await expect(view.locator("#result")).toHaveText("1");
    await expect(view.locator("body")).toHaveAttribute("data-isolated", "true");
    await view.locator("#load").click();
    await expect(view.locator("#remote")).toHaveText("7");
  });

  test("loads the independent sample HTML through the private view.read bridge", async ({ page }) => {
    await mockPluginNavigation(page);
    const sample = await readFile(
      path.join(process.cwd(), "docs/08-plugins/examples/isolated-courses.html"), "utf8",
    );
    await page.route(`**/api/admin/v1/extensions/${pluginId}/views/courses/frame-ticket`,
      (route) => route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ src: ticketPath }),
      }));
    await page.route(`**/api/admin/v1/extensions/${pluginId}/v1/course-list`,
      (route) => route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ total: 9 }),
      }));
    await page.route(`**/api/admin/v1/extensions/${pluginId}/views/courses/frame?ticket=*`,
      (route) => route.fulfill({
        status: 200, contentType: "text/html; charset=utf-8",
        headers: {
          "content-security-policy":
            "default-src 'none'; script-src 'unsafe-inline'; script-src-attr 'none'; " +
            "style-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; " +
            "frame-src 'none'; frame-ancestors 'self'; sandbox allow-scripts",
          "x-frame-options": "SAMEORIGIN",
          "cache-control": "private, no-store",
          "referrer-policy": "no-referrer",
        },
        body: sample,
      }));
    await login(page);
    await page.goto(`${BASE}/admin/extensions/${pluginId}/courses`);
    const view = page.frameLocator('iframe[title="Courses"]');
    const load = view.getByRole("button", { name: "Load courses" });
    await expect(load).toBeEnabled();
    await load.focus();
    await page.keyboard.press("Enter");
    await expect(view.locator("output")).toContainText('"total": 9');
  });

  test("preserves EXT-301A read-only fallback when no approved UI asset exists", async ({ page }) => {
    await mockPluginNavigation(page);
    await page.route(`**/api/admin/v1/extensions/${pluginId}/views/courses/frame-ticket`,
      (route) => route.fulfill({
        status: 404, contentType: "application/json",
        body: JSON.stringify({ errors: [{ code: "EXTENSION_UI_NOT_FOUND" }] }),
      }));
    await page.route(`**/api/admin/v1/extensions/${pluginId}/v1/course-list`,
      (route) => route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ total: 4 }),
      }));
    await login(page);
    await page.goto(`${BASE}/admin/extensions/${pluginId}/courses`);
    await expect(page.getByRole("heading", { level: 1, name: "Courses" })).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(page.locator("dl")).toContainText("total");
    await expect(page.locator("dl")).toContainText("4");
  });
});
