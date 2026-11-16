import { defineConfig } from "@playwright/test";

const port = Number(process.env.PLATFORM_E2E_PORT ?? "7791");

export default defineConfig({
  testDir: "./tests/e2e-platform",
  timeout: 60 * 1000,
  expect: { timeout: 7000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  globalTeardown: "./scripts/teardown-platform-reference-e2e.ts",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec tsx scripts/start-platform-reference-e2e.ts",
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },
});
