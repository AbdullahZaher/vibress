import { defineConfig } from "@playwright/test";

/** Runs ONLY against a real signed LMS staging deployment.
 * Separate from the mock-friendly PR E2E suite; never boot a dev server. */
export default defineConfig({
  testDir: ".",
  testMatch: "lms-signed-release.spec.ts",
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
