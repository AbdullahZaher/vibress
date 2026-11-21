import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/tenancy/src/__tests__/*.test.ts"],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@vibress/platform-kernel": path.resolve(__dirname, "./packages/platform-kernel/src/index.ts"),
      "@vibress/tenancy": path.resolve(__dirname, "./packages/tenancy/src/index.ts"),
    },
  },
});
