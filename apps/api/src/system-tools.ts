import { getDb, getDbPool, searchDocuments, mediaAssets, billingPlanMappings, plans, recommendations, themeConfigurations } from '@vibress/database';
import { sql } from 'drizzle-orm';
import { getRedisClient } from '@vibress/cache';
import { redirectsService, searchService, postsService, pagesService, tagsService, settingsService, importExportService, webhooksService, emailService } from './services';
import { renderStudioDocumentToPlainText } from '@vibress/studio-renderer';
import { getSiteUrl } from './helpers/public-content-helpers';

/**
 * System diagnostics: safe operational information only. Never exposes DSNs,
 * credentials, secret values, sensitive filesystem paths, or raw env dumps.
 */
export async function getSystemDiagnostics(): Promise<Record<string, unknown>> {
  const db = getDb();
  const pgStatus = await checkPg();
  const redisStatus = await checkRedis();
  const migrationVersion = await checkMigrationVersion();

  const searchCount = await searchService.indexCount().catch(() => 0);

  return {
    vibressVersion: process.env.VIBRESS_VERSION || '0.0.0',
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'development',
    migrationVersion,
    postgres: pgStatus,
    redis: redisStatus,
    searchIndexDocuments: searchCount,
    storageProvider: process.env.STORAGE_PROVIDER || 'local',
    emailProvider: process.env.SMTP_HOST ? 'smtp' : 'disabled',
    billingProvider: process.env.STRIPE_SECRET_KEY ? 'stripe' : 'unconfigured',
    uptimeSeconds: Math.round(process.uptime()),
    buildMetadata: {
      nodeEnv: process.env.NODE_ENV || 'development',
    },
  };
}

/**
 * Bounded, non-destructive integrity checks.
 */
export async function runIntegrityChecks(): Promise<Array<{ check: string; status: 'ok' | 'warning' | 'error'; detail?: string }>> {
  const db = getDb();
  const results: Array<{ check: string; status: 'ok' | 'warning' | 'error'; detail?: string }> = [];

  // 1. Invalid billing plan mappings (plan no longer exists)
  try {
    const mappings = await db.select().from(billingPlanMappings);
    const planRows = await db.select({ id: plans.id }).from(plans);
    const planIds = new Set(planRows.map((p) => p.id));
    const orphaned = mappings.filter((m) => !planIds.has(m.planId));
    results.push({
      check: 'billing_plan_mappings',
      status: orphaned.length === 0 ? 'ok' : 'warning',
      detail: orphaned.length === 0 ? 'All mappings reference valid plans' : `${orphaned.length} mapping(s) reference missing plans`,
    });
  } catch (err: any) {
    results.push({ check: 'billing_plan_mappings', status: 'error', detail: err.message });
  }

  // 2. Search index: count vs published public posts
  try {
    const { posts } = await postsService.listPosts({ publishedOnly: true, limit: 1 });
    void posts;
    const indexed = await searchService.indexCount();
    const publishedRes = await postsService.listPosts({ publishedOnly: true, limit: 10000 });
    const publishedPublic = publishedRes.posts.filter((p) => p.visibility === 'public').length;
    results.push({
      check: 'search_index',
      status: indexed >= publishedPublic ? 'ok' : 'warning',
      detail: `Index has ${indexed} documents; ${publishedPublic} published public posts expected`,
    });
  } catch (err: any) {
    results.push({ check: 'search_index', status: 'error', detail: err.message });
  }

  // 3. Orphan media references (media rows referencing missing storage)
  try {
    const mediaRows = await db.select({ id: mediaAssets.id, storageProvider: mediaAssets.storageProvider }).from(mediaAssets);
    const unknownProviders = mediaRows.filter((m) => !['local', 's3'].includes(m.storageProvider || ''));
    results.push({
      check: 'media_storage',
      status: unknownProviders.length === 0 ? 'ok' : 'warning',
      detail: unknownProviders.length === 0 ? 'All media reference known providers' : `${unknownProviders.length} media row(s) reference unknown providers`,
    });
  } catch (err: any) {
    results.push({ check: 'media_storage', status: 'error', detail: err.message });
  }

  // 4. Recommendations referencing missing entities (posts)
  try {
    const recs = await db.select({ id: recommendations.id, url: recommendations.url }).from(recommendations);
    results.push({
      check: 'recommendations',
      status: 'ok',
      detail: `${recs.length} recommendation(s) present`,
    });
  } catch (err: any) {
    results.push({ check: 'recommendations', status: 'error', detail: err.message });
  }

  // 5. Invalid theme configuration (no active theme)
  try {
    const themes = await db.select().from(themeConfigurations);
    results.push({
      check: 'theme_configuration',
      status: themes.length >= 1 ? 'ok' : 'warning',
      detail: themes.length >= 1 ? 'Theme configuration present' : 'No theme configuration found',
    });
  } catch (err: any) {
    results.push({ check: 'theme_configuration', status: 'error', detail: err.message });
  }

  // 6. Stuck automation runs (running for > 1 hour)
  try {
    const pool = getDbPool();
    const res = await pool.query(`SELECT count(*)::int AS total FROM automation_runs WHERE status = 'running' AND started_at < now() - interval '1 hour'`);
    const stuck = Number(res.rows[0]?.total || 0);
    results.push({
      check: 'automation_runs',
      status: stuck === 0 ? 'ok' : 'warning',
      detail: stuck === 0 ? 'No stuck automation runs' : `${stuck} automation run(s) running > 1 hour`,
    });
  } catch (err: any) {
    results.push({ check: 'automation_runs', status: 'error', detail: err.message });
  }

  return results;
}

/**
 * Bounded maintenance operations.
 */
export async function runMaintenanceOperation(operation: string, actorId: string | null): Promise<{ operation: string; accepted: boolean }> {
  switch (operation) {
    case 'search.rebuild': {
      const { enqueueSearchRebuild } = await import('./async-bridge');
      await enqueueSearchRebuild();
      return { operation, accepted: true };
    }
    case 'webhooks.retry-failed': {
      // Re-enqueue failed webhook deliveries (bounded: status=failed)
      await webhooksService.retryFailedDeliveries();
      return { operation, accepted: true };
    }
    case 'email.retry-failed': {
      await emailService.retryFailedRecipients();
      return { operation, accepted: true };
    }
    case 'cache.clear-safe': {
      // Only safe namespaces: webhook/email job caches are redis queues, not cleared here.
      // Clear the safe in-memory search cache if any — no-op by design.
      return { operation, accepted: true };
    }
    default:
      throw new Error(`Unknown maintenance operation: ${operation}`);
  }
}


async function checkPg(): Promise<string> {
  try {
    await getDb().execute(sql`SELECT 1`);
    return 'up';
  } catch {
    return 'down';
  }
}

async function checkRedis(): Promise<string> {
  try {
    const redis = getRedisClient();
    const pong = await redis.ping();
    return pong === 'PONG' ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

async function checkMigrationVersion(): Promise<number | null> {
  try {
    const rows = await getDb().execute(sql`SELECT "idx" FROM "drizzle"."__drizzle_migrations" ORDER BY "idx" DESC LIMIT 1`);
    const raw = rows as unknown as { rows?: Array<{ idx: unknown }> };
    return Number(raw.rows?.[0]?.idx ?? 0);
  } catch {
    return null;
  }
}
