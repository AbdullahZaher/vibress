import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

export interface PlatformReferenceE2eState {
  readonly applicationId: string;
  readonly installationId: string;
  readonly tenantAId: string;
  readonly tenantBId: string;
  readonly staffToken: string;
  readonly memberToken: string;
  readonly tenantBToken: string;
  readonly runtimeRole: string;
  readonly readerRole: string;
}

export function e2eStateFile(): string {
  const configured = process.env.PLATFORM_E2E_STATE_FILE?.trim();
  return configured
    ? path.resolve(configured)
    : path.resolve(process.cwd(), "tmp/platform-reference-e2e-state.json");
}

export function writeE2eState(state: PlatformReferenceE2eState): void {
  const file = e2eStateFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function readE2eState(): PlatformReferenceE2eState | null {
  const file = e2eStateFile();
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as PlatformReferenceE2eState;
}

export function removeE2eState(): void {
  const file = e2eStateFile();
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
}

/**
 * Removes only the rows and roles created for one E2E run. The application id
 * and role names are unique per run, so this cannot touch another fixture.
 */
export async function cleanupPlatformReferenceE2e(
  databaseUrl: string,
  state: PlatformReferenceE2eState,
): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      "DELETE FROM platform_crm_customers WHERE application_id = $1",
      [state.applicationId],
    );
    await client.query(
      "DELETE FROM platform_memberships WHERE application_id = $1",
      [state.applicationId],
    );
    await client.query("DELETE FROM platform_tenants WHERE application_id = $1", [
      state.applicationId,
    ]);
    await client.query(
      "DELETE FROM platform_installations WHERE application_id = $1",
      [state.applicationId],
    );
    await client.query(
      "DELETE FROM platform_application_registry_changes WHERE application_id = $1",
      [state.applicationId],
    );
    await client.query("DELETE FROM platform_applications WHERE id = $1", [
      state.applicationId,
    ]);

    for (const roleName of [state.runtimeRole, state.readerRole]) {
      const exists = await client.query(
        "SELECT 1 FROM pg_roles WHERE rolname = $1",
        [roleName],
      );
      if (exists.rowCount === 0) continue;
      const role = client.escapeIdentifier(roleName);
      await client.query(`DROP OWNED BY ${role}`);
      await client.query(`DROP ROLE IF EXISTS ${role}`);
    }
  } finally {
    await client.end();
  }
}
