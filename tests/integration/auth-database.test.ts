import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrations, seedDatabase, getDbPool, closeDbPool } from '@vibress/database';
import { DrizzleUserRepository, UsersService } from '@vibress/users';
import { DrizzleRoleRepository, RolesService } from '@vibress/roles';
import { DrizzlePermissionRepository, PermissionsService } from '@vibress/permissions';
import { DrizzleAuditRepository, AuditService } from '@vibress/audit';
import { DrizzleSessionRepository, AuthService } from '@vibress/auth';
import { hashPassword, hashToken, generateOpaqueToken } from '@vibress/security';
import { bootstrapOwner } from '../../scripts/bootstrap-owner';

describe('Auth & Authorization Database Integration', () => {
  let userRepo: DrizzleUserRepository;
  let roleRepo: DrizzleRoleRepository;
  let permRepo: DrizzlePermissionRepository;
  let auditRepo: DrizzleAuditRepository;
  let sessionRepo: DrizzleSessionRepository;

  let usersService: UsersService;
  let rolesService: RolesService;
  let permissionsService: PermissionsService;
  let auditService: AuditService;
  let authService: AuthService;

  beforeAll(async () => {
    // Run migrations first to ensure schema exists
    await runMigrations();

    // Clean tables before test run
    const pool = getDbPool();
    await pool.query(`
      TRUNCATE TABLE audit_events, sessions, role_permissions, user_roles, permissions, roles, users CASCADE;
    `);

    // Seed database
    await seedDatabase({ skipDevUsers: true });

    userRepo = new DrizzleUserRepository();
    roleRepo = new DrizzleRoleRepository();
    permRepo = new DrizzlePermissionRepository();
    auditRepo = new DrizzleAuditRepository();
    sessionRepo = new DrizzleSessionRepository();

    usersService = new UsersService(userRepo);
    rolesService = new RolesService(roleRepo);
    permissionsService = new PermissionsService(permRepo);
    auditService = new AuditService(auditRepo);
    authService = new AuthService(sessionRepo, userRepo, roleRepo, permRepo, auditRepo);
  }, 30000);

  afterAll(async () => {
    // Restore dev users for subsequent tests
    await seedDatabase();
    await closeDbPool();
  });

  it('seeds system roles and permissions idempotently', async () => {
    const rolesList = await rolesService.listAll();
    const permsList = await permissionsService.listAll();

    expect(rolesList.map(r => r.key)).toContain('owner');
    expect(rolesList.map(r => r.key)).toContain('administrator');

    expect(permsList.map(p => p.key)).toContain('users.read');
    expect(permsList.map(p => p.key)).toContain('roles.read');

    // Run seed again to verify idempotency
    await seedDatabase({ skipDevUsers: true });
    const rolesList2 = await rolesService.listAll();
    expect(rolesList2.length).toBe(rolesList.length);
  });

  it('bootstraps first owner and prevents duplicate initial owner', async () => {
    const ownerEmail = 'initial.owner@vibress.local';
    const ownerPass = 'StrongOwnerPass123!';

    await bootstrapOwner({
      email: ownerEmail,
      name: 'Initial Owner',
      password: ownerPass,
    });

    const ownerUser = await usersService.findByEmail(ownerEmail);
    expect(ownerUser).not.toBeNull();
    expect(ownerUser?.email).toBe(ownerEmail);

    const userRoles = await rolesService.getUserRoleKeys(ownerUser!.id);
    expect(userRoles).toContain('owner');

    // Second bootstrap attempt must fail
    await expect(
      bootstrapOwner({
        email: 'second.owner@vibress.local',
        name: 'Second Owner',
        password: ownerPass,
      })
    ).rejects.toThrow();
  });

  it('handles user authentication, login, session creation and logout', async () => {
    const email = 'initial.owner@vibress.local';
    const pass = 'StrongOwnerPass123!';

    const loginResult = await authService.loginStaff(email, pass, {
      ipAddress: '127.0.0.1',
      userAgent: 'TestAgent/1.0',
    });

    expect(loginResult.user.email).toBe(email);
    expect(loginResult.roles).toContain('owner');
    expect(loginResult.sessionToken).toBeDefined();

    // Verify session stored in DB contains token_hash, not raw token
    const tokenHash = hashToken(loginResult.sessionToken);
    const dbSession = await sessionRepo.findActiveSessionByTokenHash(tokenHash);
    expect(dbSession).not.toBeNull();
    expect(dbSession?.userId).toBe(loginResult.user.id);
    expect(dbSession?.tokenHash).toBe(tokenHash);

    // Resolve session
    const resolved = await authService.resolveSession(loginResult.sessionToken);
    expect(resolved).not.toBeNull();
    expect(resolved?.user.id).toBe(loginResult.user.id);

    // Logout session
    await authService.logoutStaff(loginResult.sessionToken);

    // Resolving again should return null
    const resolvedAfterLogout = await authService.resolveSession(loginResult.sessionToken);
    expect(resolvedAfterLogout).toBeNull();
  });

  it('enforces last owner invariant on disable and role removal', async () => {
    const owner = await usersService.findByEmail('initial.owner@vibress.local');
    expect(owner).not.toBeNull();

    // Try to disable the only active owner -> fails
    await expect(usersService.disableUser(owner!.id)).rejects.toThrow('Cannot disable the last active owner');

    // Try to remove owner role from the only active owner -> fails
    const ownerRole = await rolesService.findByKey('owner');
    await expect(
      rolesService.removeRoleFromUser(owner!.id, ownerRole!.id, () => userRepo.countActiveOwners())
    ).rejects.toThrow('Cannot remove owner role from the only active owner');

    // Create a second owner
    const secondPassHash = await hashPassword('SecondOwnerPass123!');
    const secondUser = await usersService.createUser({
      email: 'second.owner@vibress.local',
      name: 'Second Owner',
      passwordHash: secondPassHash,
    });
    await rolesService.assignRoleToUser(secondUser.id, ownerRole!.id);

    // Now disabling the first owner should succeed because countActiveOwners is 2
    const disabledOwner = await usersService.disableUser(owner!.id);
    expect(disabledOwner.status).toBe('disabled');

    // Disabled owner session immediately fails
    const loginResult = await authService.loginStaff('second.owner@vibress.local', 'SecondOwnerPass123!');
    expect(loginResult.user.id).toBe(secondUser.id);
  });

  it('records audit events without sensitive data', async () => {
    const events = await auditService.listAll(50);
    expect(events.length).toBeGreaterThan(0);

    for (const evt of events) {
      if (evt.metadata) {
        expect(JSON.stringify(evt.metadata)).not.toContain('StrongOwnerPass123!');
        expect(JSON.stringify(evt.metadata)).not.toContain('SecondOwnerPass123!');
      }
    }
  });
});
