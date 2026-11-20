import { createHash } from "node:crypto";
import type { ApplicationId, InstallationId } from "@vibress/platform-kernel";

/**
 * C01 legacy CMS compatibility adapter.
 *
 * The legacy CMS owns its rows by `publication_id`. This adapter records an
 * additive, operator-provisioned mapping from one existing multi-publication
 * CMS installation to one versioned Application/Installation, and a bounded
 * inventory per publication. Nothing here renames publications, rewrites CMS
 * rows, derives Tenants from publications or substitutes `pub_default`.
 */

export const LEGACY_CMS_IDENTITY_PROFILE = "LEGACY_CMS_IDENTITY_V1" as const;

export interface LegacyCmsQueryable {
  query<TRow = unknown>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<{ rows: TRow[]; rowCount: number | null }>;
}

export type LegacyCmsCompatibilityCode =
  | "LEGACY_CMS_INSTALLATION_MISSING"
  | "LEGACY_CMS_INSTALLATION_MISMATCH"
  | "LEGACY_CMS_INVENTORY_DRIFT"
  | "LEGACY_CMS_IDENTITY_MISSING"
  | "LEGACY_CMS_IDENTITY_DRIFT"
  | "LEGACY_CMS_IDENTITY_CONFLICT"
  | "LEGACY_CMS_OUTBOX_INVALID";

export class LegacyCmsCompatibilityError extends Error {
  constructor(
    readonly code: LegacyCmsCompatibilityCode,
    message: string,
  ) {
    super(message);
    this.name = "LegacyCmsCompatibilityError";
  }
}

const COUNT_COLUMNS = {
  contentModels: "content_models",
  contentEntries: "content_entries",
  draftEntries: "draft_entries",
  publishedEntries: "published_entries",
  deletedEntries: "deleted_entries",
  contentTranslations: "content_translations",
  mediaAssets: "media_assets",
  mediaReferences: "media_references",
  posts: "posts",
  pages: "pages",
  revisions: "revisions",
  members: "members",
  memberships: "memberships",
  plans: "plans",
  products: "products",
  subscriptions: "subscriptions",
  billingCustomers: "billing_customers",
  scheduledNewsletterSends: "scheduled_newsletter_sends",
  outboxEvents: "outbox_events",
  delayedOutboxEvents: "delayed_outbox_events",
} as const;

export type LegacyCmsCountKey = keyof typeof COUNT_COLUMNS;
export type LegacyCmsPublicationCounts = Readonly<
  Record<LegacyCmsCountKey, number>
>;

export interface LegacyCmsPublicationInventory {
  readonly publicationId: string;
  readonly workspaceId: string;
  readonly slug: string;
  readonly primaryLocale: string;
  readonly counts: LegacyCmsPublicationCounts;
  readonly digest: string;
}

export interface LegacyCmsInventory {
  readonly profile: typeof LEGACY_CMS_IDENTITY_PROFILE;
  readonly publicationCount: number;
  readonly counts: LegacyCmsPublicationCounts;
  readonly publications: readonly LegacyCmsPublicationInventory[];
  /** Unscoped events remain global, never silently assigned to pub_default. */
  readonly unattributedOutboxEvents: number;
  readonly delayedUnattributedOutboxEvents: number;
  readonly digest: string;
}

export interface LegacyCmsMappedPublication extends LegacyCmsPublicationInventory {
  readonly installationId: InstallationId;
  readonly applicationId: ApplicationId;
  readonly legacyWorkspaceId: string;
  readonly legacySlug: string;
  readonly publicationDigest: string;
  readonly mappedAt: Date;
}

export interface LegacyCmsMapInput {
  readonly applicationId: ApplicationId;
  readonly installationId: InstallationId;
  readonly expectedInventoryDigest?: string;
}

export interface LegacyCmsMappingResult {
  readonly status: "MAPPED" | "UNCHANGED";
  readonly applicationId: ApplicationId;
  readonly installationId: InstallationId;
  readonly inventoryDigest: string;
  readonly publications: readonly LegacyCmsMappedPublication[];
}

export interface LegacyCmsVerification {
  readonly applicationId: ApplicationId;
  readonly installationId: InstallationId;
  readonly inventoryDigest: string;
  readonly publications: readonly LegacyCmsMappedPublication[];
}

const sha256 = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const readOnly = async <T>(
  db: LegacyCmsQueryable,
  read: () => Promise<T>,
): Promise<T> => {
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const result = await read();
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
};

const transactional = async <T>(
  db: LegacyCmsQueryable,
  write: () => Promise<T>,
): Promise<T> => {
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  try {
    const result = await write();
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
};

async function countMap(
  db: LegacyCmsQueryable,
  sql: string,
): Promise<Map<string, number>> {
  const { rows } = await db.query<{ publication_id: string; n: number }>(sql);
  return new Map(rows.map((row) => [row.publication_id, Number(row.n)]));
}

async function readInventory(db: LegacyCmsQueryable): Promise<LegacyCmsInventory> {
  const publications = await db.query<{
    id: string;
    workspace_id: string;
    slug: string;
    primary_locale: string;
  }>(
    "SELECT id, workspace_id, slug, primary_locale FROM publications ORDER BY id",
  );
  const models = await countMap(
    db,
    "SELECT publication_id, count(*)::int AS n FROM content_models GROUP BY publication_id",
  );
  const entries = await db.query<{
    publication_id: string;
    total: number;
    draft: number;
    published: number;
    deleted: number;
  }>(
    `SELECT publication_id, count(*)::int AS total,
       count(*) FILTER (WHERE deleted_at IS NULL AND status = 'draft')::int AS draft,
       count(*) FILTER (WHERE deleted_at IS NULL AND status = 'published')::int AS published,
       count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted
     FROM content_entries GROUP BY publication_id`,
  );
  const entryMap = new Map(
    entries.rows.map((row) => [
      row.publication_id,
      {
        total: Number(row.total),
        draft: Number(row.draft),
        published: Number(row.published),
        deleted: Number(row.deleted),
      },
    ]),
  );
  const translations = await countMap(
    db,
    "SELECT publication_id, count(*)::int AS n FROM content_translations GROUP BY publication_id",
  );
  const media = await countMap(
    db,
    "SELECT publication_id, count(*)::int AS n FROM media_assets GROUP BY publication_id",
  );
  const mediaReferences = await countMap(
    db,
    `SELECT a.publication_id, count(*)::int AS n
       FROM media_references r JOIN media_assets a ON a.id = r.media_id
      GROUP BY a.publication_id`,
  );
  const posts = await countMap(
    db,
    "SELECT publication_id, count(*)::int AS n FROM posts GROUP BY publication_id",
  );
  const pages = await countMap(
    db,
    "SELECT publication_id, count(*)::int AS n FROM pages GROUP BY publication_id",
  );
  const revisions = await countMap(
    db,
    `SELECT publication_id, count(*)::int AS n FROM (
       SELECT p.publication_id FROM revisions r
         JOIN posts p ON r.resource_type = 'post' AND p.id = r.resource_id
       UNION ALL
       SELECT g.publication_id FROM revisions r
         JOIN pages g ON r.resource_type = 'page' AND g.id = r.resource_id
     ) owned GROUP BY publication_id`,
  );
  const members = await countMap(
    db,
    "SELECT publication_id, count(*)::int AS n FROM members GROUP BY publication_id",
  );
  const memberships = await countMap(
    db,
    "SELECT publication_id, count(*)::int AS n FROM publication_memberships GROUP BY publication_id",
  );
  const plans = await countMap(
    db,
    "SELECT publication_id, count(*)::int AS n FROM plans GROUP BY publication_id",
  );
  const products = await countMap(
    db,
    "SELECT publication_id, count(*)::int AS n FROM products GROUP BY publication_id",
  );
  const subscriptions = await countMap(
    db,
    `SELECT m.publication_id, count(*)::int AS n
       FROM subscriptions s JOIN members m ON m.id = s.member_id
      GROUP BY m.publication_id`,
  );
  const billingCustomers = await countMap(
    db,
    `SELECT m.publication_id, count(*)::int AS n
       FROM billing_customers c JOIN members m ON m.id = c.member_id
      GROUP BY m.publication_id`,
  );
  const scheduledSends = await countMap(
    db,
    `SELECT publication_id, count(*)::int AS n FROM newsletter_sends
      WHERE scheduled_at IS NOT NULL GROUP BY publication_id`,
  );
  // Read-only, SQL-grouped classification of legacy flat and v1 envelopes.
  // No event rows, statuses or delivery semantics are ever rewritten.
  const outbox = await db.query<{
    format: string;
    publication_id: string | null;
    n: number;
    delayed: number;
    sample_id: string;
  }>(
    `WITH classified AS (
      SELECT id,status,available_after,
        CASE
          WHEN jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN 'malformed'
          WHEN payload ? 'version' OR payload ? 'eventType' THEN
            CASE
              WHEN payload->'version' IS DISTINCT FROM '1'::jsonb THEN 'unsupported_version'
              WHEN jsonb_typeof(payload->'eventType') IS DISTINCT FROM 'string'
                OR payload->>'eventType' IS DISTINCT FROM event_type
                OR jsonb_typeof(payload->'payload') IS DISTINCT FROM 'object' THEN 'malformed'
              WHEN (payload ? 'publicationId' AND jsonb_typeof(payload->'publicationId') IS DISTINCT FROM 'string')
                OR (payload->'payload' ? 'publicationId' AND jsonb_typeof(payload->'payload'->'publicationId') IS DISTINCT FROM 'string') THEN 'malformed'
              WHEN event_type NOT IN ('post.published','post.unpublished','post.deleted',
                'm03.resource.created','m03.resource.updated','m03.resource.deleted') THEN 'unknown_event_type'
              WHEN payload ? 'publicationId'
                AND payload->>'publicationId' IS DISTINCT FROM payload->'payload'->>'publicationId' THEN 'ambiguous'
              ELSE 'envelope'
            END
          WHEN payload ? 'publicationId' AND jsonb_typeof(payload->'publicationId') IS DISTINCT FROM 'string'
            THEN 'malformed'
          ELSE 'flat'
        END AS format,
        CASE WHEN payload ? 'version' OR payload ? 'eventType'
          THEN payload->'payload'->>'publicationId'
          ELSE payload->>'publicationId' END AS publication_id
      FROM outbox_events
    )
    SELECT format,publication_id,count(*)::int AS n,
      count(*) FILTER (WHERE status='pending' AND available_after IS NOT NULL)::int AS delayed,
      min(id) AS sample_id
    FROM classified GROUP BY format,publication_id ORDER BY format,publication_id`,
  );
  const outboxMap = new Map<string,{total:number;delayed:number}>();
  const knownPublications = new Set(publications.rows.map(row=>row.id));
  const unattributed = {total:0,delayed:0};
  for(const row of outbox.rows){
    if(row.format!=="flat"&&row.format!=="envelope"){
      throw new LegacyCmsCompatibilityError("LEGACY_CMS_OUTBOX_INVALID",
        "Outbox "+row.format+" at id '"+row.sample_id+"' requires operator classification");
    }
    if(row.publication_id===null){
      unattributed.total+=Number(row.n);
      unattributed.delayed+=Number(row.delayed);
      continue;
    }
    if(!row.publication_id.trim()||!knownPublications.has(row.publication_id)){
      throw new LegacyCmsCompatibilityError("LEGACY_CMS_OUTBOX_INVALID",
        "Outbox publication ownership is unknown at id '"+row.sample_id+"'");
    }
    const previous=outboxMap.get(row.publication_id)??{total:0,delayed:0};
    outboxMap.set(row.publication_id,{
      total:previous.total+Number(row.n),
      delayed:previous.delayed+Number(row.delayed),
    });
  }

  const countsFor = (publicationId: string): LegacyCmsPublicationCounts => {
    const entry = entryMap.get(publicationId);
    const event = outboxMap.get(publicationId);
    return {
      contentModels: models.get(publicationId) ?? 0,
      contentEntries: entry?.total ?? 0,
      draftEntries: entry?.draft ?? 0,
      publishedEntries: entry?.published ?? 0,
      deletedEntries: entry?.deleted ?? 0,
      contentTranslations: translations.get(publicationId) ?? 0,
      mediaAssets: media.get(publicationId) ?? 0,
      mediaReferences: mediaReferences.get(publicationId) ?? 0,
      posts: posts.get(publicationId) ?? 0,
      pages: pages.get(publicationId) ?? 0,
      revisions: revisions.get(publicationId) ?? 0,
      members: members.get(publicationId) ?? 0,
      memberships: memberships.get(publicationId) ?? 0,
      plans: plans.get(publicationId) ?? 0,
      products: products.get(publicationId) ?? 0,
      subscriptions: subscriptions.get(publicationId) ?? 0,
      billingCustomers: billingCustomers.get(publicationId) ?? 0,
      scheduledNewsletterSends: scheduledSends.get(publicationId) ?? 0,
      outboxEvents: event?.total ?? 0,
      delayedOutboxEvents: event?.delayed ?? 0,
    };
  };

  const inventory: LegacyCmsPublicationInventory[] = publications.rows.map(
    (publication) => {
      const counts = countsFor(publication.id);
      return {
        publicationId: publication.id,
        workspaceId: publication.workspace_id,
        slug: publication.slug,
        primaryLocale: publication.primary_locale,
        counts,
        digest: sha256({
          profile: LEGACY_CMS_IDENTITY_PROFILE,
          publicationId: publication.id,
          workspaceId: publication.workspace_id,
          slug: publication.slug,
          primaryLocale: publication.primary_locale,
          counts,
        }),
      };
    },
  );

  const totals = totalCounts(inventory);
  return {
    profile: LEGACY_CMS_IDENTITY_PROFILE,
    publicationCount: inventory.length,
    counts: totals,
    publications: inventory,
    unattributedOutboxEvents: unattributed.total,
    delayedUnattributedOutboxEvents: unattributed.delayed,
    digest: sha256({
      profile: LEGACY_CMS_IDENTITY_PROFILE,
      publicationCount: inventory.length,
      counts: totals,
      publications: inventory.map((publication) => ({
        publicationId: publication.publicationId,
        digest: publication.digest,
      })),
      ...(unattributed.total>0?{
        unattributedOutboxEvents:unattributed.total,
        delayedUnattributedOutboxEvents:unattributed.delayed,
      }:{}),
    }),
  };
}

function totalCounts(
  publications: readonly LegacyCmsPublicationInventory[],
): LegacyCmsPublicationCounts {
  const totals = Object.fromEntries(
    Object.keys(COUNT_COLUMNS).map((key) => [key, 0]),
  ) as Record<LegacyCmsCountKey, number>;
  for (const publication of publications) {
    for (const key of Object.keys(COUNT_COLUMNS) as LegacyCmsCountKey[]) {
      totals[key] += publication.counts[key];
    }
  }
  return totals;
}

const selectMapping = `
  SELECT p.publication_id, p.installation_id, p.application_id,
         p.legacy_workspace_id, p.legacy_slug, p.primary_locale,
         ${Object.values(COUNT_COLUMNS).map((column) => `p.${column}`).join(", ")},
         p.publication_digest, p.mapped_at
    FROM platform_legacy_cms_publications p`;

interface MappingRow {
  publication_id: string;
  installation_id: string;
  application_id: string;
  legacy_workspace_id: string;
  legacy_slug: string;
  primary_locale: string;
  publication_digest: string;
  mapped_at: Date;
  [column: string]: unknown;
}

function countsFromColumns(row: Record<string, unknown>): LegacyCmsPublicationCounts {
  return Object.fromEntries(
    (Object.entries(COUNT_COLUMNS) as [LegacyCmsCountKey, string][]).map(
      ([key, column]) => [key, Number(row[column] ?? 0)],
    ),
  ) as Record<LegacyCmsCountKey, number>;
}

function toMappedPublication(row: MappingRow): LegacyCmsMappedPublication {
  const counts = countsFromColumns(row);
  return {
    publicationId: row.publication_id,
    workspaceId: row.legacy_workspace_id,
    slug: row.legacy_slug,
    primaryLocale: row.primary_locale,
    counts,
    digest: row.publication_digest,
    publicationDigest: row.publication_digest,
    installationId: row.installation_id as InstallationId,
    applicationId: row.application_id as ApplicationId,
    legacyWorkspaceId: row.legacy_workspace_id,
    legacySlug: row.legacy_slug,
    mappedAt: row.mapped_at,
  };
}

async function readMappingRows(
  db: LegacyCmsQueryable,
  installationId: InstallationId,
): Promise<LegacyCmsMappedPublication[]> {
  const { rows } = await db.query<MappingRow>(
    `${selectMapping} WHERE p.installation_id = $1 ORDER BY p.publication_id`,
    [installationId],
  );
  return rows.map(toMappedPublication);
}

export async function readLegacyCmsPublicationMapping(
  db: LegacyCmsQueryable,
  input: { readonly installationId: InstallationId },
): Promise<readonly LegacyCmsMappedPublication[]> {
  return readMappingRows(db, input.installationId);
}

export async function inventoryLegacyCms(
  db: LegacyCmsQueryable,
): Promise<LegacyCmsInventory> {
  return readOnly(db, () => readInventory(db));
}

const sameCounts = (
  left: LegacyCmsPublicationCounts,
  right: LegacyCmsPublicationCounts,
): boolean =>
  (Object.keys(COUNT_COLUMNS) as LegacyCmsCountKey[]).every(
    (key) => left[key] === right[key],
  );

const assertMappingMatches = (
  rows: readonly LegacyCmsMappedPublication[],
  inventory: LegacyCmsInventory,
  installationId: InstallationId,
  applicationId: ApplicationId,
): void => {
  const byId = new Map(rows.map((row) => [row.publicationId, row]));
  if (byId.size !== inventory.publications.length) {
    throw new LegacyCmsCompatibilityError(
      "LEGACY_CMS_IDENTITY_DRIFT",
      "Mapped publication set no longer matches the CMS inventory",
    );
  }
  for (const publication of inventory.publications) {
    const row = byId.get(publication.publicationId);
    if (
      !row ||
      row.installationId !== installationId ||
      row.applicationId !== applicationId ||
      row.publicationDigest !== publication.digest ||
      !sameCounts(row.counts, publication.counts) ||
      row.legacyWorkspaceId !== publication.workspaceId ||
      row.legacySlug !== publication.slug ||
      row.primaryLocale !== publication.primaryLocale
    ) {
      throw new LegacyCmsCompatibilityError(
        "LEGACY_CMS_IDENTITY_DRIFT",
        `Publication '${publication.publicationId}' no longer matches its recorded identity inventory`,
      );
    }
  }
};

export async function mapLegacyCmsIdentity(
  db: LegacyCmsQueryable,
  input: LegacyCmsMapInput,
): Promise<LegacyCmsMappingResult> {
  return transactional(db, async () => {
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('platform_legacy_cms_identity_v1'))",
    );
    const installation = await db.query<{ application_id: string }>(
      "SELECT application_id FROM platform_installations WHERE id = $1",
      [input.installationId],
    );
    const registered = installation.rows[0];
    if (!registered) {
      throw new LegacyCmsCompatibilityError(
        "LEGACY_CMS_INSTALLATION_MISSING",
        `Installation '${input.installationId}' is not registered`,
      );
    }
    if (registered.application_id !== input.applicationId) {
      throw new LegacyCmsCompatibilityError(
        "LEGACY_CMS_INSTALLATION_MISMATCH",
        `Installation '${input.installationId}' belongs to application '${registered.application_id}'`,
      );
    }

    const inventory = await readInventory(db);
    if (
      input.expectedInventoryDigest !== undefined &&
      input.expectedInventoryDigest !== inventory.digest
    ) {
      throw new LegacyCmsCompatibilityError(
        "LEGACY_CMS_INVENTORY_DRIFT",
        "The CMS inventory changed since the expected digest was captured",
      );
    }

    const existing = await db.query<{
      installation_id: string;
      application_id: string;
      inventory_digest: string;
      publication_count: number;
    }>(
      `SELECT installation_id, application_id, inventory_digest, publication_count,
              ${Object.values(COUNT_COLUMNS).join(", ")}
         FROM platform_legacy_cms_installations
        WHERE installation_id = $1 OR application_id = $2`,
      [input.installationId, input.applicationId],
    );
    const binding = existing.rows[0];
    if (binding) {
      if (
        binding.installation_id !== input.installationId ||
        binding.application_id !== input.applicationId
      ) {
        throw new LegacyCmsCompatibilityError(
          "LEGACY_CMS_IDENTITY_CONFLICT",
          "This application or installation is already bound to a different legacy CMS identity",
        );
      }
      if (binding.inventory_digest !== inventory.digest) {
        throw new LegacyCmsCompatibilityError(
          "LEGACY_CMS_IDENTITY_DRIFT",
          "The CMS inventory no longer matches the recorded mapping; operator review is required",
        );
      }
      const rows = await readMappingRows(db, input.installationId);
      if (Number(binding.publication_count) !== inventory.publicationCount) {
        throw new LegacyCmsCompatibilityError(
          "LEGACY_CMS_IDENTITY_DRIFT",
          "Mapped publication count no longer matches the CMS inventory",
        );
      }
      if (
        !sameCounts(
          countsFromColumns(binding as unknown as Record<string, unknown>),
          inventory.counts,
        )
      ) {
        throw new LegacyCmsCompatibilityError(
          "LEGACY_CMS_IDENTITY_DRIFT",
          "Mapped installation totals no longer match the CMS inventory",
        );
      }
      assertMappingMatches(
        rows,
        inventory,
        input.installationId,
        input.applicationId,
      );
      return {
        status: "UNCHANGED" as const,
        applicationId: input.applicationId,
        installationId: input.installationId,
        inventoryDigest: inventory.digest,
        publications: rows,
      };
    }

    const totals = inventory.counts;
    const columns = Object.values(COUNT_COLUMNS);
    await db.query(
      `INSERT INTO platform_legacy_cms_installations
         (installation_id, application_id, profile, publication_count,
          ${columns.join(", ")}, inventory_digest, mapped_by)
       VALUES ($1, $2, $3, $4, ${columns
         .map((_, index) => `$${index + 5}`)
         .join(", ")}, $${columns.length + 5}, current_user)`,
      [
        input.installationId,
        input.applicationId,
        LEGACY_CMS_IDENTITY_PROFILE,
        inventory.publicationCount,
        ...(Object.keys(COUNT_COLUMNS) as LegacyCmsCountKey[]).map(
          (key) => totals[key],
        ),
        inventory.digest,
      ],
    );
    for (const publication of inventory.publications) {
      await db.query(
        `INSERT INTO platform_legacy_cms_publications
           (publication_id, installation_id, application_id, legacy_workspace_id,
            legacy_slug, primary_locale, ${columns.join(", ")}, publication_digest)
         VALUES ($1, $2, $3, $4, $5, $6, ${columns
           .map((_, index) => `$${index + 7}`)
           .join(", ")}, $${columns.length + 7})`,
        [
          publication.publicationId,
          input.installationId,
          input.applicationId,
          publication.workspaceId,
          publication.slug,
          publication.primaryLocale,
          ...(Object.keys(COUNT_COLUMNS) as LegacyCmsCountKey[]).map(
            (key) => publication.counts[key],
          ),
          publication.digest,
        ],
      );
    }
    const rows = await readMappingRows(db, input.installationId);
    return {
      status: "MAPPED" as const,
      applicationId: input.applicationId,
      installationId: input.installationId,
      inventoryDigest: inventory.digest,
      publications: rows,
    };
  });
}

export async function verifyLegacyCmsIdentityMapping(
  db: LegacyCmsQueryable,
  input: { readonly applicationId: ApplicationId; readonly installationId: InstallationId },
): Promise<LegacyCmsVerification> {
  return readOnly(db, async () => {
    const installation = await db.query<{ application_id: string }>(
      "SELECT application_id FROM platform_installations WHERE id = $1",
      [input.installationId],
    );
    const registered = installation.rows[0];
    if (!registered) {
      throw new LegacyCmsCompatibilityError(
        "LEGACY_CMS_INSTALLATION_MISSING",
        `Installation '${input.installationId}' is not registered`,
      );
    }
    if (registered.application_id !== input.applicationId) {
      throw new LegacyCmsCompatibilityError(
        "LEGACY_CMS_INSTALLATION_MISMATCH",
        `Installation '${input.installationId}' belongs to application '${registered.application_id}'`,
      );
    }
    const binding = await db.query<{
      installation_id: string;
      application_id: string;
      inventory_digest: string;
      publication_count: number;
    }>(
      `SELECT installation_id, application_id, inventory_digest, publication_count,
              ${Object.values(COUNT_COLUMNS).join(", ")}
         FROM platform_legacy_cms_installations WHERE installation_id = $1`,
      [input.installationId],
    );
    const row = binding.rows[0];
    if (!row) {
      throw new LegacyCmsCompatibilityError(
        "LEGACY_CMS_IDENTITY_MISSING",
        `Installation '${input.installationId}' has no legacy CMS identity mapping`,
      );
    }
    const inventory = await readInventory(db);
    if (
      row.inventory_digest !== inventory.digest ||
      Number(row.publication_count) !== inventory.publicationCount ||
      !sameCounts(
        countsFromColumns(row as unknown as Record<string, unknown>),
        inventory.counts,
      )
    ) {
      throw new LegacyCmsCompatibilityError(
        "LEGACY_CMS_IDENTITY_DRIFT",
        "The CMS inventory no longer matches the recorded mapping digest",
      );
    }
    const rows = await readMappingRows(db, input.installationId);
    assertMappingMatches(rows, inventory, input.installationId, input.applicationId);
    return {
      applicationId: input.applicationId,
      installationId: input.installationId,
      inventoryDigest: inventory.digest,
      publications: rows,
    };
  });
}
