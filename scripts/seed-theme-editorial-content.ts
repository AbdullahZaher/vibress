import { Client } from "@vibress/database";
import crypto from "node:crypto";

export class StagingIsolationError extends Error {
  constructor(message: string) {
    super(`[STAGING_ISOLATION_VIOLATION] ${message}`);
    this.name = "StagingIsolationError";
  }
}

export const STAGING_IDENTITY_TABLE = "_staging_environment_identity";
export const AUTHORIZED_STAGING_ENV_TYPES = [
  "disposable_development",
  "ephemeral_test",
] as const;
export type StagingEnvType = (typeof AUTHORIZED_STAGING_ENV_TYPES)[number];

export interface StagingEnvironmentIdentity {
  id: string;
  environmentType: string;
  markerToken: string;
  authorizedTargetPublicationId: string;
  provisionedAt: Date;
}

/**
 * Creates and records an explicit cryptographic environment identity marker
 * on a disposable development or ephemeral test database.
 */
export async function provisionStagingMarker(
  client: Pick<Client, "query">,
  options: {
    markerToken?: string;
    targetPublicationId?: string;
    environmentType?: StagingEnvType;
  } = {},
): Promise<{ markerToken: string; targetPublicationId: string; environmentType: StagingEnvType }> {
  const markerToken = options.markerToken || crypto.randomBytes(32).toString("hex");
  const targetPublicationId = options.targetPublicationId || "pub_default";
  const environmentType = options.environmentType || "disposable_development";

  if (!AUTHORIZED_STAGING_ENV_TYPES.includes(environmentType)) {
    throw new StagingIsolationError(
      `Invalid environment type for staging marker provisioning: ${environmentType}`,
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

/**
 * Verifies that the connected database is an explicitly authorized disposable staging/test database.
 * Executes on the EXACT SAME database connection that will be used for mutations.
 * Fails closed if the identity marker table is missing, the row is absent, the environment
 * type is not an authorized staging type, the token mismatches, or the target publication mismatches.
 */
export async function verifyStagingMarker(
  client: Pick<Client, "query">,
  expected: {
    markerToken?: string;
    targetPublicationId?: string;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<StagingEnvironmentIdentity> {
  const env = expected.env || process.env;

  // 1. Fail-closed: NODE_ENV check
  if (env.NODE_ENV === "production") {
    throw new StagingIsolationError(
      "Editorial staging seeder is strictly forbidden when NODE_ENV=production. Overrides are not permitted.",
    );
  }

  // 2. Fail-closed: deliberate opt-in flag
  if (env.VIBRESS_SEED_EDITORIAL_STAGING !== "true") {
    throw new StagingIsolationError(
      "Editorial staging seeder requires deliberate opt-in via VIBRESS_SEED_EDITORIAL_STAGING=true.",
    );
  }

  // 3. Fail-closed: database URL inspection for cloud or production indicators
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
          `Target database URL matches forbidden cloud/production pattern: ${pattern}. Only local dev databases are permitted.`,
        );
      }
    }
  }

  // 4. Query the connected database for the staging identity marker
  let result;
  try {
    result = await client.query(
      `SELECT id, environment_type, marker_token, authorized_target_publication_id, provisioned_at
       FROM ${STAGING_IDENTITY_TABLE}
       WHERE id = 'singleton';`,
    );
  } catch (error: any) {
    throw new StagingIsolationError(
      `Staging identity table "${STAGING_IDENTITY_TABLE}" is missing or inaccessible on target database: ${error.message}`,
    );
  }

  if (!result || !result.rows || result.rows.length === 0) {
    throw new StagingIsolationError(
      "Database does not contain a verified staging environment identity marker row.",
    );
  }

  const row = result.rows[0];
  const identity: StagingEnvironmentIdentity = {
    id: row.id,
    environmentType: row.environment_type,
    markerToken: row.marker_token,
    authorizedTargetPublicationId: row.authorized_target_publication_id,
    provisionedAt: row.provisioned_at,
  };

  // 5. Verify environment type is strictly authorized (never 'production' or unknown)
  if (!AUTHORIZED_STAGING_ENV_TYPES.includes(identity.environmentType as any)) {
    throw new StagingIsolationError(
      `Invalid staging database environment type: "${identity.environmentType}". Only ${AUTHORIZED_STAGING_ENV_TYPES.join(", ")} permitted.`,
    );
  }

  // 6. Verify marker token if expected token provided or configured
  const expectedToken = expected.markerToken || env.VIBRESS_STAGING_MARKER_TOKEN;
  if (expectedToken && identity.markerToken !== expectedToken) {
    throw new StagingIsolationError(
      `Staging environment marker token mismatch. Target database marker does not match authorized execution token.`,
    );
  }

  // 7. Verify authorized publication ID
  const expectedPubId = expected.targetPublicationId || "pub_default";
  if (identity.authorizedTargetPublicationId !== expectedPubId) {
    throw new StagingIsolationError(
      `Database is not authorized for target publication "${expectedPubId}". Authorized target is "${identity.authorizedTargetPublicationId}".`,
    );
  }

  // 8. Confirm target publication actually exists in the authorized database
  const pubResult = await client.query(
    "SELECT id, name FROM publications WHERE id = $1;",
    [expectedPubId],
  );
  if (!pubResult || pubResult.rows.length === 0) {
    throw new StagingIsolationError(
      `Target publication "${expectedPubId}" does not exist in target database.`,
    );
  }

  return identity;
}

export const seedStatements: string[] = [
  // 1. Publication identity
  `UPDATE publications 
   SET name = 'The Vibress Chronicle',
       description = 'An independent journal of architecture, design, and editorial craftsmanship.'
   WHERE id = 'pub_default';`,

  // 2. Publication settings
  `UPDATE settings SET value = '"The Vibress Chronicle"' WHERE publication_id = 'pub_default' AND key = 'title';`,
  `UPDATE settings SET value = '"An independent journal of architecture, design, and editorial craftsmanship."' WHERE publication_id = 'pub_default' AND key = 'description';`,
  `UPDATE settings SET value = 'false' WHERE publication_id = 'pub_default' AND key = 'announcementEnabled';`,
  `UPDATE settings SET value = '""' WHERE publication_id = 'pub_default' AND key = 'announcementText';`,
  `UPDATE settings SET value = '""' WHERE publication_id = 'pub_default' AND key = 'headerCode';`,
  `UPDATE settings SET value = '""' WHERE publication_id = 'pub_default' AND key = 'footerCode';`,

  // 3. Authors
  `UPDATE users SET name = 'Elena Vance' WHERE id = '500bfa35-d947-437b-b4ae-87e75812b915';`,
  `UPDATE users SET name = 'Marcus Thorne' WHERE id = 'e60b1072-4c90-489d-b067-5c098ca4e6b1';`,
  `UPDATE users SET name = 'Julian Ross' WHERE id = '517cb15c-a6e8-4b45-af0d-89f411b43d59';`,
  `UPDATE users SET name = 'Sophia Chen' WHERE id = '8acc5bf6-41f5-43e2-8c61-936870c3836f';`,

  // 4. Editorial media assets
  `INSERT INTO media_assets (
    id, publication_id, storage_provider, storage_key, original_filename,
    display_name, mime_type, extension, size_bytes, checksum, asset_type, width, height, metadata
  ) VALUES
    ('asset-editorial-arch', 'pub_default', 'local', 'editorial/architecture.jpg', 'architecture.jpg',
     'Minimalist Architecture', 'image/jpeg', 'jpg', 234241, 'chk-arch-1200', 'image', 1200, 800, '{"url": "/editorial/architecture.jpg"}'),
    ('asset-editorial-typo', 'pub_default', 'local', 'editorial/typography.jpg', 'typography.jpg',
     'Editorial Typography', 'image/jpeg', 'jpg', 111039, 'chk-typo-1200', 'image', 1200, 800, '{"url": "/editorial/typography.jpg"}'),
    ('asset-editorial-work', 'pub_default', 'local', 'editorial/workspace.jpg', 'workspace.jpg',
     'Quiet Editorial Studio', 'image/jpeg', 'jpg', 128819, 'chk-work-1200', 'image', 1200, 800, '{"url": "/editorial/workspace.jpg"}'),
    ('asset-editorial-abstr', 'pub_default', 'local', 'editorial/abstract.jpg', 'abstract.jpg',
     'Kinetic Form and Color', 'image/jpeg', 'jpg', 64473, 'chk-abstr-1200', 'image', 1200, 800, '{"url": "/editorial/abstract.jpg"}')
  ON CONFLICT (id) DO UPDATE SET
    storage_key = EXCLUDED.storage_key,
    display_name = EXCLUDED.display_name,
    metadata = EXCLUDED.metadata;`,

  // 5. Tags
  `INSERT INTO tags (id, publication_id, name, slug, description) VALUES
    ('tag-editorial-design', 'pub_default', 'Design Systems', 'design-systems', 'Interface architecture and design systems.'),
    ('tag-editorial-typo', 'pub_default', 'Typography', 'typography', 'Macro and micro-typography principles.'),
    ('tag-editorial-arch', 'pub_default', 'Architecture', 'architecture', 'Physical and digital spatial design.'),
    ('tag-editorial-craft', 'pub_default', 'Editorial Craft', 'editorial-craft', 'Publishing workflows and editorial standards.')
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    slug = EXCLUDED.slug;`,

  // Clean up any test tags from previous test runs
  `DELETE FROM post_tags WHERE tag_id = '07c440a1-9824-42f8-9385-c21e035a0d1d';`,
  `DELETE FROM tags WHERE id = '07c440a1-9824-42f8-9385-c21e035a0d1d';`,

  // 6. Hide or unpublish any ad-hoc test posts
  `UPDATE posts SET status = 'draft' 
   WHERE publication_id = 'pub_default' 
     AND id NOT IN (
       'bb46491c-dd25-492c-a035-89745ceffd6c',
       '18c6584c-385e-4340-ad06-4f3f6d4f74d4',
       'c9c5fe2b-1d2c-46cf-88dc-5ec3b6df26d7',
       'a1825127-6b22-4841-9152-4b37917d9501'
     );`,

  // 7. Polish the 4 primary editorial articles
  `UPDATE posts SET
    title = 'The Architecture of Quiet Interfaces',
    slug = 'the-architecture-of-quiet-interfaces',
    excerpt = 'How intentional whitespace, typographic restraint, and optical grid alignment elevate digital readability.',
    feature_image_id = 'asset-editorial-arch',
    primary_author_id = '500bfa35-d947-437b-b4ae-87e75812b915',
    featured = true,
    status = 'published',
    published_at = NOW() - interval '2 hours'
  WHERE id = 'bb46491c-dd25-492c-a035-89745ceffd6c';`,

  `UPDATE posts SET
    title = 'Principles of Minimalist Typography',
    slug = 'principles-of-minimalist-typography',
    excerpt = 'The enduring principles of lead type continue to govern reading comfort on modern high-density displays.',
    feature_image_id = 'asset-editorial-typo',
    primary_author_id = 'e60b1072-4c90-489d-b067-5c098ca4e6b1',
    featured = false,
    status = 'published',
    published_at = NOW() - interval '1 day'
  WHERE id = '18c6584c-385e-4340-ad06-4f3f6d4f74d4';`,

  `UPDATE posts SET
    title = 'Designing for Focus in the Modern Web',
    slug = 'designing-for-focus-in-the-modern-web',
    excerpt = 'Reclaiming human attention through calm, purposeful interface design and quiet digital architecture.',
    feature_image_id = 'asset-editorial-work',
    primary_author_id = '8acc5bf6-41f5-43e2-8c61-936870c3836f',
    featured = false,
    status = 'published',
    published_at = NOW() - interval '2 days'
  WHERE id = 'c9c5fe2b-1d2c-46cf-88dc-5ec3b6df26d7';`,

  `UPDATE posts SET
    title = 'The Renaissance of Independent Media',
    slug = 'the-renaissance-of-independent-media',
    excerpt = 'Why focused, ad-free editorial publications are winning the attention of discerning readers worldwide.',
    feature_image_id = 'asset-editorial-abstr',
    primary_author_id = '517cb15c-a6e8-4b45-af0d-89f411b43d59',
    featured = false,
    status = 'published',
    published_at = NOW() - interval '3 days'
  WHERE id = 'a1825127-6b22-4841-9152-4b37917d9501';`,

  // Link tags
  `DELETE FROM post_tags WHERE publication_id = 'pub_default';`,
  `INSERT INTO post_tags (post_id, tag_id, publication_id) VALUES
    ('bb46491c-dd25-492c-a035-89745ceffd6c', 'tag-editorial-design', 'pub_default'),
    ('18c6584c-385e-4340-ad06-4f3f6d4f74d4', 'tag-editorial-typo', 'pub_default'),
    ('c9c5fe2b-1d2c-46cf-88dc-5ec3b6df26d7', 'tag-editorial-arch', 'pub_default'),
    ('a1825127-6b22-4841-9152-4b37917d9501', 'tag-editorial-craft', 'pub_default');`,
];

/**
 * Seeds staging editorial content within an isolated transactional scope
 * after verifying target database identity on the exact same client connection.
 */
export async function seedEditorialContent(
  client: Pick<Client, "query">,
  options: {
    markerToken?: string;
    targetPublicationId?: string;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<void> {
  // First, verify isolation. Fails closed before any transaction or write starts.
  await verifyStagingMarker(client, options);

  // Execute inside an explicit transactional scope
  await client.query("BEGIN;");
  try {
    for (const statement of seedStatements) {
      await client.query(statement);
    }
    await client.query("COMMIT;");
  } catch (error) {
    await client.query("ROLLBACK;");
    throw error;
  }
}

export async function main() {
  const connectionString =
    process.env.DATABASE_URL || "postgresql://vibress:vibress@127.0.0.1:5433/vibress";
  const client = new Client({ connectionString });
  await client.connect();

  try {
    if (process.env.VIBRESS_PROVISION_STAGING_MARKER === "true") {
      const { markerToken } = await provisionStagingMarker(client);
      console.log(`Provisioned staging environment marker: ${markerToken}`);
    }

    console.log("Verifying staging database isolation...");
    await verifyStagingMarker(client);
    console.log("Staging database isolation verified. Seeding content...");
    await seedEditorialContent(client);
    console.log("Staging editorial content seeded successfully.");
  } finally {
    await client.end();
  }
}

const isDirectExecution = process.argv[1]?.endsWith("seed-theme-editorial-content.ts");
if (isDirectExecution) {
  main().catch((error) => {
    console.error("Editorial seeding failed:", error);
    process.exitCode = 1;
  });
}
