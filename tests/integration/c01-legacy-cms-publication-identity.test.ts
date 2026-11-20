// @vitest-environment node
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asApplicationId,
  asInstallationId,
  asPrincipalId,
  asTenantId,
  LEGACY_PUBLICATION_FALLBACK,
} from "@vibress/platform-kernel";
import { verifyTenantScope } from "@vibress/tenancy";
import { createDefaultStudioDocument } from "../../packages/studio-core/src";
import { writeScopedOutboxEvent } from "../../packages/events/src/scoped-outbox";
import {
  inventoryLegacyCms,
  mapLegacyCmsIdentity,
  readLegacyCmsPublicationMapping,
  verifyLegacyCmsIdentityMapping,
} from "../../packages/database/src/legacy-cms-compatibility";

const baseUrl =
  process.env.DATABASE_URL ??
  "postgresql://vibress:vibress@127.0.0.1:5434/vibress";
const suffix = randomBytes(4).toString("hex");
const databaseName = `vibress_c01_${suffix}`;
const runtimeRole = `c01_runtime_${suffix}`;
const runtimePassword = randomBytes(18).toString("hex");
const applicationId = asApplicationId(`app-cms-${suffix}`);
const installationId = asInstallationId(`installation-cms-${suffix}`);
const otherApplication = asApplicationId(`app-cms-other-${suffix}`);
const otherInstallation = asInstallationId(`installation-cms-other-${suffix}`);
const migrationsFolder = path.join(process.cwd(), "packages/database/migrations");

const studioDocument = JSON.stringify(createDefaultStudioDocument("Hello world"));

function urlFor(database: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

async function connect(database: string, role?: string): Promise<Client> {
  const url = new URL(urlFor(database));
  if (role) {
    url.username = role;
    url.password = runtimePassword;
  }
  const client = new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 4000,
  });
  await client.connect();
  return client;
}

async function applyJournalMigrations(client: Client): Promise<void> {
  const journal = JSON.parse(
    readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    const sql = readFileSync(
      path.join(migrationsFolder, `${entry.tag}.sql`),
      "utf8",
    );
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.query(statement);
    }
  }
}

let admin: Client;
let cms: Client;
let runtime: Client | undefined;

async function seedLegacyCms(client: Client): Promise<void> {
  const q = (sql: string, values: unknown[] = []) => client.query(sql, values);
  await q(
    `INSERT INTO users (id, email, name, password_hash) VALUES
       ('u_owner', 'owner@example.test', 'Owner', 'x'),
       ('u_editor', 'editor@example.test', 'Editor', 'x'),
       ('u_beta', 'beta@example.test', 'Beta Author', 'x')`,
  );
  await q(
    `INSERT INTO workspaces (id, name, slug) VALUES ('ws_alpha', 'Alpha Workspace', 'alpha')`,
  );
  await q(
    `INSERT INTO publications (id, workspace_id, name, slug, primary_locale) VALUES
       ('pub_alpha', 'ws_alpha', 'Alpha', 'alpha', 'en'),
       ('pub_beta', 'ws_alpha', 'Beta', 'beta', 'en')`,
  );
  await q(
    `INSERT INTO publication_locales (id, publication_id, locale, is_default) VALUES
       ('loc_a_en', 'pub_alpha', 'en', true),
       ('loc_a_ar', 'pub_alpha', 'ar', false),
       ('loc_b_en', 'pub_beta', 'en', true)`,
  );
  await q(
    `INSERT INTO publication_memberships (id, publication_id, user_id, role) VALUES
       ('pm_a_owner', 'pub_alpha', 'u_owner', 'owner'),
       ('pm_a_editor', 'pub_alpha', 'u_editor', 'editor'),
       ('pm_b_owner', 'pub_beta', 'u_beta', 'owner'),
       ('pm_d_editor', 'pub_default', 'u_editor', 'viewer')`,
  );
  await q(
    `INSERT INTO content_models (id, name, slug, fields, publication_id) VALUES
       ('cm_alpha', 'Article', 'article',
        '[{"id":"related","type":"relation","target":"content_entries"},{"id":"category","type":"text"}]'::jsonb,
        'pub_alpha'),
       ('cm_beta', 'Article', 'article', '[{"id":"category","type":"text"}]'::jsonb, 'pub_beta')`,
  );
  await q(
    `INSERT INTO content_entries
       (id, model_id, title, slug, data, status, version, created_by, updated_by, published_at, publication_id, deleted_at)
     VALUES
       ('ce_a1', 'cm_alpha', 'Published entry', 'shared-slug',
        '{"category":"news","related":["ce_a2"]}'::jsonb, 'published', 2, 'u_owner', 'u_owner', now(), 'pub_alpha', NULL),
       ('ce_a2', 'cm_alpha', 'Draft entry', 'draft-entry',
        '{"category":"docs"}'::jsonb, 'draft', 1, 'u_owner', 'u_editor', NULL, 'pub_alpha', NULL),
       ('ce_a3', 'cm_alpha', 'Deleted entry', 'deleted-entry',
        '{}'::jsonb, 'draft', 1, 'u_owner', 'u_owner', NULL, 'pub_alpha', now()),
       ('ce_b1', 'cm_beta', 'Beta entry', 'shared-slug',
        '{"category":"beta"}'::jsonb, 'published', 3, 'u_beta', 'u_beta', now(), 'pub_beta', NULL)`,
  );
  await q(
    `INSERT INTO content_translations
       (id, content_type, content_id, source_locale, target_locale, title, slug, content, status, publication_id)
     VALUES
       ('tr_a1', 'content_entry', 'ce_a1', 'en', 'ar', 'مدخل منشور', 'madkhal', '{"blocks":[]}'::jsonb, 'published', 'pub_alpha'),
       ('tr_a2', 'content_entry', 'ce_a2', 'en', 'ar', 'مسودة', 'musawada', '{"blocks":[]}'::jsonb, 'draft', 'pub_alpha'),
       ('tr_b1', 'content_entry', 'ce_b1', 'en', 'ar', 'بيتا', 'beta-ar', '{"blocks":[]}'::jsonb, 'published', 'pub_beta')`,
  );
  await q(
    `INSERT INTO media_assets
       (id, storage_key, original_filename, display_name, mime_type, extension, size_bytes, checksum, asset_type, uploaded_by, publication_id)
     VALUES
       ('ma_a1', 'alpha/logo.png', 'logo.png', 'Alpha logo', 'image/png', 'png', 10, 'sum-a1', 'image', 'u_owner', 'pub_alpha'),
       ('ma_a2', 'alpha/og.jpg', 'og.jpg', 'Alpha OG', 'image/jpeg', 'jpg', 20, 'sum-a2', 'image', 'u_owner', 'pub_alpha'),
       ('ma_b1', 'beta/logo.png', 'logo.png', 'Beta logo', 'image/png', 'png', 30, 'sum-b1', 'image', 'u_beta', 'pub_beta')`,
  );
  await q(
    `INSERT INTO posts
       (id, title, slug, content, content_version, status, version, primary_author_id, created_by, updated_by, published_by, published_at, publication_id, feature_image_id)
     VALUES
       ('post_a1', 'Hello', 'hello', $1::jsonb, 1, 'published', 2, 'u_owner', 'u_owner', 'u_owner', 'u_owner', now(), 'pub_alpha', 'ma_a1'),
       ('post_a2', 'Draft', 'draft', $1::jsonb, 1, 'draft', 1, 'u_owner', 'u_owner', 'u_owner', NULL, NULL, 'pub_alpha', NULL),
       ('post_b1', 'Hello', 'hello', $1::jsonb, 1, 'published', 4, 'u_beta', 'u_beta', 'u_beta', 'u_beta', now(), 'pub_beta', 'ma_b1')`,
    [studioDocument],
  );
  await q(
    `INSERT INTO pages
       (id, title, slug, content, content_version, status, version, primary_author_id, created_by, updated_by, publication_id)
     VALUES ('page_a1', 'About', 'about', $1::jsonb, 1, 'draft', 1, 'u_owner', 'u_owner', 'u_owner', 'pub_alpha')`,
    [studioDocument],
  );
  await q(
    `INSERT INTO revisions (id, resource_type, resource_id, revision_number, title, slug, content, created_by)
     VALUES
       ('rev_a1', 'post', 'post_a1', 1, 'Hello', 'hello', $1::jsonb, 'u_owner'),
       ('rev_a2', 'post', 'post_a1', 2, 'Hello', 'hello', $1::jsonb, 'u_owner'),
       ('rev_b1', 'post', 'post_b1', 1, 'Hello', 'hello', $1::jsonb, 'u_beta')`,
    [studioDocument],
  );
  await q(
    `INSERT INTO media_references (id, media_id, resource_type, resource_id, field_path) VALUES
       ('mr_a1', 'ma_a1', 'post', 'post_a1', 'feature_image'),
       ('mr_b1', 'ma_b1', 'post', 'post_b1', 'feature_image')`,
  );
  await q(
    `INSERT INTO members (id, email, email_normalized, name, publication_id) VALUES
       ('mem_a1', 'shared@example.test', 'shared@example.test', 'Alpha Member', 'pub_alpha'),
       ('mem_a2', 'second@example.test', 'second@example.test', 'Second Member', 'pub_alpha'),
       ('mem_b1', 'shared@example.test', 'shared@example.test', 'Beta Member', 'pub_beta')`,
  );
  await q(
    `INSERT INTO products (id, key, name, publication_id) VALUES
       ('prod_a1', 'pro', 'Pro', 'pub_alpha'),
       ('prod_b1', 'free', 'Free', 'pub_beta')`,
  );
  await q(
    `INSERT INTO plans (id, product_id, key, name, currency, amount_minor, publication_id) VALUES
       ('plan_a1', 'prod_a1', 'monthly', 'Monthly', 'USD', 1000, 'pub_alpha'),
       ('plan_b1', 'prod_b1', 'free', 'Free', 'USD', 0, 'pub_beta')`,
  );
  await q(
    `INSERT INTO subscriptions
       (id, member_id, product_id, plan_id, provider, provider_subscription_id, status, currency, amount_minor, billing_interval)
     VALUES ('sub_a1', 'mem_a1', 'prod_a1', 'plan_a1', 'stripe', 'sub_provider_a1', 'active', 'USD', 1000, 'month')`,
  );
  await q(
    `INSERT INTO billing_customers (id, member_id, provider, provider_customer_id) VALUES
       ('bc_a1', 'mem_a1', 'stripe', 'cus_a1')`,
  );
  await q(
    `INSERT INTO newsletters (id, key, name, sender_name, sender_email, publication_id) VALUES
       ('nl_a1', 'weekly', 'Weekly', 'Alpha', 'alpha@example.test', 'pub_alpha'),
       ('nl_b1', 'weekly', 'Weekly', 'Beta', 'beta@example.test', 'pub_beta')`,
  );
  await q(
    `INSERT INTO newsletter_sends
       (id, newsletter_id, subject, content, sender_name, sender_email, audience, scheduled_at, status, publication_id)
     VALUES ('ns_a1', 'nl_a1', 'Weekly digest', '{"blocks":[]}'::jsonb, 'Alpha', 'alpha@example.test',
             '{"kind":"all"}'::jsonb, now() + interval '1 day', 'scheduled', 'pub_alpha')`,
  );
  await q(
    `INSERT INTO outbox_events (id, event_type, payload, status, available_after) VALUES
       ('ob_a1', 'content_entry.published', '{"publicationId":"pub_alpha","entryId":"ce_a1"}'::jsonb, 'pending', now() + interval '1 hour'),
       ('ob_b1', 'content_entry.published', '{"publicationId":"pub_beta","entryId":"ce_b1"}'::jsonb, 'pending', NULL),
       ('ob_d1', 'content_entry.published', '{"publicationId":"pub_default","entryId":"legacy"}'::jsonb, 'pending', NULL),
       ('ob_e_a1', 'post.published', '{"version":1,"eventType":"post.published","payload":{"publicationId":"pub_alpha","postId":"post_a1","title":"Hello","slug":"hello"}}'::jsonb, 'pending', now() + interval '2 hours'),
       ('ob_e_b1', 'post.deleted', '{"version":1,"eventType":"post.deleted","payload":{"publicationId":"pub_beta","postId":"post_b1"}}'::jsonb, 'delivered', NULL),
       ('ob_e_d1', 'post.unpublished', '{"version":1,"eventType":"post.unpublished","payload":{"publicationId":"pub_default","postId":"post_d1","slug":"draft"}}'::jsonb, 'pending', NULL),
       ('ob_global', 'post.published', '{"version":1,"eventType":"post.published","payload":{"postId":"post_a1","title":"Hello","slug":"hello"}}'::jsonb, 'pending', NULL)`,
  );
}

beforeAll(async () => {
  admin = await connect("postgres");
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  cms = await connect(databaseName);
  await applyJournalMigrations(cms);
  await admin.query(
    `CREATE ROLE "${runtimeRole}" LOGIN PASSWORD '${runtimePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  );
  await seedLegacyCms(cms);
  await cms.query(
    `INSERT INTO platform_applications (id, name) VALUES ($1, 'CMS legacy'),
       ($2, 'Unrelated application')`,
    [applicationId, otherApplication],
  );
  await cms.query(
    `INSERT INTO platform_installations (id, application_id, environment) VALUES
       ($1, $2, 'test'), ($3, $4, 'test')`,
    [installationId, applicationId, otherInstallation, otherApplication],
  );
}, 120000);

afterAll(async () => {
  try {
    await runtime?.end();
    await cms?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS "${runtimeRole}"`);
  } finally {
    await admin?.end();
  }
});

describe("C01 legacy CMS additive application/installation identity", () => {
  it("inventories publications as independent business concepts with no implicit pub_default substitution", async () => {
    const inventory = await inventoryLegacyCms(cms);
    expect(inventory.profile).toBe("LEGACY_CMS_IDENTITY_V1");
    expect(inventory.publicationCount).toBe(3);
    expect(inventory.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(inventory.unattributedOutboxEvents).toBe(1);
    expect(inventory.delayedUnattributedOutboxEvents).toBe(0);
    const byId = new Map(
      inventory.publications.map((publication) => [
        publication.publicationId,
        publication,
      ]),
    );
    expect([...byId.keys()].sort()).toEqual([
      "pub_alpha",
      "pub_beta",
      "pub_default",
    ]);
    expect(byId.get("pub_alpha")).toMatchObject({
      workspaceId: "ws_alpha",
      slug: "alpha",
      primaryLocale: "en",
      counts: {
        contentModels: 1,
        contentEntries: 3,
        draftEntries: 1,
        publishedEntries: 1,
        deletedEntries: 1,
        contentTranslations: 2,
        mediaAssets: 2,
        mediaReferences: 1,
        posts: 2,
        pages: 1,
        revisions: 2,
        members: 2,
        memberships: 2,
        plans: 1,
        products: 1,
        subscriptions: 1,
        billingCustomers: 1,
        scheduledNewsletterSends: 1,
        outboxEvents: 2,
        delayedOutboxEvents: 2,
      },
    });
    expect(byId.get("pub_beta")?.counts).toMatchObject({
      contentEntries: 1,
      posts: 1,
      members: 1,
      subscriptions: 0,
      outboxEvents: 2,
      delayedOutboxEvents: 0,
    });
    expect(byId.get("pub_default")?.counts).toMatchObject({
      contentModels: 0,
      posts: 0,
      memberships: 1,
      outboxEvents: 2,
      delayedOutboxEvents: 0,
    });
    expect(byId.get("pub_alpha")!.digest).not.toBe(
      byId.get("pub_beta")!.digest,
    );
    const catalog = await cms.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('publications', 'content_entries', 'posts', 'members')
          AND column_name IN ('application_id', 'tenant_id')`,
    );
    expect(catalog.rows[0]!.count).toBe("0");
  }, 30000);

  it("classifies mixed outbox formats, preserves identities and rejects bad owners",async()=>{
    const before=await inventoryLegacyCms(cms);
    expect(before.counts.outboxEvents).toBe(6);
    expect(before.unattributedOutboxEvents).toBe(1);
    const preserved=await cms.query("SELECT id,payload,status FROM outbox_events ORDER BY id");
    // The current writer's ON CONFLICT is insertion-idempotent, not delivery
    // exactly-once; replay must not rewrite an existing versioned payload.
    await writeScopedOutboxEvent(cms,{
      id:"ob_e_a1",eventType:"post.published",payload:{postId:"post_a1",title:"Hello",slug:"hello"},
    });
    expect((await inventoryLegacyCms(cms)).digest).toBe(before.digest);
    expect((await cms.query("SELECT id,payload,status FROM outbox_events ORDER BY id")).rows).toEqual(preserved.rows);
    const rejected=[
      {id:"ob_bad_version",event:"post.published",payload:{version:2,eventType:"post.published",payload:{publicationId:"pub_alpha"}}},
      {id:"ob_bad_mismatch",event:"post.published",payload:{version:1,eventType:"post.deleted",payload:{publicationId:"pub_alpha"}}},
      {id:"ob_bad_unknown_type",event:"custom.unregistered",payload:{version:1,eventType:"custom.unregistered",payload:{publicationId:"pub_alpha"}}},
      {id:"ob_bad_ambiguous",event:"post.published",payload:{version:1,eventType:"post.published",publicationId:"pub_alpha",payload:{publicationId:"pub_beta"}}},
      {id:"ob_bad_unknown",event:"post.published",payload:{publicationId:"pub_unknown"}},
      {id:"ob_bad_malformed",event:"post.published",payload:{publicationId:15}},
    ];
    for(const item of rejected){
      await cms.query("INSERT INTO outbox_events (id,event_type,payload,status,attempts) VALUES($1,$2,$3::jsonb,'pending',0)",[item.id,item.event,JSON.stringify(item.payload)]);
      try{
        await expect(inventoryLegacyCms(cms)).rejects.toMatchObject({code:"LEGACY_CMS_OUTBOX_INVALID"});
      }finally{
        await cms.query("DELETE FROM outbox_events WHERE id=$1",[item.id]);
      }
    }
    expect((await inventoryLegacyCms(cms)).digest).toBe(before.digest);
    console.info("M03_213_02_MIXED_OUTBOX_INVENTORY_AND_REPLAY=PASS");
  },60000);

  it("maps the installation additively, idempotently and without rewriting CMS rows", async () => {
    const before = await inventoryLegacyCms(cms);
    const first = await mapLegacyCmsIdentity(cms, {
      applicationId,
      installationId,
      expectedInventoryDigest: before.digest,
    });
    expect(first.status).toBe("MAPPED");
    expect(first.inventoryDigest).toBe(before.digest);
    const rows = await readLegacyCmsPublicationMapping(cms, { installationId });
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.publicationId).sort()).toEqual([
      "pub_alpha",
      "pub_beta",
      "pub_default",
    ]);
    expect(rows.find((row) => row.publicationId === "pub_alpha")).toMatchObject(
      {
        installationId,
        applicationId,
        legacyWorkspaceId: "ws_alpha",
        legacySlug: "alpha",
        primaryLocale: "en",
        counts: { contentEntries: 3, posts: 2, members: 2 },
      },
    );
    const binding = await cms.query<{
      publication_count: number;
      inventory_digest: string;
      mapped_by: string;
    }>(
      `SELECT publication_count, inventory_digest, mapped_by
         FROM platform_legacy_cms_installations WHERE installation_id = $1`,
      [installationId],
    );
    expect(binding.rows[0]).toMatchObject({
      publication_count: 3,
      inventory_digest: before.digest,
    });
    expect(binding.rows[0]!.mapped_by.length).toBeGreaterThan(0);
    const after = await inventoryLegacyCms(cms);
    expect(after.digest).toBe(before.digest);
    expect(
      (
        await cms.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM content_entries",
        )
      ).rows[0]!.n,
    ).toBe("4");

    const mappedAt = rows[0]!.mappedAt;
    const second = await mapLegacyCmsIdentity(cms, {
      applicationId,
      installationId,
      expectedInventoryDigest: before.digest,
    });
    expect(second.status).toBe("UNCHANGED");
    const reread = await readLegacyCmsPublicationMapping(cms, {
      installationId,
    });
    expect(reread.map((row) => row.mappedAt)).toEqual(
      rows.map(() => mappedAt),
    );
    const verified = await verifyLegacyCmsIdentityMapping(cms, {
      applicationId,
      installationId,
    });
    expect(verified.inventoryDigest).toBe(before.digest);
    expect(verified.publications).toHaveLength(3);
  }, 60000);

  it("refuses inventory drift, wrong expected digests and cross-application identity", async () => {
    const before = await inventoryLegacyCms(cms);
    await expect(
      mapLegacyCmsIdentity(cms, {
        applicationId,
        installationId,
        expectedInventoryDigest: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "LEGACY_CMS_INVENTORY_DRIFT" });

    await cms.query(
      `INSERT INTO content_entries
         (id, model_id, title, slug, data, status, version, created_by, updated_by, publication_id)
       VALUES ('ce_a4', 'cm_alpha', 'Drifted', 'drifted', '{}'::jsonb, 'published', 1, 'u_owner', 'u_owner', 'pub_alpha')`,
    );
    await expect(
      verifyLegacyCmsIdentityMapping(cms, { applicationId, installationId }),
    ).rejects.toMatchObject({ code: "LEGACY_CMS_IDENTITY_DRIFT" });
    await expect(
      mapLegacyCmsIdentity(cms, { applicationId, installationId }),
    ).rejects.toMatchObject({ code: "LEGACY_CMS_IDENTITY_DRIFT" });
    await cms.query("DELETE FROM content_entries WHERE id = 'ce_a4'");

    await cms.query(
      "UPDATE publications SET slug = 'alpha-renamed' WHERE id = 'pub_alpha'",
    );
    await expect(
      verifyLegacyCmsIdentityMapping(cms, { applicationId, installationId }),
    ).rejects.toMatchObject({ code: "LEGACY_CMS_IDENTITY_DRIFT" });
    await cms.query(
      "UPDATE publications SET slug = 'alpha' WHERE id = 'pub_alpha'",
    );

    await expect(
      mapLegacyCmsIdentity(cms, {
        applicationId: otherApplication,
        installationId,
      }),
    ).rejects.toMatchObject({ code: "LEGACY_CMS_INSTALLATION_MISMATCH" });
    await expect(
      mapLegacyCmsIdentity(cms, {
        applicationId: asApplicationId("app-unregistered"),
        installationId: asInstallationId("installation-unregistered"),
      }),
    ).rejects.toMatchObject({ code: "LEGACY_CMS_INSTALLATION_MISSING" });

    const restored = await inventoryLegacyCms(cms);
    expect(restored.digest).toBe(before.digest);
    const verified = await verifyLegacyCmsIdentityMapping(cms, {
      applicationId,
      installationId,
    });
    expect(verified.inventoryDigest).toBe(before.digest);
  }, 30000);

  it("keeps identity writes operator-only while allowing a read-only compatibility adapter", async () => {
    await cms.query(
      `GRANT CONNECT ON DATABASE "${databaseName}" TO "${runtimeRole}"`,
    );
    await cms.query(
      `GRANT USAGE ON SCHEMA public TO "${runtimeRole}";
       GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${runtimeRole}";
       GRANT SELECT, INSERT, UPDATE, DELETE ON platform_legacy_cms_installations, platform_legacy_cms_publications TO "${runtimeRole}"`,
    );
    runtime = await connect(databaseName, runtimeRole);
    const readable = await readLegacyCmsPublicationMapping(runtime, {
      installationId,
    });
    expect(readable).toHaveLength(3);
    await expect(
      runtime.query(
        "UPDATE platform_legacy_cms_installations SET inventory_digest = $1",
        ["f".repeat(64)],
      ),
    ).rejects.toThrow(/only trusted DB provisioning/);
    await expect(
      runtime.query(
        "DELETE FROM platform_legacy_cms_publications WHERE publication_id = 'pub_alpha'",
      ),
    ).rejects.toThrow(/only trusted DB provisioning/);
    await expect(
      mapLegacyCmsIdentity(runtime, {
        applicationId: otherApplication,
        installationId: otherInstallation,
      }),
    ).rejects.toThrow(/only trusted DB provisioning/);
    expect((await runtime.query("SELECT has_table_privilege(current_user,'public.platform_legacy_cms_publications','TRUNCATE') AS allowed")).rows[0]).toEqual({allowed:false});
    await expect(runtime.query("TRUNCATE public.platform_legacy_cms_publications")).rejects.toMatchObject({code:"42501"});
    const leaked = await cms.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM platform_legacy_cms_installations WHERE installation_id = $1`,
      [otherInstallation],
    );
    expect(leaked.rows[0]!.n).toBe("0");
  }, 30000);

  it("re-establishes the mapping after reconnect and preserves publication ids as non-tenant identities", async () => {
    await cms.end();
    cms = await connect(databaseName);
    const verified = await verifyLegacyCmsIdentityMapping(cms, {
      applicationId,
      installationId,
    });
    expect(verified.publications.map((row) => row.publicationId).sort()).toEqual([
      "pub_alpha",
      "pub_beta",
      "pub_default",
    ]);
    const publicationIds = await cms.query<{ id: string }>(
      "SELECT id FROM publications ORDER BY id",
    );
    expect(publicationIds.rows.map((row) => row.id)).toEqual([
      "pub_alpha",
      "pub_beta",
      "pub_default",
    ]);
    const principal = {
      id: asPrincipalId("principal-c01"),
      kind: "staff" as const,
      applicationId,
      tenantIds: [LEGACY_PUBLICATION_FALLBACK as unknown as ReturnType<typeof asTenantId>],
      roles: ["owner"],
      permissions: [],
    };
    const membership = {
      applicationId,
      tenantId: LEGACY_PUBLICATION_FALLBACK as unknown as ReturnType<typeof asTenantId>,
      principalId: principal.id,
      active: true,
      roles: ["owner"],
      permissions: [],
    };
    const scope = {
      applicationId,
      tenantId: LEGACY_PUBLICATION_FALLBACK as unknown as ReturnType<typeof asTenantId>,
      principal,
      authorization: { allowed: true, permissions: [], policyVersion: "v1" },
      membership,
    };
    expect(() => asTenantId(LEGACY_PUBLICATION_FALLBACK)).toThrow(
      /pub_default/,
    );
    expect(() => asApplicationId(LEGACY_PUBLICATION_FALLBACK)).toThrow(
      /pub_default/,
    );
    expect(() => verifyTenantScope(scope)).toThrow(/pub_default is not a tenant/);
    expect(() =>
      verifyTenantScope({
        ...scope,
        applicationId: LEGACY_PUBLICATION_FALLBACK as unknown as ReturnType<
          typeof asApplicationId
        >,
      }),
    ).toThrow(/pub_default is not an application/);
    await expect(
      readLegacyCmsPublicationMapping(cms, {
        installationId: asInstallationId("never-mapped"),
      }),
    ).resolves.toEqual([]);
  }, 30000);
  it.skipIf(process.env.M03_C01_PHYSICAL !== "1")("M03-213-03: physical PostgreSQL 16 pg_dump/pg_restore retains C01 mappings",async()=>{
    const before=await inventoryLegacyCms(cms);
    const mapping=await mapLegacyCmsIdentity(cms,{applicationId,installationId,expectedInventoryDigest:before.digest});
    expect(["MAPPED","UNCHANGED"]).toContain(mapping.status);
    const mappingBefore=await readLegacyCmsPublicationMapping(cms,{installationId});
    const restoredName=databaseName+"_restore";
    await admin.query('CREATE DATABASE "'+restoredName+'"');
    let restoreClient:Client|undefined;
    try{
      const command=(args:string[],input?:Buffer)=>{
        const result=spawnSync("docker",["compose","-f","compose.dev.yml","exec","-T","postgres",...args],{
          cwd:process.cwd(),input,encoding:"buffer",timeout:90000,maxBuffer:64*1024*1024,
        });
        if(result.error||result.status!==0)throw Error("C01 physical PostgreSQL command failed: "+
          args[0]+" exit="+String(result.status)+" "+String(result.stderr).slice(0,1200));
        return result.stdout as Buffer;
      };
      const archive=command(["pg_dump","-Fc","--no-owner","-U","vibress","-d",databaseName]);
      expect(archive.length).toBeGreaterThan(1024);
      command(["pg_restore","--exit-on-error","--no-owner","-U","vibress","-d",restoredName],archive);
      restoreClient=await connect(restoredName);
      expect((await restoreClient.query<{version:string}>("SHOW server_version_num")).rows[0]?.version).toBe("160016");
      const after=await inventoryLegacyCms(restoreClient);
      expect(after).toEqual(before);
      const verified=await verifyLegacyCmsIdentityMapping(restoreClient,{applicationId,installationId});
      expect(verified.inventoryDigest).toBe(before.digest);
      const mappingAfter=await readLegacyCmsPublicationMapping(restoreClient,{installationId});
      expect(mappingAfter).toEqual(mappingBefore);
      expect((await mapLegacyCmsIdentity(restoreClient,{applicationId,installationId,expectedInventoryDigest:before.digest})).status).toBe("UNCHANGED");
      await expect(mapLegacyCmsIdentity(restoreClient,{applicationId:otherApplication,installationId})).rejects.toMatchObject({code:"LEGACY_CMS_INSTALLATION_MISMATCH"});
      const dml=await restoreClient.query<{owner:string;security_definer:boolean;config:string[]}>(
        "SELECT pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS security_definer,p.proconfig AS config FROM pg_proc p WHERE p.oid='public.platform_legacy_cms_identity_guard()'::regprocedure");
      expect(dml.rows[0]?.security_definer).toBe(true);
      expect(dml.rows[0]?.config).toContain("search_path=pg_catalog, pg_temp");
      const acl=await restoreClient.query<{trunc_allowed:boolean}>(
        "SELECT has_table_privilege($1,'public.platform_legacy_cms_installations','TRUNCATE') AS trunc_allowed",[runtimeRole]);
      expect(acl.rows[0]?.trunc_allowed).toBe(false);
      await restoreClient.query("BEGIN");
      try{
        expect((await restoreClient.query("UPDATE platform_legacy_cms_installations SET mapped_by=mapped_by WHERE installation_id=$1",[installationId])).rowCount).toBe(1);
      }finally{await restoreClient.query("ROLLBACK");}
      await expect(restoreClient.query("DELETE FROM platform_legacy_cms_publications WHERE publication_id='pub_alpha'")).rejects.toMatchObject({code:"42501"});
      await restoreClient.query("UPDATE publications SET slug='changed-after-restore' WHERE id='pub_alpha'");
      await expect(verifyLegacyCmsIdentityMapping(restoreClient,{applicationId,installationId})).rejects.toMatchObject({code:"LEGACY_CMS_IDENTITY_DRIFT"});
      await restoreClient.query("UPDATE publications SET slug='alpha' WHERE id='pub_alpha'");
      expect((await verifyLegacyCmsIdentityMapping(restoreClient,{applicationId,installationId})).inventoryDigest).toBe(before.digest);
      console.info("M03_213_03_PG16_PHYSICAL_RESTORE=PASS archive_bytes="+archive.length+" publications=3 inventory_digest="+before.digest+" restored_digest="+after.digest);
    }finally{
      await restoreClient?.end();
      await admin.query('DROP DATABASE IF EXISTS "'+restoredName+'" WITH (FORCE)');
    }
  },180000);

});
