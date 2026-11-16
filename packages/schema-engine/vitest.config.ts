import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", globals: true, passWithNoTests: false },
  resolve: {
    alias: {
      "@vibress/platform-kernel": path.resolve(
        __dirname,
        "../platform-kernel/src/index.ts",
      ),
    },
  },
});
