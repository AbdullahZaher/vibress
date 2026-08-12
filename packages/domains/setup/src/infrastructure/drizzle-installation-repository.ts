import { getDb } from '@vibress/database';
import { sql, eq, and, count, isNull } from 'drizzle-orm';
import {
  installation,
  users,
  userRoles,
  roles,
  settings,
  posts,
  pages,
} from '@vibress/database';
import {
  InstallationRecord,
  InstallationRepository,
  InstallationSource,
  INSTALLATION_SINGLETON_ID,
} from '../domain/installation';

function mapRow(row: typeof installation.$inferSelect): InstallationRecord {
  return {
    id: row.id,
    installed: row.installed,
    installedAt: row.installedAt,
    installedVersion: row.installedVersion,
    installationSource: row.installationSource as InstallationSource,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleInstallationRepository implements InstallationRepository {
  async getSingleton(): Promise<InstallationRecord | null> {
    const db = getDb();
    const rows = await db.select().from(installation).where(eq(installation.id, INSTALLATION_SINGLETON_ID)).limit(1);
    const row = rows[0];
    return row ? mapRow(row) : null;
  }

  async getSingletonForUpdate(): Promise<InstallationRecord | null> {
    const db = getDb();
    const rows = await db.execute(sql`
      SELECT * FROM ${installation}
      WHERE id = ${INSTALLATION_SINGLETON_ID}
      FOR UPDATE
    `);
    const raw = (rows.rows ?? []) as Array<Record<string, unknown>>;
    if (raw.length === 0) return null;
    const r = raw[0]!;
    return {
      id: r.id as string,
      installed: Boolean(r.installed),
      installedAt: (r.installed_at as Date | null) ?? null,
      installedVersion: (r.installed_version as string | null) ?? null,
      installationSource: (r.installation_source as InstallationSource) ?? 'fresh',
      createdAt: r.created_at as Date,
      updatedAt: r.updated_at as Date,
    };
  }

  async markInstalled(input: { version: string | null; source: InstallationSource; installedAt?: Date | null; now?: Date }): Promise<void> {
    const db = getDb();
    await db
      .update(installation)
      .set({
        installed: true,
        // Fresh installs get a real timestamp; legacy backfill keeps
        // installed_at NULL (no fabricated historical metadata).
        installedAt: input.installedAt ?? (input.source === 'fresh' ? (input.now ?? new Date()) : null),
        installedVersion: input.version,
        installationSource: input.source,
        updatedAt: new Date(),
      })
      .where(eq(installation.id, INSTALLATION_SINGLETON_ID));
  }

  async countLegacySignals(): Promise<{
    activeOwners: number;
    siteSettings: number;
    posts: number;
    pages: number;
  }> {
    const db = getDb();

    const [ownerRes, settingsRes, postsRes, pagesRes] = await Promise.all([
      db
        .select({ value: count() })
        .from(users)
        .innerJoin(userRoles, eq(users.id, userRoles.userId))
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(and(eq(roles.key, 'owner'), eq(users.status, 'active'), isNull(users.deletedAt))),
      db
        .select({ value: count() })
        .from(settings)
        .where(eq(settings.namespace, 'site')),
      db.select({ value: count() }).from(posts).where(isNull(posts.deletedAt)),
      db.select({ value: count() }).from(pages).where(isNull(pages.deletedAt)),
    ]);

    return {
      activeOwners: Number(ownerRes[0]?.value ?? 0),
      siteSettings: Number(settingsRes[0]?.value ?? 0),
      posts: Number(postsRes[0]?.value ?? 0),
      pages: Number(pagesRes[0]?.value ?? 0),
    };
  }
}
