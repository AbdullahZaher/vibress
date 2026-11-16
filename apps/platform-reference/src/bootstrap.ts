import { Pool } from "pg";
import {
  PlatformMembershipResolver,
  PostgresApplicationRegistryStore,
} from "@vibress/database";
import { asPrincipalId, asTenantId } from "@vibress/platform-kernel";
import type { MembershipRecord } from "@vibress/tenancy";
import { createReferenceApplication } from "./application";

interface BootstrapPrincipal {
  readonly id: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly active?: boolean;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parsePrincipals(json: string | undefined): BootstrapPrincipal[] {
  if (!json || json.trim() === "") return [];
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error("PLATFORM_BOOTSTRAP_PRINCIPALS must be a JSON array");
  }
  return parsed.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("each bootstrap principal must be an object");
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== "string") {
      throw new Error("bootstrap principal id is required");
    }
    const strings = (value: unknown, field: string): string[] => {
      if (
        !Array.isArray(value) ||
        value.some((item) => typeof item !== "string")
      ) {
        throw new Error(`bootstrap principal ${field} must be a string array`);
      }
      return value as string[];
    };
    return {
      id: record.id,
      roles: strings(record.roles ?? [], "roles"),
      permissions: strings(record.permissions ?? [], "permissions"),
      ...(typeof record.active === "boolean" ? { active: record.active } : {}),
    };
  });
}

async function main(): Promise<void> {
  const databaseUrl = required("DATABASE_URL");
  const tenantId = asTenantId(
    process.env.PLATFORM_TENANT_ID ?? "reference-tenant",
  );
  const tenantName = process.env.PLATFORM_TENANT_NAME ?? "Reference Tenant";
  const application = createReferenceApplication();
  const principals = parsePrincipals(process.env.PLATFORM_BOOTSTRAP_PRINCIPALS);

  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const store = new PostgresApplicationRegistryStore(pool);
    const registryActor = process.env.PLATFORM_REGISTRY_ACTOR?.trim();
    const registration = await store.sync(application, {
      ...(process.env.PLATFORM_REGISTRY_UPDATE === "1"
        ? { allowUpdate: true }
        : {}),
      ...(registryActor ? { actor: registryActor } : {}),
    });
    await store.verifyDefinitions([application]);

    await pool.query(
      `INSERT INTO platform_applications (id, name) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [application.id, application.name],
    );
    await pool.query(
      `INSERT INTO platform_tenants (id, application_id, name) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [tenantId, application.id, tenantName],
    );

    for (const principal of principals) {
      await pool.query(
        `INSERT INTO platform_memberships
           (application_id, tenant_id, principal_id, active, roles, permissions)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (application_id, tenant_id, principal_id) DO UPDATE
           SET active = EXCLUDED.active,
               roles = EXCLUDED.roles,
               permissions = EXCLUDED.permissions`,
        [
          application.id,
          tenantId,
          asPrincipalId(principal.id),
          principal.active ?? true,
          [...principal.roles],
          [...principal.permissions],
        ],
      );
    }

    const resolver = new PlatformMembershipResolver(pool);
    for (const principal of principals) {
      const record: MembershipRecord | null = await resolver.resolve(
        asPrincipalId(principal.id),
        application.id,
        tenantId,
      );
      if (!record) {
        throw new Error(`membership for ${principal.id} was not persisted`);
      }
    }

    console.log(
      `[platform-reference] registration ${registration.outcome} (${registration.digest.slice(0, 12)}…), tenant ${tenantId}, ${principals.length} membership(s)`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[platform-reference] bootstrap failed", error);
  process.exit(1);
});
