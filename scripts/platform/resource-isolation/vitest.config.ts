import { defineConfig } from "vitest/config";

/** Isolated W1-T06 unit contracts: no global database setup and no production secrets. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/queue/src/__tests__/installation-isolation.test.ts", "packages/cache/src/__tests__/redis-log-redaction.test.ts"],
    globals: false,
    fileParallelism: false,
    passWithNoTests: false,
  },
});
