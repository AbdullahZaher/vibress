import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../apps/api/src/main';
import { getDbPool, closeDbPool, seedDatabase, runMigrations } from '@vibress/database';
import { DrizzleUserRepository, UsersService } from '@vibress/users';
import { DrizzleRoleRepository, RolesService } from '@vibress/roles';
import { DrizzlePermissionRepository, PermissionsService } from '@vibress/permissions';
import { hashPassword } from '@vibress/security';

describe('Admin Content API & Permissions Security', () => {
  let app: ReturnType<typeof buildApp>;
  let editorUser: any;
  let authorUser: any;

  const editorPassword = 'EditorPassword123!';
  const authorPassword = 'AuthorPassword123!';

  beforeAll(async () => {
    await runMigrations();

    const pool = getDbPool();
    await pool.query(`
      TRUNCATE TABLE audit_events, sessions, role_permissions, user_roles, permissions, roles, revisions, post_tags, post_authors, page_authors, tags, pages, posts, users CASCADE;
    `);

    await seedDatabase();

    const userRepo = new DrizzleUserRepository();
    const roleRepo = new DrizzleRoleRepository();
    const permRepo = new DrizzlePermissionRepository();

    const usersService = new UsersService(userRepo);
    const rolesService = new RolesService(roleRepo);
    const permissionsService = new PermissionsService(permRepo);

    // Create Editor User (has posts.read, posts.create, posts.edit, posts.publish)
    const editorHash = await hashPassword(editorPassword);
    editorUser = await usersService.createUser({
      email: 'editor@vibress.test',
      name: 'Editor User',
      passwordHash: editorHash,
      status: 'active',
    });
    const editorRole = await rolesService.findByKey('editor');
    await rolesService.assignRoleToUser(editorUser.id, editorRole!.id);

    // Create Custom Limited Role (has posts.read, posts.create, posts.edit, BUT NOT posts.publish)
    const limitedRole = await rolesService.createRole({
      key: 'limited_editor',
      name: 'Limited Editor',
    });
    const permRead = await permissionsService.findByKey('posts.read');
    const permCreate = await permissionsService.findByKey('posts.create');
    const permEdit = await permissionsService.findByKey('posts.edit');
    await permissionsService.assignPermissionToRole(limitedRole.id, permRead!.id);
    await permissionsService.assignPermissionToRole(limitedRole.id, permCreate!.id);
    await permissionsService.assignPermissionToRole(limitedRole.id, permEdit!.id);

    const authorHash = await hashPassword(authorPassword);
    authorUser = await usersService.createUser({
      email: 'author@vibress.test',
      name: 'Author User',
      passwordHash: authorHash,
      status: 'active',
    });
    await rolesService.assignRoleToUser(authorUser.id, limitedRole.id);

    app = buildApp();
    await app.ready();
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
    await closeDbPool();
  });

  const getCookieFor = async (email: string, pass: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/v1/auth/login',
      payload: { email, password: pass },
    });
    const cookieHeader = res.headers['set-cookie'];
    return Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
  };

  it('allows authorized user to create, update, and publish posts', async () => {
    const editorCookie = await getCookieFor('editor@vibress.test', editorPassword);

    // Create post
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/v1/posts',
      headers: { cookie: editorCookie, origin: 'http://localhost:7777' },
      payload: {
        title: 'API Post Test',
        excerpt: 'API Excerpt',
        primaryAuthorId: editorUser.id,
      },
    });

    expect(createRes.statusCode).toBe(201);
    const post = createRes.json().post;
    expect(post.title).toBe('API Post Test');
    expect(post.status).toBe('draft');

    // Publish post
    const publishRes = await app.inject({
      method: 'POST',
      url: `/api/admin/v1/posts/${post.id}/publish`,
      headers: { cookie: editorCookie, origin: 'http://localhost:7777' },
    });

    expect(publishRes.statusCode).toBe(200);
    expect(publishRes.json().post.status).toBe('published');
  });

  it('enforces permission denial on publish when user lacks posts.publish permission', async () => {
    const authorCookie = await getCookieFor('author@vibress.test', authorPassword);

    // 1. Author can create post -> 201
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/v1/posts',
      headers: { cookie: authorCookie, origin: 'http://localhost:7777' },
      payload: {
        title: 'Author Draft',
        primaryAuthorId: authorUser.id,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const post = createRes.json().post;

    // 2. Author attempts to publish -> 403 PERMISSION_DENIED
    const publishRes = await app.inject({
      method: 'POST',
      url: `/api/admin/v1/posts/${post.id}/publish`,
      headers: { cookie: authorCookie, origin: 'http://localhost:7777' },
    });

    expect(publishRes.statusCode).toBe(403);
    expect(publishRes.json().errors[0].code).toBe('PERMISSION_DENIED');
  });

  it('handles optimistic concurrency conflict (409 CONTENT_CONFLICT)', async () => {
    const editorCookie = await getCookieFor('editor@vibress.test', editorPassword);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/v1/posts',
      headers: { cookie: editorCookie, origin: 'http://localhost:7777' },
      payload: { title: 'Concurrency Test Post', primaryAuthorId: editorUser.id },
    });
    const post = createRes.json().post;

    // First update (version 1 -> 2)
    const update1 = await app.inject({
      method: 'PUT',
      url: `/api/admin/v1/posts/${post.id}`,
      headers: { cookie: editorCookie, origin: 'http://localhost:7777' },
      payload: { title: 'Updated Title 1', expectedVersion: 1 },
    });
    expect(update1.statusCode).toBe(200);

    // Second update with stale version 1 -> 409 Conflict
    const update2 = await app.inject({
      method: 'PUT',
      url: `/api/admin/v1/posts/${post.id}`,
      headers: { cookie: editorCookie, origin: 'http://localhost:7777' },
      payload: { title: 'Updated Title 2', expectedVersion: 1 },
    });

    expect(update2.statusCode).toBe(409);
    expect(update2.json().errors[0].code).toBe('CONTENT_CONFLICT');
  });

  it('does not leak members/paid visibility content through public content API or lists', async () => {
    const editorCookie = await getCookieFor('editor@vibress.test', editorPassword);

    // Create + publish a members-only post
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/v1/posts',
      headers: { cookie: editorCookie, origin: 'http://localhost:7777' },
      payload: {
        title: 'Members Only Post',
        slug: `members-only-${Date.now()}`,
        visibility: 'members',
        primaryAuthorId: editorUser.id,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const post = createRes.json().post;
    expect(post.visibility).toBe('members');

    const publishRes = await app.inject({
      method: 'POST',
      url: `/api/admin/v1/posts/${post.id}/publish`,
      headers: { cookie: editorCookie, origin: 'http://localhost:7777' },
    });
    expect(publishRes.statusCode).toBe(200);

    // Public content API must not serve it
    const publicBySlug = await app.inject({
      method: 'GET',
      url: `/api/content/v1/posts/${post.slug}`,
    });
    expect(publicBySlug.statusCode).toBe(404);

    // Public list must not include it
    const publicList = await app.inject({
      method: 'GET',
      url: '/api/content/v1/posts?limit=100',
    });
    const listSlugs = publicList.json().posts.map((p: { slug: string }) => p.slug);
    expect(listSlugs).not.toContain(post.slug);

    // Admin API still sees it
    const adminGet = await app.inject({
      method: 'GET',
      url: `/api/admin/v1/posts/${post.id}`,
      headers: { cookie: editorCookie },
    });
    expect(adminGet.statusCode).toBe(200);

    // Same for a members-only page
    const pageRes = await app.inject({
      method: 'POST',
      url: '/api/admin/v1/pages',
      headers: { cookie: editorCookie, origin: 'http://localhost:7777' },
      payload: {
        title: 'Members Only Page',
        slug: `members-page-${Date.now()}`,
        visibility: 'members',
        primaryAuthorId: editorUser.id,
      },
    });
    expect(pageRes.statusCode).toBe(201);
    const page = pageRes.json().page;

    const pagePublish = await app.inject({
      method: 'POST',
      url: `/api/admin/v1/pages/${page.id}/publish`,
      headers: { cookie: editorCookie, origin: 'http://localhost:7777' },
    });
    expect(pagePublish.statusCode).toBe(200);

    const publicPage = await app.inject({
      method: 'GET',
      url: `/api/content/v1/pages/${page.slug}`,
    });
    expect(publicPage.statusCode).toBe(404);
  });
});
