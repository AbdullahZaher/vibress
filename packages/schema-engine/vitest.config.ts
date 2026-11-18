import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", globals: true, passWithNoTests: false },
  resolve: {
    alias: {
      "@vibress/schema-engine": path.resolve(__dirname, "src/index.ts"),
      "@vibress/platform-kernel": path.resolve(
        __dirname,
        "../platform-kernel/src/index.ts",
      ),
    },
  },
});
