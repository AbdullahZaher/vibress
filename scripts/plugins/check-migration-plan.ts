/**
 * Operator-only, READ-ONLY signed release and physical-model migration check.
 * This command NEVER opens a DB connection, executes SQL or loads plugin JS.
 * Usage: pnpm exec tsx scripts/plugins/check-migration-plan.ts /absolute/plan.json
 */
import { readVerifiedOperatorMigrationPlan } from "./read-verified-migration-plan";

async function main(): Promise<void> {
  const [planPath, ...extra] = process.argv.slice(2);
  if (!planPath || extra.length) {
    throw new Error("Exactly one absolute migration-plan path is required");
  }
  const checked = await readVerifiedOperatorMigrationPlan(planPath);
  console.info(`Migration plan verified for ${checked.manifestId}: ${checked.migrationId} (${checked.models.length} models). No migration applied.`);
}

void main().catch(() => {
  console.error("Plugin migration plan preflight rejected; no changes made");
  process.exitCode = 1;
});
