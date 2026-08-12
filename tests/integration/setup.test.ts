import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../apps/api/src/main';
import { getDbPool, closeDbPool, seedDatabase, runMigrations } from '@vibress/database';
import {
  SetupService,
  DrizzleInstallationRepository,
} from '@vibress/setup';
import { DrizzleSettingRepository } from '@vibress/settings';
import { SetupDomainError } from '@vibress/setup';

const SETUP_TOKEN = 'test-setup-token-0123456789abcdef0123456789abcdef';
const ORIGIN = 'http://localhost:7777';

const BASE_ENV: Record<string, string | undefined> = {
  NODE_ENV: 'test',
  VIBRESS_SETUP_TOKEN: SETUP_TOKEN,
};

describe('First-run setup', () => {
  let app: ReturnType<typeof buildApp>;

  const originalEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of Object.keys(BASE_ENV)) {
      originalEnv[key] = process.env[key];
      process.env[key] = BASE_ENV[key];
    }

    await runMigrations();
    const pool = getDbPool();
    await pool.query(`
      TRUNCATE TABLE audit_events, sessions, role_permissions, user_roles, permissions, roles, users, settings, installation CASCADE;
    `);
    // Roles + permissions only — no dev users, fresh installation state.
    await seedDatabase({ skipDevUsers: true });
    // Restore the singleton row (the migration normally guarantees it exists).
    await pool.query(`INSERT INTO installation (id, installed, installation_source) VALUES ('singleton', false, 'fresh');`);

    app = buildApp();
    await app.ready();
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
    for (const key of Object.keys(BASE_ENV)) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await closeDbPool();
  });

  const post = (token: string | undefined, payload: unknown, origin = ORIGIN) =>
    app.inject({
      method: 'POST',
      url: '/api/setup/v1/complete',
      headers: {
        'content-type': 'application/json',
        origin,
        ...(token ? { 'x-vibress-setup-token': token } : {}),
      },
      payload: payload as object,
    });

  const validPayload = {
    site: { name: 'My Vibress Site', description: 'A test site', locale: 'en' },
    owner: { name: 'Site Owner', email: 'owner@setup.test', password: 'StrongOwnerPassword123!' },
  };

  async function resetState() {
    const pool = getDbPool();
    await pool.query(`
      TRUNCATE TABLE audit_events, sessions, user_roles, users, settings CASCADE;
    `);
    // Restore the singleton row (the migration normally guarantees it exists).
    await pool.query(`DELETE FROM installation;`);
    await pool.query(`INSERT INTO installation (id, installed, installation_source) VALUES ('singleton', false, 'fresh');`);
  }

  describe('installation state', () => {
    it('reports a fresh instance as not installed and returns only { installed }', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/setup/v1/status' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ installed: false });
      expect(Object.keys(res.json())).toEqual(['installed']);
    });

    it('reports installed:true after a completed setup', async () => {
      const res = await post(SETUP_TOKEN, validPayload);
      expect(res.statusCode).toBe(200);
      const status = await app.inject({ method: 'GET', url: '/api/setup/v1/status' });
      expect(status.json()).toEqual({ installed: true });
      await resetState();
    });
  });

  describe('valid installation', () => {
    beforeEach(async () => {
      await resetState();
    });

    it('creates owner, owner role, site settings, audit entry, and marks installed atomically', async () => {
      const res = await post(SETUP_TOKEN, validPayload);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.installed).toBe(true);
      expect(body.user).toMatchObject({ email: 'owner@setup.test', roles: ['owner'] });
      // Session cookie set for auto-login
      const setCookie = res.headers['set-cookie'];
      expect(Array.isArray(setCookie) ? setCookie[0] : setCookie).toContain('vibress_session');

      const pool = getDbPool();

      const user = await pool.query<{ id: string; password_hash: string }>(
        `SELECT id, password_hash FROM users WHERE email = 'owner@setup.test'`
      );
      expect(user.rows).toHaveLength(1);
      const userId = user.rows[0].id;
      // argon2 hash — never plaintext
      expect(user.rows[0].password_hash).toMatch(/^\$argon2/);

      const role = await pool.query<{ key: string }>(
        `SELECT r.key FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = $1`,
        [userId]
      );
      expect(role.rows.map((r) => r.key)).toContain('owner');

      const settings = await pool.query<{ key: string; value: unknown }>(
        `SELECT key, value FROM settings WHERE namespace = 'site' ORDER BY key`
      );
      const asRecord: Record<string, unknown> = {};
      for (const row of settings.rows) asRecord[row.key] = row.value;
      expect(asRecord.title).toBe('My Vibress Site');
      expect(asRecord.description).toBe('A test site');
      expect(asRecord.locale).toBe('en');

      const audit = await pool.query<{ action: string; metadata: unknown }>(
        `SELECT action, metadata FROM audit_events WHERE action = 'setup.completed'`
      );
      expect(audit.rows).toHaveLength(1);
      const meta = audit.rows[0].metadata as Record<string, unknown>;
      expect(meta.ownerUserId).toBe(userId);
      expect(meta.installationSource).toBe('fresh');
      // no secrets in metadata
      expect(JSON.stringify(meta)).not.toContain('StrongOwnerPassword');
      expect(JSON.stringify(meta)).not.toContain(SETUP_TOKEN);

      const inst = await pool.query<{ installed: boolean; installed_version: string }>(
        `SELECT installed, installed_version FROM installation WHERE id = 'singleton'`
      );
      expect(inst.rows[0].installed).toBe(true);
    });
  });

  describe('setup token security', () => {
    beforeEach(async () => {
      await resetState();
    });

    it('rejects a missing setup token without touching the database', async () => {
      const res = await post(undefined, validPayload);
      expect(res.statusCode).toBe(401);
      expect(res.json().errors[0].code).toBe('INVALID_SETUP_TOKEN');
      const pool = getDbPool();
      const users = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE email = 'owner@setup.test'`);
      expect(users.rows[0].n).toBe(0);
      const inst = await pool.query(`SELECT installed FROM installation WHERE id = 'singleton'`);
      expect(inst.rows[0].installed).toBe(false);
    });

    it('rejects an invalid setup token', async () => {
      const res = await post('wrong-token-value-00000000000000000000', validPayload);
      expect(res.statusCode).toBe(401);
    });

    it('rejects a token sent in the JSON body (header-only transport)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/setup/v1/complete',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        payload: { ...validPayload, token: SETUP_TOKEN },
      });
      expect(res.statusCode).toBe(401); // header absent → rejected regardless of body
    });
  });

  describe('permanent lock', () => {
    it('returns 409 after installation even with the correct original token', async () => {
      const first = await post(SETUP_TOKEN, validPayload);
      expect(first.statusCode).toBe(200);

      const replay = await post(SETUP_TOKEN, validPayload);
      expect(replay.statusCode).toBe(409);
      expect(replay.json().errors[0].code).toBe('SETUP_ALREADY_COMPLETED');

      // GET /status also reflects installed
      const status = await app.inject({ method: 'GET', url: '/api/setup/v1/status' });
      expect(status.json()).toEqual({ installed: true });
      await resetState();
    });

    it('still rejects even if the token header is repeated after install', async () => {
      await post(SETUP_TOKEN, validPayload);
      const res = await app.inject({
        method: 'POST',
        url: '/api/setup/v1/complete',
        headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-vibress-setup-token': SETUP_TOKEN },
        payload: validPayload,
      });
      expect(res.statusCode).toBe(409);
      await resetState();
    });
  });

  describe('atomicity', () => {
    it('rolls back every change when a repository write fails mid-installation', async () => {
      const failingSettingsRepo = {
        get: async () => null,
        getMany: async () => [],
        set: async () => {
          throw new Error('simulated settings write failure');
        },
        delete: async () => undefined,
      };
      const service = new SetupService(new DrizzleInstallationRepository(), failingSettingsRepo);
      await expect(
        service.completeSetup(validPayload, { applicationVersion: '0.0.0-test' })
      ).rejects.toThrow('simulated settings write failure');

      const pool = getDbPool();
      const users = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE email = 'owner@setup.test'`);
      expect(users.rows[0].n).toBe(0);
      const settings = await pool.query(`SELECT COUNT(*)::int AS n FROM settings WHERE namespace = 'site'`);
      expect(settings.rows[0].n).toBe(0);
      const inst = await pool.query(`SELECT installed FROM installation WHERE id = 'singleton'`);
      expect(inst.rows[0].installed).toBe(false);
    });

    it('does not create a partial installation when the owner email already exists', async () => {
      const pool = getDbPool();
      const { DrizzleUserRepository, UsersService } = await import('@vibress/users');
      const { hashPassword } = await import('@vibress/security');
      const usersService = new UsersService(new DrizzleUserRepository());
      await usersService.createUser({ email: 'taken@setup.test', name: 'Taken', passwordHash: await hashPassword('StrongPassword123!') });

      const setup = new SetupService(new DrizzleInstallationRepository());
      await expect(
        setup.completeSetup(
          { site: { name: 'X', description: '', locale: 'en' }, owner: { name: 'Existing', email: 'taken@setup.test', password: 'StrongPassword123!' } },
          { applicationVersion: '0.0.0-test' }
        )
      ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_EXISTS' });

      const inst = await pool.query(`SELECT installed FROM installation WHERE id = 'singleton'`);
      expect(inst.rows[0].installed).toBe(false);
      await pool.query(`DELETE FROM users WHERE email = 'taken@setup.test';`);
    });
  });

  describe('concurrency', () => {
    it('exactly one of two simultaneous setups succeeds; exactly one owner exists', async () => {
      await resetState();
      const results = await Promise.all([
        post(SETUP_TOKEN, validPayload),
        post(SETUP_TOKEN, validPayload),
      ]);
      const codes = results.map((r) => r.statusCode).sort();
      expect(codes).toEqual([200, 409]);

      const pool = getDbPool();
      const owners = await pool.query(
        `SELECT COUNT(*)::int AS n FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE r.key = 'owner'`
      );
      expect(owners.rows[0].n).toBe(1);
      const inst = await pool.query(`SELECT installed FROM installation WHERE id = 'singleton'`);
      expect(inst.rows[0].installed).toBe(true);
      await resetState();
    });
  });

  describe('input validation', () => {
    beforeEach(async () => {
      await resetState();
    });

    it('rejects a weak password', async () => {
      const res = await post(SETUP_TOKEN, {
        site: { name: 'S', description: '', locale: 'en' },
        owner: { name: 'O', email: 'o@setup.test', password: 'short' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('rejects an invalid email', async () => {
      const res = await post(SETUP_TOKEN, {
        site: { name: 'S', description: '', locale: 'en' },
        owner: { name: 'O', email: 'not-an-email', password: 'StrongPassword123!' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects an invalid locale', async () => {
      const res = await post(SETUP_TOKEN, {
        site: { name: 'S', description: '', locale: 'en_US_very_bad!' },
        owner: { name: 'O', email: 'o@setup.test', password: 'StrongPassword123!' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects malformed JSON', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/setup/v1/complete',
        headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-vibress-setup-token': SETUP_TOKEN },
        payload: '{not json',
      });
      expect([400, 401]).toContain(res.statusCode);
    });

    it('rejects missing required fields', async () => {
      const res = await post(SETUP_TOKEN, { site: {}, owner: {} });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('origin and rate limit', () => {
    beforeEach(async () => {
      await resetState();
    });

    it('rejects a cross-origin setup completion', async () => {
      const res = await post(SETUP_TOKEN, validPayload, 'https://evil.example.com');
      expect(res.statusCode).toBe(403);
      expect(res.json().errors[0].code).toBe('INVALID_ORIGIN');
    });

    it('returns 429 after exhausting the setup completion rate limit', async () => {
      // test env limit: 100/min — burst past it and expect a 429
      let saw429 = false;
      for (let i = 0; i < 105; i++) {
        const res = await post(SETUP_TOKEN, validPayload);
        if (res.statusCode === 429) {
          saw429 = true;
          break;
        }
      }
      expect(saw429).toBe(true);
    });
  });

  describe('legacy backfill', () => {
    it('classifies a legacy database with an active owner as installed (legacy_backfill)', async () => {
      const pool = getDbPool();
      await resetState();
      // owner exists from the valid-installation describe chain? ensure clean:
      await pool.query(`DELETE FROM users WHERE email = 'owner@setup.test';`);
      // simulate legacy: re-seed dev owner
      await seedDatabase();

      const service = new SetupService(new DrizzleInstallationRepository());
      await service.classifyLegacyInstallation();

      const inst = await pool.query<{ installed: boolean; installed_at: unknown; installation_source: string }>(
        `SELECT installed, installed_at, installation_source FROM installation WHERE id = 'singleton'`
      );
      expect(inst.rows[0].installed).toBe(true);
      expect(inst.rows[0].installation_source).toBe('legacy_backfill');
      expect(inst.rows[0].installed_at).toBeNull();
    });

    it('classifies a database with only site settings as installed', async () => {
      const pool = getDbPool();
      await pool.query(`UPDATE installation SET installed = false, installed_at = NULL, installed_version = NULL WHERE id = 'singleton';`);
      await pool.query(`DELETE FROM users CASCADE;`);
      await pool.query(`DELETE FROM settings;`);
      await pool.query(`INSERT INTO settings (id, namespace, key, value, value_type, classification) VALUES ('site.title','site','title','"Legacy"'::jsonb,'string','public');`);

      const service = new SetupService(new DrizzleInstallationRepository());
      await service.classifyLegacyInstallation();
      const inst = await pool.query(`SELECT installed FROM installation WHERE id = 'singleton'`);
      expect(inst.rows[0].installed).toBe(true);
    });

    it('leaves a genuinely empty database uninstalled', async () => {
      const pool = getDbPool();
      await pool.query(`UPDATE installation SET installed = false, installed_at = NULL, installed_version = NULL WHERE id = 'singleton';`);
      await pool.query(`DELETE FROM users CASCADE;`);
      await pool.query(`DELETE FROM settings;`);
      await pool.query(`DELETE FROM posts;`);
      await pool.query(`DELETE FROM pages;`);

      const service = new SetupService(new DrizzleInstallationRepository());
      await service.classifyLegacyInstallation();
      const inst = await pool.query(`SELECT installed FROM installation WHERE id = 'singleton'`);
      expect(inst.rows[0].installed).toBe(false);
    });
  });
});
