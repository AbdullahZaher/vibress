import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, closeDbPool } from "./connection";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const currentDir = typeof __dirname !== "undefined"
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));

export const findMigrationsFolder = (): string => {
  if (process.env.MIGRATIONS_FOLDER && fs.existsSync(process.env.MIGRATIONS_FOLDER)) {
    return process.env.MIGRATIONS_FOLDER;
  }
  const candidates = [
    path.join(currentDir, "../migrations"),
    path.join(currentDir, "../../packages/database/migrations"),
    path.join(process.cwd(), "packages/database/migrations"),
    path.join(process.cwd(), "migrations"),
    "/repo/packages/database/migrations",
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(currentDir, "../migrations");
};

export const runMigrations = async (): Promise<void> => {
  const db = getDb();
  const migrationsFolder = findMigrationsFolder();
  console.log(`Running migrations from ${migrationsFolder}...`);
  await migrate(db, { migrationsFolder });
  console.log("Migrations completed successfully.");
};

const isCliExecution = () => {
  try {
    if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
      return true;
    }
  } catch {
    // ESM scope where module/require might be guarded
  }
  if (process.argv[1]) {
    const scriptPath = process.argv[1];
    if (scriptPath.endsWith("migrate.js") || scriptPath.endsWith("migrate.ts") || scriptPath.endsWith("migrate.mjs")) {
      return true;
    }
  }
  return false;
};

if (isCliExecution()) {
  runMigrations()
    .then(() => closeDbPool())
    .catch(async (err) => {
      console.error("Migration failed:", err);
      await closeDbPool();
      process.exit(1);
    });
}
