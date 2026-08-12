import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDbPool, closeDbPool, seedDatabase, runMigrations } from '@vibress/database';

/**
 * P0 production security: a fresh production boot must NEVER create
 * development/demo staff accounts (owner@example.com etc.) with known
 * credentials, while still seeding system roles and permissions.
 */
describe('Production seeding security (P0)', () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    await runMigrations();
    // Wipe all users so the test starts from a fresh production-shaped DB.
    const pool = getDbPool();
    await pool.query(`
      TRUNCATE TABLE audit_events, sessions, role_permissions, user_roles, permissions, roles, users CASCADE;
    `);
  }, 30000);

  afterAll(async () => {
    await closeDbPool();
  });

  beforeEach(() => {
    originalEnv['NODE_ENV'] = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    const value = originalEnv['NODE_ENV'];
    if (value === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = value;
  });

  it('does not seed any development staff users in production', async () => {
    await seedDatabase();

    const pool = getDbPool();
    const res = await pool.query<{ email: string }>(
      `SELECT email FROM users WHERE email IN
         ('owner@example.com','owner@vibress.local','admin@example.com','admin@vibress.local',
          'editor@vibress.local','author@vibress.local')`
    );
    expect(res.rows).toHaveLength(0);
  });

  it('still seeds system roles and permissions in production', async () => {
    const pool = getDbPool();
    const rolesRes = await pool.query<{ key: string }>(
      `SELECT key FROM roles WHERE key IN ('owner','administrator','editor','author','contributor')`
    );
    const keys = rolesRes.rows.map((r) => r.key).sort();
    expect(keys).toEqual(['administrator', 'author', 'contributor', 'editor', 'owner']);

    const permsRes = await pool.query<{ key: string }>(`SELECT key FROM permissions LIMIT 1`);
    expect(permsRes.rows.length).toBeGreaterThan(0);
  });

  it('explicitly seeding dev users still works when requested (test/dev only)', async () => {
    await seedDatabase({ skipDevUsers: false });
    const pool = getDbPool();
    const res = await pool.query<{ email: string }>(`SELECT email FROM users WHERE email = 'owner@example.com'`);
    expect(res.rows).toHaveLength(1);
    // restore to clean state for subsequent suites
    await pool.query(`TRUNCATE TABLE user_roles, users CASCADE;`);
  });
});
