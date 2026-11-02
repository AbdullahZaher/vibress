import { Client } from "@vibress/database";
import crypto from "node:crypto";
import {
  StagingIsolationError,
  STAGING_IDENTITY_TABLE,
  AUTHORIZED_STAGING_ENV_TYPES,
  type StagingEnvType,
} from "./seed-theme-editorial-content";

export interface ProvisionStagingMarkerOptions {
  markerToken?: string;
  targetPublicationId?: string;
  environmentType?: StagingEnvType;
  env?: Record<string, string | undefined>;
}

/**
 * Creates and records an explicit cryptographic environment identity marker
 * on a disposable development or ephemeral test database in a dedicated workflow.
 * This operation is strictly separated from editorial content seeding.
 */
export async function provisionStagingMarker(
  client: Pick<Client, "query">,
  options: ProvisionStagingMarkerOptions = {},
): Promise<{ markerToken: string; targetPublicationId: string; environmentType: StagingEnvType }> {
  const env = options.env || process.env;

  // 1. Fail-closed: production environment check
  if (env.NODE_ENV === "production") {
    throw new StagingIsolationError(
      "Provisioning a staging marker is strictly forbidden when NODE_ENV=production. Overrides are not permitted.",
    );
  }

  // 2. Fail-closed: explicit provisioning opt-in flag
  if (env.VIBRESS_PROVISION_STAGING_MARKER !== "true") {
    throw new StagingIsolationError(
      "Staging marker provisioning requires deliberate opt-in via VIBRESS_PROVISION_STAGING_MARKER=true.",
    );
  }

  // 3. Fail-closed: cloud or managed target denial
  const dbUrl = env.DATABASE_URL;
  if (dbUrl) {
    const forbiddenPatterns = [
      /prod/i,
      /amazonaws\.com/i,
      /neon\.tech/i,
      /supabase\.co/i,
      /cockroachlabs\.cloud/i,
      /render\.com/i,
      /railway\.app/i,
      /azure\.com/i,
      /gcp/i,
      /google/i,
    ];

    for (const pattern of forbiddenPatterns) {
      if (pattern.test(dbUrl)) {
        throw new StagingIsolationError(
          `Target database URL matches forbidden cloud/production pattern: ${pattern}. Only local disposable dev databases are permitted.`,
        );
      }
    }
  }

  const markerToken = options.markerToken || crypto.randomBytes(32).toString("hex");
  if (!/^[a-f0-9]{64}$/i.test(markerToken)) {
    throw new StagingIsolationError(
      "Invalid marker token format. Must be a 64-character hexadecimal string.",
    );
  }

  const targetPublicationId = options.targetPublicationId || "pub_default";
  const environmentType = options.environmentType || "disposable_development";

  if (!AUTHORIZED_STAGING_ENV_TYPES.includes(environmentType)) {
    throw new StagingIsolationError(
      `Invalid environment type for staging marker provisioning: ${environmentType}`,
    );
  }

  // Verify target publication exists in target database before provisioning marker
  const pubResult = await client.query(
    "SELECT id FROM publications WHERE id = $1;",
    [targetPublicationId],
  );
  if (!pubResult || !pubResult.rows || pubResult.rows.length === 0) {
    throw new StagingIsolationError(
      `Target publication "${targetPublicationId}" does not exist in target database. Cannot provision staging marker for non-existent publication.`,
    );
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${STAGING_IDENTITY_TABLE} (
      id text PRIMARY KEY DEFAULT 'singleton',
      environment_type text NOT NULL,
      marker_token text NOT NULL,
      authorized_target_publication_id text NOT NULL,
      provisioned_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await client.query(
    `
    INSERT INTO ${STAGING_IDENTITY_TABLE} (id, environment_type, marker_token, authorized_target_publication_id, provisioned_at)
    VALUES ('singleton', $1, $2, $3, now())
    ON CONFLICT (id) DO UPDATE SET
      environment_type = EXCLUDED.environment_type,
      marker_token = EXCLUDED.marker_token,
      authorized_target_publication_id = EXCLUDED.authorized_target_publication_id,
      provisioned_at = now();
  `,
    [environmentType, markerToken, targetPublicationId],
  );

  return { markerToken, targetPublicationId, environmentType };
}

export async function main() {
  const connectionString =
    process.env.DATABASE_URL || "postgresql://vibress:vibress@127.0.0.1:5433/vibress";
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const { markerToken, targetPublicationId, environmentType } = await provisionStagingMarker(
      client,
    );
    console.log(`[STAGING_PROVISION] Successfully provisioned staging environment marker.`);
    console.log(`[STAGING_PROVISION] Environment Type: ${environmentType}`);
    console.log(`[STAGING_PROVISION] Target Publication: ${targetPublicationId}`);
    console.log(`[STAGING_PROVISION] VIBRESS_STAGING_MARKER_TOKEN=${markerToken}`);
  } finally {
    await client.end();
  }
}

const isDirectExecution = process.argv[1]?.endsWith("provision-staging-marker.ts");
if (isDirectExecution) {
  main().catch((error) => {
    console.error("Staging marker provisioning failed:", error.message);
    process.exitCode = 1;
  });
}

