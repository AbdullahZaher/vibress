import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Wave 1 platform isolation suite. Unlike the root config it does not run the
 * full CMS migration/seed; the integration test applies the additive platform
 * migration to the target database itself.
 *
 * The include list is explicit: `tests/integration/platform-packages.test.ts`
 * is a pre-existing CMS package test that resolves `@vibress/queue` and must
 * keep running under the root config with the full alias table, not here.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    fileParallelism: false,
    passWithNoTests: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    include: [
      "tests/integration/platform-tenant-isolation.test.ts",
      "tests/architecture/**/*.test.ts",
      "packages/platform-kernel/src/**/*.test.ts",
      "packages/tenancy/src/**/*.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@vibress/platform-kernel": path.resolve(
        __dirname,
        "./packages/platform-kernel/src/index.ts",
      ),
      "@vibress/tenancy": path.resolve(
        __dirname,
        "./packages/tenancy/src/index.ts",
      ),
    },
  },
});
