import { test, expect } from "@playwright/test";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(
    `Missing ${name}. Configure a signed LMS staging installation and an isolated test Member.`,
  );
  return value;
}
function origin(name: string): string {
  const value = required(name);
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/") {
    throw new Error("Expected a clean origin for " + name);
  }
  return url.origin;
}
function memberCookie(value: string, url: string) {
  const i = value.indexOf("=");
  if (i <= 0 || i === value.length - 1 || value.includes(";") ||
      !/^[A-Za-z0-9_-]+$/.test(value.slice(0, i))) {
    throw new Error("Expected one Member name=value cookie");
  }
  return { name: value.slice(0, i), value: value.slice(i + 1),
    url, httpOnly: true, sameSite: "Lax" as const };
}

const siteA = origin("VIBRESS_LMS_ACCEPTANCE_SITE_A");
const siteB = origin("VIBRESS_LMS_ACCEPTANCE_SITE_B");
const courseId = required("VIBRESS_LMS_ACCEPTANCE_COURSE_ID");
const authCookie = required("VIBRESS_LMS_ACCEPTANCE_MEMBER_COOKIE_A");
if (siteA === siteB || !/^[a-z][a-z0-9-]{1,63}$/.test(courseId)) {
  throw new Error("Expected distinct publication origins and a valid published course ID");
}

test("public detail is Host-bound and private lesson content stays protected", async ({ page }) => {
  await page.goto(`${siteA}/courses/${encodeURIComponent(courseId)}`);
  await expect(page.getByRole("heading", { name: "Learning and progress" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enroll in course" })).toBeVisible();
  const other = await page.request.get(
    `${siteB}/api/content/v1/extensions/vibress-lms-authoring/v1/course?courseId=${encodeURIComponent(courseId)}&locale=en`,
  );
  expect(other.ok()).toBeTruthy();
  const data: unknown = await other.json();
  expect(data).toMatchObject({ outcome: "not-found" });
  expect(JSON.stringify(data)).not.toContain("Protected Lesson Body");
});

test("real Member enrolls, reads authorized text lesson and completes it", async ({ page, context }) => {
  await context.addCookies([memberCookie(authCookie, siteA)]);
  await page.goto(`${siteA}/courses/${encodeURIComponent(courseId)}`);
  const enroll = page.getByRole("button", { name: "Enroll in course" });
  if (await enroll.isVisible()) await enroll.click();
  await expect(page.getByText("You are enrolled in this course")).toBeVisible();
  await expect(page.getByRole("region", { name: "Protected lesson" })).toBeVisible();
  const body = page.getByRole("region", { name: "Protected lesson" });
  await expect(body.locator("p")).not.toBeEmpty();
  // The learner portal must render lesson markup as literal text, not DOM.
  expect(await body.locator("script,iframe,img").count()).toBe(0);
  const complete = page.getByRole("button", { name: "Mark lesson complete" });
  if (await complete.isVisible()) await complete.click();
  await expect(page.getByText("100%")).toBeVisible();
  await expect(page.getByRole("button", { name: "Completed" })).toBeDisabled();

  // A Member cookie from publication A is never an authorization on B.
  const denied = await page.request.get(
    `${siteB}/api/members/v1/extensions/vibress-lms-authoring/v1/lesson?courseId=${encodeURIComponent(courseId)}&locale=en`,
    { headers: { cookie: authCookie } },
  );
  expect([401, 403, 404]).toContain(denied.status());
  expect(await denied.text()).not.toContain("Protected Lesson Body");
});

test("Arabic and RTL learner layout when explicitly enabled by staging", async ({ page }) => {
  const arabicPath = process.env.VIBRESS_LMS_ACCEPTANCE_ARABIC_DETAIL_PATH;
  test.skip(!arabicPath, "Set Arabic detail path after enabling ar-SA on staging");
  await page.goto(new URL(arabicPath ?? "/", siteA).toString());
  await expect(page.getByRole("region", { name: "بوابة الطالب" })).toHaveAttribute("dir", "rtl");
});
