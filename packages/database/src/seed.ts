import { getDb, roles, permissions, rolePermissions, users, userRoles, closeDbPool } from './index';
import { eq, and } from 'drizzle-orm';
import crypto from 'node:crypto';
import { hashPassword } from '@vibress/security';

export const SYSTEM_ROLES = [
  { key: 'owner', name: 'Owner', description: 'Site Owner with full administrative access', isSystem: true },
  { key: 'administrator', name: 'Administrator', description: 'System Administrator', isSystem: true },
  { key: 'editor', name: 'Editor', description: 'Content Editor', isSystem: true },
  { key: 'author', name: 'Author', description: 'Content Author', isSystem: true },
  { key: 'contributor', name: 'Contributor', description: 'Content Contributor', isSystem: true },
];

export const SYSTEM_PERMISSIONS = [
  { key: 'users.read', description: 'Read staff users' },
  { key: 'users.create', description: 'Create staff users' },
  { key: 'users.edit', description: 'Edit staff users' },
  { key: 'users.delete', description: 'Delete staff users' },
  { key: 'roles.read', description: 'Read roles' },
  { key: 'roles.create', description: 'Create roles' },
  { key: 'roles.edit', description: 'Edit roles' },
  { key: 'roles.delete', description: 'Delete roles' },
  { key: 'settings.read', description: 'Read system settings' },
  { key: 'settings.edit', description: 'Edit system settings' },
  { key: 'posts.read', description: 'Read posts' },
  { key: 'posts.create', description: 'Create posts' },
  { key: 'posts.edit', description: 'Edit posts' },
  { key: 'posts.delete', description: 'Delete posts' },
  { key: 'posts.publish', description: 'Publish posts' },
  { key: 'pages.read', description: 'Read pages' },
  { key: 'pages.create', description: 'Create pages' },
  { key: 'pages.edit', description: 'Edit pages' },
  { key: 'pages.delete', description: 'Delete pages' },
  { key: 'pages.publish', description: 'Publish pages' },
  { key: 'tags.read', description: 'Read tags' },
  { key: 'tags.create', description: 'Create tags' },
  { key: 'tags.edit', description: 'Edit tags' },
  { key: 'tags.delete', description: 'Delete tags' },
  { key: 'media.read', description: 'Read media assets' },
  { key: 'media.upload', description: 'Upload media assets' },
  { key: 'media.delete', description: 'Delete media assets' },
  { key: 'storage.read', description: 'Read storage configuration' },
  { key: 'storage.manage', description: 'Manage storage providers' },
  { key: 'themes.read', description: 'Read installed themes' },
  { key: 'themes.manage', description: 'Manage and upload themes' },
  { key: 'members.read', description: 'Read reader members' },
  { key: 'members.manage', description: 'Manage reader members' },
  { key: 'billing.read', description: 'Read billing details' },
  { key: 'billing.manage', description: 'Manage billing configuration' },
  { key: 'subscriptions.read', description: 'Read subscription plans' },
  { key: 'subscriptions.manage', description: 'Manage subscription plans' },
  { key: 'newsletters.read', description: 'Read newsletter settings' },
  { key: 'email.read', description: 'Read email delivery logs' },
  { key: 'email.manage', description: 'Send broadcasts and manage templates' },
  { key: 'comments.read', description: 'Read comments' },
  { key: 'comments.manage', description: 'Manage comment settings' },
  { key: 'comments.moderate', description: 'Moderate comments' },
  { key: 'recommendations.read', description: 'Read recommended sites' },
  { key: 'recommendations.manage', description: 'Manage recommendations' },
  { key: 'integrations.manage', description: 'Manage webhooks and API keys' },
  { key: 'api_keys.manage', description: 'Manage staff machine keys' },
  { key: 'webhooks.manage', description: 'Manage webhook subscriptions' },
  { key: 'plugins.read', description: 'Read installed plugins' },
  { key: 'plugins.manage', description: 'Manage and upload plugins' },
  { key: 'products.read', description: 'Read product catalog' },
  { key: 'plans.read', description: 'Read access plans' },
  { key: 'offers.read', description: 'Read discounts and offers' },
  { key: 'offers.manage', description: 'Create and edit offers' },
  { key: 'automations.manage', description: 'Manage event automation workflows' },
  { key: 'automations.run', description: 'Trigger manual automation runs' },
  { key: 'settings.read', description: 'Read site and system settings (masked)' },
  { key: 'settings.manage', description: 'Update site and system settings' },
  { key: 'audit.read', description: 'Read audit log' },
  { key: 'imports.manage', description: 'Import data into Vibress' },
  { key: 'exports.manage', description: 'Export data from Vibress' },
  { key: 'redirects.read', description: 'Read redirect rules' },
  { key: 'redirects.manage', description: 'Create, edit, and manage redirects' },
  { key: 'system.read', description: 'Read system diagnostics' },
  { key: 'system.manage', description: 'Run maintenance operations' },
];

export interface SeedOptions {
  skipDevUsers?: boolean;
}

export const seedDatabase = async (options?: SeedOptions): Promise<void> => {
  const db = getDb();
  const now = new Date();

  console.log('Seeding system roles...');
  for (const roleDef of SYSTEM_ROLES) {
    const existing = await db.select().from(roles).where(eq(roles.key, roleDef.key)).limit(1);
    let roleId: string;
    if (existing.length === 0) {
      roleId = crypto.randomUUID();
      await db.insert(roles).values({
        id: roleId,
        key: roleDef.key,
        name: roleDef.name,
        description: roleDef.description,
        isSystem: roleDef.isSystem,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      roleId = existing[0]!.id;
      await db.update(roles).set({
        name: roleDef.name,
        description: roleDef.description,
        isSystem: roleDef.isSystem,
        updatedAt: now,
      }).where(eq(roles.id, roleId));
    }
  }

  console.log('Seeding system permissions...');
  const permMap = new Map<string, string>();
  for (const permDef of SYSTEM_PERMISSIONS) {
    const existing = await db.select().from(permissions).where(eq(permissions.key, permDef.key)).limit(1);
    let permId: string;
    if (existing.length === 0) {
      permId = crypto.randomUUID();
      await db.insert(permissions).values({
        id: permId,
        key: permDef.key,
        description: permDef.description,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      permId = existing[0]!.id;
      await db.update(permissions).set({
        description: permDef.description,
        updatedAt: now,
      }).where(eq(permissions.id, permId));
    }
    permMap.set(permDef.key, permId);
  }

  // Assign permissions to system roles
  console.log('Assigning baseline permissions to system roles...');
  const ownerRoleRows = await db.select().from(roles).where(eq(roles.key, 'owner')).limit(1);
  const adminRoleRows = await db.select().from(roles).where(eq(roles.key, 'administrator')).limit(1);
  const editorRoleRows = await db.select().from(roles).where(eq(roles.key, 'editor')).limit(1);
  const authorRoleRows = await db.select().from(roles).where(eq(roles.key, 'author')).limit(1);
  const contributorRoleRows = await db.select().from(roles).where(eq(roles.key, 'contributor')).limit(1);

  const targetRoleIds = [
    ownerRoleRows[0]?.id,
    adminRoleRows[0]?.id,
    editorRoleRows[0]?.id,
    authorRoleRows[0]?.id,
    contributorRoleRows[0]?.id,
  ].filter(Boolean) as string[];

  for (const roleId of targetRoleIds) {
    for (const [permKey, permId] of permMap.entries()) {
      if (roleId === authorRoleRows[0]?.id || roleId === contributorRoleRows[0]?.id) {
        if (!permKey.startsWith('media.read') && !permKey.startsWith('media.upload') && !permKey.startsWith('posts.') && !permKey.startsWith('pages.') && !permKey.startsWith('tags.read')) {
          continue;
        }
      }

      await db.insert(rolePermissions).values({
        roleId,
        permissionId: permId,
        createdAt: now,
      }).onConflictDoNothing();
    }
  }

  // Seed default dev users idempotently
  if (!options?.skipDevUsers) {
    console.log('Seeding default dev staff users...');
    const ownerRole = ownerRoleRows[0];
    const adminRole = adminRoleRows[0];
    const editorRole = editorRoleRows[0];
    const authorRole = authorRoleRows[0];

    if (ownerRole) {
      const devPassHash = await hashPassword('DevPassword123!');
      const ownerPassHash = await hashPassword('OwnerPass123!');

      const devUsers = [
        { email: 'owner@vibress.local', name: 'Owner', slug: 'owner-local', roleId: ownerRole.id, hash: devPassHash },
        { email: 'owner@example.com', name: 'Owner', slug: 'owner-example', roleId: ownerRole.id, hash: ownerPassHash },
        { email: 'admin@vibress.local', name: 'Admin', slug: 'admin-local', roleId: adminRole?.id || ownerRole.id, hash: devPassHash },
        { email: 'admin@example.com', name: 'Admin', slug: 'admin-example', roleId: adminRole?.id || ownerRole.id, hash: devPassHash },
        { email: 'editor@vibress.local', name: 'Editor', slug: 'editor-local', roleId: editorRole?.id || ownerRole.id, hash: devPassHash },
        { email: 'author@vibress.local', name: 'Author', slug: 'author-local', roleId: authorRole?.id || ownerRole.id, hash: devPassHash },
      ];

      for (const devUser of devUsers) {
        const existingUser = await db.select().from(users).where(eq(users.email, devUser.email)).limit(1);
        let userId: string;
        if (existingUser.length === 0) {
          userId = crypto.randomUUID();
          await db.insert(users).values({
            id: userId,
            email: devUser.email,
            name: devUser.name,
            slug: devUser.slug,
            passwordHash: devUser.hash,
            status: 'active',
            createdAt: now,
            updatedAt: now,
          });
          await db.insert(userRoles).values({
            userId,
            roleId: devUser.roleId,
            createdAt: now,
          }).onConflictDoNothing();
        }
      }
    }
  }

  console.log('Database seeding complete.');
};

if (require.main === module) {
  seedDatabase()
    .then(() => closeDbPool())
    .catch(async (err) => {
      console.error('Seeding failed:', err);
      await closeDbPool();
      process.exit(1);
    });
}
