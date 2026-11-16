import {
  cleanupPlatformReferenceE2e,
  readE2eState,
  removeE2eState,
} from "./lib/platform-reference-e2e";

export default async function globalTeardown(): Promise<void> {
  const state = readE2eState();
  if (!state) return;

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.warn(
      "[platform-reference-e2e] DATABASE_URL missing during teardown; run cleanup manually or re-run with DATABASE_URL",
    );
    return;
  }

  await cleanupPlatformReferenceE2e(databaseUrl, state);
  removeE2eState();
}
