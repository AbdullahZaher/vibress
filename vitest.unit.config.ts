import { defineConfig, mergeConfig } from "vitest/config";
import rootConfig from "./vitest.config";

/**
 * Workspace suite minus `tests/integration`. CI runs this together with
 * `pnpm test:integration` so every test runs exactly once: the root config
 * supplies aliases, global setup and its existing excludes (E2E, acceptance,
 * pinned LMS fixture), and this config adds the integration complement.
 */
export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      exclude: ["tests/integration/**"],
    },
  }),
);
