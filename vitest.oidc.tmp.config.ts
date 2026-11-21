import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/platform-reference/src/oidc-live-integration.test.ts"],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@vibress/platform-kernel": path.resolve(__dirname, "./packages/platform-kernel/src/index.ts"),
    },
  },
});
