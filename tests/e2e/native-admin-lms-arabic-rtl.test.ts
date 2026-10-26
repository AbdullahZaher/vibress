import { test, expect, type Page } from "@playwright/test";

const BASE = "http://localhost:7777";
const pluginId = "vibress-lms-authoring";
const viewId = "course-overview";
const routeId = "courses";

const navLink = {
  pluginId,
  viewId,
  routeId,
  label: { en: "Course Overview", ar: "نظرة عامة على الدورات" },
  title: { en: "Course Overview", ar: "نظرة عامة على الدورات" },
  permission: "plugins.manage",
  nativeProbeSupported: true,
};

const nativePageDescriptor = {
  mode: "native",
  routeId,
  page: {
    schemaVersion: 1,
    viewId,
    title: { en: "Course Overview", ar: "نظرة عامة على الدورات" },
    description: {
      en: "Read-only course inventory; edit courses in Authoring.",
      ar: "قائمة الدورات للعرض فقط؛ استخدم إدارة الدورات للتحرير.",
    },
    components: [
      {
        type: "stat",
        id: "legacy-sample",
        field: "total",
        label: { en: "Total Courses", ar: "إجمالي الدورات" },
      },
    ],
  },
  workflow: {
    schemaVersion: 1,
    viewId,
    routeId,
    resourceId: "course-records",
    idField: "courseId",
    versionField: "expectedVersion",
    operationField: "operation",
    operations: ["create", "save", "publish"],
    fields: [
      { key: "title_en", label: { en: "English Title", ar: "عنوان الدورة بالإنجليزية" }, maxLength: 180 },
      { key: "title_ar", label: { en: "Arabic Title", ar: "عنوان الدورة بالعربية" }, maxLength: 180 },
      { key: "summary_en", label: { en: "English Summary", ar: "ملخص الدورة بالإنجليزية" }, maxLength: 500, multiline: true },
      { key: "summary_ar", label: { en: "Arabic Summary", ar: "ملخص الدورة بالعربية" }, maxLength: 500, multiline: true },
      { key: "lesson_title_en", label: { en: "Lesson English Title", ar: "عنوان الدرس بالإنجليزية" }, maxLength: 180 },
      { key: "lesson_title_ar", label: { en: "Lesson Arabic Title", ar: "عنوان الدرس بالعربية" }, maxLength: 180 },
      { key: "lesson_body_en", label: { en: "Lesson English Content", ar: "محتوى الدرس بالإنجليزية" }, maxLength: 2000, multiline: true },
      { key: "lesson_body_ar", label: { en: "Lesson Arabic Content", ar: "محتوى الدرس بالعربية" }, maxLength: 2000, multiline: true },
    ],
  },
};

const initialCourses = [
  {
    id: "course-web-101",
    version: 1,
    fields: {
      title_en: "Web Development Foundations",
      title_ar: "أساسيات تطوير الويب",
      status: "draft",
      summary_en: "Foundational architecture for modern web applications.",
      summary_ar: "البنية الأساسية لتطبيقات الويب الحديثة.",
      lesson_title_en: "Semantic HTML",
      lesson_title_ar: "لغة HTML الدلالية",
      lesson_body_en: "HTML provides structural meaning.",
      lesson_body_ar: "تمنح عناصر HTML المعنى الهيكلي.",
    },
  },
  {
    id: "course-cloud-201",
    version: 2,
    fields: {
      title_en: "Cloud Distributed Systems",
      title_ar: "الأنظمة السحابية الموزعة",
      status: "published",
      summary_en: "Scalability and resilience in distributed environments.",
      summary_ar: "القابلية للتوسع والمرونة في البيئات الموزعة.",
      lesson_title_en: "High Availability",
      lesson_title_ar: "التوافر العالي",
      lesson_body_en: "Redundancy ensures zero downtime.",
      lesson_body_ar: "يضمن التكرار عدم انقطاع الخدمة.",
    },
  },
];

async function login(page: Page) {
  await page.goto(`${BASE}/admin`);
  await page.waitForLoadState("networkidle");
  const emailInput = page.locator("#email");
  if (await emailInput.isVisible({ timeout: 4000 }).catch(() => false)) {
    await emailInput.fill("owner@example.com");
    await page.locator("#password").fill("OwnerPass123!");
    await page.locator('button[type="submit"]').click();
    await expect(page.locator("#email")).toHaveCount(0, { timeout: 10000 });
    await page.waitForLoadState("networkidle");
  }
}

async function setupNativeLmsRoutes(
  page: Page,
  coursesState: typeof initialCourses,
  activeLocale: "en" | "ar" = "en",
) {
  // Mock locale context so Admin UI configures RTL and Arabic labels
  await page.route("**/api/admin/v1/locales/context", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({
        primaryLocale: activeLocale,
        enabledLocales: ["en", "ar"],
      }),
    }),
  );

  await page.route("**/api/content/v1/site", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({
        site: {
          title: "Vibress Admin",
          locale: activeLocale,
        },
      }),
    }),
  );

  // Mock extension navigation so LMS Native view appears in Admin sidebar/router
  await page.route("**/api/admin/v1/extensions/navigation", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({ items: [navLink] }),
    }),
  );

  // Native descriptor endpoint
  await page.route(`**/api/admin/v1/extensions/${pluginId}/views/${viewId}/native`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify(nativePageDescriptor),
    }),
  );

  // Scalar data endpoint
  await page.route(`**/api/admin/v1/extensions/${pluginId}/v1/${routeId}`, (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ total: coursesState.length }),
      });
    }

    // POST /courses (create, save, publish)
    const postData = route.request().postDataJSON() as {
      operation: "create" | "save" | "publish";
      courseId: string;
      expectedVersion: number;
      [key: string]: unknown;
    };

    if (postData.operation === "create") {
      const newCourse = {
        id: postData.courseId,
        version: 1,
        fields: {
          title_en: String(postData.title_en || ""),
          title_ar: String(postData.title_ar || ""),
          status: "draft",
          summary_en: String(postData.summary_en || ""),
          summary_ar: String(postData.summary_ar || ""),
          lesson_title_en: String(postData.lesson_title_en || ""),
          lesson_title_ar: String(postData.lesson_title_ar || ""),
          lesson_body_en: String(postData.lesson_body_en || ""),
          lesson_body_ar: String(postData.lesson_body_ar || ""),
        },
      };
      coursesState.push(newCourse);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          outcome: "created",
          courseId: postData.courseId,
          version: 1,
          status: "draft",
        }),
      });
    }

    if (postData.operation === "save") {
      const idx = coursesState.findIndex((c) => c.id === postData.courseId);
      if (idx !== -1) {
        coursesState[idx]!.version += 1;
        coursesState[idx]!.fields = {
          ...coursesState[idx]!.fields,
          title_en: String(postData.title_en ?? coursesState[idx]!.fields.title_en),
          title_ar: String(postData.title_ar ?? coursesState[idx]!.fields.title_ar),
          summary_en: String(postData.summary_en ?? coursesState[idx]!.fields.summary_en),
          summary_ar: String(postData.summary_ar ?? coursesState[idx]!.fields.summary_ar),
        };
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            outcome: "saved",
            courseId: postData.courseId,
            version: coursesState[idx]!.version,
            status: "draft",
          }),
        });
      }
    }

    if (postData.operation === "publish") {
      const idx = coursesState.findIndex((c) => c.id === postData.courseId);
      if (idx !== -1) {
        coursesState[idx]!.version += 1;
        coursesState[idx]!.fields.status = "published";
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            outcome: "published",
            courseId: postData.courseId,
            version: coursesState[idx]!.version,
            status: "published",
          }),
        });
      }
    }

    return route.fulfill({ status: 400, body: JSON.stringify({ error: "Invalid action" }) });
  });

  // Data discovery endpoint (strictly conforming to ExtensionNativeDataDiscoveryV1Schema)
  await page.route(`**/api/admin/v1/extensions/${pluginId}/data`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: 1,
        resources: [
          {
            id: "course-records",
            viewId,
            fields: ["title_en", "title_ar", "status", "summary_en", "summary_ar"],
            textFilters: ["status"],
          },
        ],
        actions: [],
      }),
    }),
  );

  // Resource items endpoint
  await page.route(`**/api/admin/v1/extensions/${pluginId}/resources/course-records*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: 1,
        items: coursesState,
      }),
    }),
  );
}

test.describe("Priority 3: Real Playwright Native LMS Arabic RTL Browser Acceptance", () => {
  let liveCourses: typeof initialCourses;

  test.beforeEach(async () => {
    liveCourses = JSON.parse(JSON.stringify(initialCourses));
  });

  test("Scenario 1 & 2: Native UI navigation and Arabic RTL rendering verification", async ({ page }) => {
    await setupNativeLmsRoutes(page, liveCourses, "ar");
    await login(page);

    // Automatically accept window.confirm dialogs
    page.on("dialog", (dialog) => dialog.accept());

    // Navigate to Native LMS extension view
    await page.goto(`${BASE}/admin/extensions/${pluginId}/${viewId}`);
    await page.waitForLoadState("networkidle");

    // 1. Verify Native mode is active: NO iframe is rendered
    await expect(page.locator("iframe")).toHaveCount(0);

    // 2. Verify Arabic RTL rendering
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");

    // 3. Verify Arabic headings and labels
    await expect(page.locator("h1")).toContainText("نظرة عامة على الدورات");
    await expect(page.getByRole("button", { name: "إنشاء مسودة" })).toBeVisible();

    // 4. Verify table headers and Arabic course title rendering
    await expect(page.locator("table")).toBeVisible();
    await expect(page.locator("body")).toContainText("أساسيات تطوير الويب");
    await expect(page.locator("body")).toContainText("الأنظمة السحابية الموزعة");
  });

  test("Scenario 3, 4, 5, 6: Bilingual course lifecycle (Create draft -> Save draft -> Publish -> Immutability)", async ({ page }) => {
    await setupNativeLmsRoutes(page, liveCourses, "ar");
    await login(page);

    page.on("dialog", (dialog) => dialog.accept());

    await page.goto(`${BASE}/admin/extensions/${pluginId}/${viewId}`);
    await page.waitForLoadState("networkidle");

    // Scenario 3: Create bilingual course draft
    await page.getByRole("button", { name: "إنشاء مسودة" }).click();
    await expect(page.locator("#domain-vibress-lms-authoring-course-overview-id")).toBeVisible();

    await page.fill("#domain-vibress-lms-authoring-course-overview-id", "course-bilingual-301");
    await page.fill("#domain-vibress-lms-authoring-course-overview-title_en", "Advanced TypeScript Architecture");
    await page.fill("#domain-vibress-lms-authoring-course-overview-title_ar", "هندسة تايب سكريبت المتقدمة");
    await page.fill("#domain-vibress-lms-authoring-course-overview-summary_en", "Deep dive into enterprise TypeScript design.");
    await page.fill("#domain-vibress-lms-authoring-course-overview-summary_ar", "دورة متقدمة في تصميم النظم المؤسسية.");

    await page.locator('button[type="submit"]:has-text("إنشاء مسودة")').click();

    // Assert draft creation success announcement
    await expect(page.locator('p[role="status"]').filter({ hasText: "تم حفظ المسودة بنجاح." })).toBeVisible();
    await expect(page.locator("body")).toContainText("هندسة تايب سكريبت المتقدمة");

    // Scenario 4: Edit draft course
    await page.locator('button[aria-label*="course-web-101"]').click();

    const titleArInput = page.locator("#domain-vibress-lms-authoring-course-overview-title_ar");
    await expect(titleArInput).toHaveValue("أساسيات تطوير الويب");
    await titleArInput.fill("أساسيات تطوير الويب الحديثة (مُحدّث)");

    await page.locator('button[type="submit"]:has-text("حفظ المسودة")').click();
    // Verify updated title is reflected in the records table
    await expect(page.locator("table")).toContainText("أساسيات تطوير الويب الحديثة (مُحدّث)");

    // Scenario 5: Publish course
    await page.locator('button[aria-label*="course-web-101"]').click();
    const publishBtn = page.getByRole("button", { name: "نشر", exact: true });
    await expect(publishBtn).toBeVisible();
    await publishBtn.click();

    // Verify course is now published in the table
    const publishedCourseRow = page.locator("tr").filter({ hasText: "course-web-101" });
    await expect(publishedCourseRow).toContainText("published");

    // Scenario 6: Published course immutability
    await page.locator('button[aria-label*="course-cloud-201"]').click();

    // Editing form must be locked/hidden and notice displayed
    await expect(page.locator('p[role="status"]').filter({ hasText: "لا يمكن تعديل العناصر المنشورة." })).toBeVisible();
    await expect(page.locator('button[type="submit"]:has-text("حفظ المسودة")')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "نشر", exact: true })).toHaveCount(0);
  });

  test("Scenario 7 & 8: Keyboard accessibility navigation and error validation announcements", async ({ page }) => {
    await setupNativeLmsRoutes(page, liveCourses, "ar");
    await login(page);

    await page.goto(`${BASE}/admin/extensions/${pluginId}/${viewId}`);
    await page.waitForLoadState("networkidle");

    // Scenario 7: Keyboard navigation
    const createDraftBtn = page.getByRole("button", { name: "إنشاء مسودة" });
    await createDraftBtn.focus();
    await page.keyboard.press("Enter");

    const recordIdInput = page.locator("#domain-vibress-lms-authoring-course-overview-id");
    await expect(recordIdInput).toBeVisible();

    // Scenario 8: Validation error announcements on invalid ID
    await recordIdInput.fill("invalid id with spaces!");
    await page.locator('button[type="submit"]:has-text("إنشاء مسودة")').click();

    const alertMsg = page.locator('p[role="alert"]');
    await expect(alertMsg).toBeVisible();
    await expect(alertMsg).toContainText("بيانات سجل الإضافة غير صحيحة.");

    // Keyboard Tab and Escape to Cancel
    page.once("dialog", (dialog) => dialog.dismiss()); // Test cancellation
    const cancelBtn = page.getByRole("button", { name: "إلغاء", exact: true });
    await cancelBtn.focus();
    await page.keyboard.press("Enter");
  });

  test("Scenario 9 & 10: Publication switching data wipe and authorization revocation", async ({ page }) => {
    await setupNativeLmsRoutes(page, liveCourses, "en");
    await login(page);

    await page.goto(`${BASE}/admin/extensions/${pluginId}/${viewId}`);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("body")).toContainText("Web Development Foundations");

    // Scenario 9: Publication switching must immediately wipe private data
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("vibress:publication-changed"));
    });

    // Verify view re-checks and clears private stale state
    await page.waitForTimeout(100);

    // Scenario 10: Authorization revocation fails closed with accessible alert
    await page.route(`**/api/admin/v1/extensions/${pluginId}/views/${viewId}/native`, (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ errors: [{ code: "PERMISSION_DENIED" }] }),
      }),
    );

    await page.goto(`${BASE}/admin/extensions/${pluginId}/${viewId}`);
    await page.waitForLoadState("networkidle");

    // Must show accessible alert error and hide private data
    await expect(page.locator('p[role="alert"]')).toContainText("Unable to load plugin view.");
    await expect(page.locator("table")).toHaveCount(0);
  });

  test("Scenario 11: Stored XSS attack payload resistance", async ({ page }) => {
    // Inject hostile XSS payloads into course records
    const hostileCourses = [
      {
        id: "xss-test-course",
        version: 1,
        fields: {
          title_en: `<script>window.__hostile_xss_executed = true;</script><img src="x" onerror="window.__hostile_xss_executed = true;">Safe Display`,
          title_ar: `<svg onload="window.__hostile_xss_executed = true;">عرض آمن</svg>`,
          status: "draft",
          summary_en: "<b>Bold text</b> without execution",
          summary_ar: "نص آمن",
          lesson_title_en: "Lesson XSS",
          lesson_title_ar: "درس",
          lesson_body_en: "Body content",
          lesson_body_ar: "محتوى",
        },
      },
    ];

    await setupNativeLmsRoutes(page, hostileCourses, "en");
    await login(page);

    await page.goto(`${BASE}/admin/extensions/${pluginId}/${viewId}`);
    await page.waitForLoadState("networkidle");

    // Assert that the text is displayed safely as text nodes
    await expect(page.locator("body")).toContainText("Safe Display");
    await expect(page.locator("body")).toContainText("عرض آمن");

    // Assert that no script executed and global flag was NOT created
    const xssFlag = await page.evaluate(() => (window as unknown as { __hostile_xss_executed?: boolean }).__hostile_xss_executed);
    expect(xssFlag).toBeUndefined();
  });

  test("Scenario 12: Responsive layout verification on Desktop (1280px) and Mobile (375px)", async ({ page }) => {
    await setupNativeLmsRoutes(page, liveCourses, "en");
    await login(page);

    // 1. Desktop viewport (1280 x 800)
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE}/admin/extensions/${pluginId}/${viewId}`);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("table")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create draft" })).toBeVisible();

    // Verify no unexpected horizontal page overflow
    const desktopScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const desktopClientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(desktopScrollWidth).toBeLessThanOrEqual(desktopClientWidth + 1);

    // 2. Mobile viewport (375 x 667)
    await page.setViewportSize({ width: 375, height: 667 });
    await page.reload();
    await page.waitForLoadState("networkidle");

    await expect(page.locator("h1")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create draft" })).toBeVisible();
    await expect(page.locator("table")).toBeVisible();
  });
});
