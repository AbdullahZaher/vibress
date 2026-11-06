import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// Refuse the developer defaults: this suite migrates/seeds synthetic data and
// must run only against explicitly isolated localhost services.
const database = new URL(
  process.env.DATABASE_URL || "postgresql://invalid/invalid",
);
const redis = new URL(process.env.REDIS_URL || "redis://invalid");
if (
  process.env.STUDIO_ISOLATED_TESTS !== "1" ||
  database.hostname !== "127.0.0.1" ||
  !database.pathname.startsWith("/studio_qa_") ||
  ["", "5432", "5433"].includes(database.port) ||
  redis.hostname !== "127.0.0.1" ||
  ["", "6379", "6380"].includes(redis.port)
) {
  throw new Error(
    "Studio integration tests require explicitly isolated localhost PostgreSQL/Redis ports and a studio_qa_ database.",
  );
}
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [
      "tests/integration/studio-persistence-roundtrip.test.ts",
      "tests/integration/studio-collaboration-production.test.ts",
    ],
  },
});
