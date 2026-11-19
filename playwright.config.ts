import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45 * 1000,
  expect: {
    timeout: 7000,
  },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    actionTimeout: 0,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : [
        {
          // Static nginx entry for the suite's 7777 origin. --no-deps keeps the
          // disposable database/redis topology owned by the caller; the
          // platform-reference app has its own isolated stack (port 7791) and
          // is excluded from the shared dev command.
          command: "docker compose -f compose.dev.yml up -d --no-deps gateway",
          url: "http://127.0.0.1:7777/nginx-health",
          reuseExistingServer: true,
          timeout: 120 * 1000,
        },
        {
          command: "pnpm dev",
          url: "http://127.0.0.1:7780/health/ready",
          reuseExistingServer: true,
          timeout: 120 * 1000,
        },
      ],
});

