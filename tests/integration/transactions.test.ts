import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrations, seedDatabase, getDbPool, closeDbPool, runInTransaction, isInsideTransaction } from '@vibress/database';
import { DrizzleUserRepository, UsersService } from '@vibress/users';
import { DrizzleRoleRepository, RolesService } from '@vibress/roles';
import { DrizzleAuditRepository } from '@vibress/audit';
import { DrizzleRevisionRepository, RevisionsService } from '@vibress/revisions';
import { DrizzleTagRepository, TagsService } from '@vibress/tags';
import { DrizzleAuthorRepository } from '@vibress/authors';
import { DrizzlePostRepository, PostsService } from '@vibress/posts';
import { DrizzlePageRepository, PagesService } from '@vibress/pages';
import { DrizzleMediaRepository, MediaService } from '@vibress/media';
import { defaultStorageRegistry } from '@vibress/storage-core';
import { hashPassword } from '@vibress/security';

describe('Transaction Infrastructure', () => {
  let userRepo: DrizzleUserRepository;
  let roleRepo: DrizzleRoleRepository;
  let auditRepo: DrizzleAuditRepository;
  let revisionRepo: DrizzleRevisionRepository;
  let tagRepo: DrizzleTagRepository;
  let authorRepo: DrizzleAuthorRepository;
  let postRepo: DrizzlePostRepository;
  let pageRepo: DrizzlePageRepository;

  let usersService: UsersService;
  let rolesService: RolesService;
  let tagsService: TagsService;
  let testTagId: string;
  let testUser: any;

  beforeAll(async () => {
    await runMigrations();

    const pool = getDbPool();
    await pool.query(`
      TRUNCATE TABLE audit_events, sessions, media_references, media_assets, revisions, post_tags, post_authors, page_authors, tags, pages, posts, users CASCADE;
    `);

    await seedDatabase();

    userRepo = new DrizzleUserRepository();
    roleRepo = new DrizzleRoleRepository();
    auditRepo = new DrizzleAuditRepository();
    revisionRepo = new DrizzleRevisionRepository();
    tagRepo = new DrizzleTagRepository();
    authorRepo = new DrizzleAuthorRepository();
    postRepo = new DrizzlePostRepository();
    pageRepo = new DrizzlePageRepository();

    usersService = new UsersService(userRepo);
    rolesService = new RolesService(roleRepo);
    tagsService = new TagsService(tagRepo);

    const passHash = await hashPassword('AuthorPass123!');
    testUser = await usersService.createUser({
      email: 'tx.author@vibress.local',
      name: 'Tx Author',
      passwordHash: passHash,
    });
    const ownerRole = await rolesService.findByKey('owner');
    await rolesService.assignRoleToUser(testUser.id, ownerRole!.id);

    const tag = await tagsService.createTag({ name: 'Tx Tag', slug: 'tx-tag' });
    testTagId = tag.id;
  }, 30000);

  afterAll(async () => {
    await closeDbPool();
  });

  async function countRows(table: string, where = '1=1'): Promise<number> {
    const pool = getDbPool();
    const res = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${where}`);
    return res.rows[0].n;
  }

  function makePostsService(
    overrides: {
      failAudit?: boolean;
      failRevision?: boolean;
      failTags?: boolean;
      failMedia?: boolean;
    } = {}
  ): PostsService {
    const failingAuditRepo = new DrizzleAuditRepository();
    const originalRecord = failingAuditRepo.record.bind(failingAuditRepo);
    failingAuditRepo.record = async (data) => {
      if (overrides.failAudit) throw new Error('injected: audit insert failure');
      return originalRecord(data);
    };

    const failingRevisionRepo = new DrizzleRevisionRepository();
    const originalCreateRevision = failingRevisionRepo.createRevision.bind(failingRevisionRepo);
    failingRevisionRepo.createRevision = async (data) => {
      if (overrides.failRevision) throw new Error('injected: revision insert failure');
      return originalCreateRevision(data);
    };

    const failingPostRepo = new DrizzlePostRepository();
    const originalSetTags = failingPostRepo.setPostTagIds.bind(failingPostRepo);
    failingPostRepo.setPostTagIds = async (postId, tagIds) => {
      if (overrides.failTags) throw new Error('injected: tag insert failure');
      return originalSetTags(postId, tagIds);
    };

    const failingMediaRepo = new DrizzleMediaRepository();
    const originalReplaceRefs = failingMediaRepo.replaceResourceReferences.bind(failingMediaRepo);
    failingMediaRepo.replaceResourceReferences = async (
      resourceType: string,
      resourceId: string,
      mediaIdsWithPaths: Array<{ mediaId: string; fieldPath?: string }>
    ) => {
      if (overrides.failMedia) throw new Error('injected: media reference failure');
      return originalReplaceRefs(resourceType, resourceId, mediaIdsWithPaths);
    };

    const failingMediaService = new MediaService(failingMediaRepo, defaultStorageRegistry);
    const revisionsService = new RevisionsService(failingRevisionRepo);

    return new PostsService(
      failingPostRepo,
      revisionsService,
      authorRepo,
      failingAuditRepo,
      failingMediaService
    );
  }

  it('commits when work succeeds', async () => {
    const user = await runInTransaction(async () => {
      // Nested runs reuse the outer transaction
      return runInTransaction(async () => {
        return usersService.createUser({
          email: 'tx.commit@vibress.local',
          name: 'Tx Commit',
          passwordHash: await hashPassword('TxSuperSecretPass123!'),
        });
      });
    });
    expect(user.id).toBeTruthy();
    expect(await countRows('users', `email = 'tx.commit@vibress.local'`)).toBe(1);
  });

  it('rolls back when work throws', async () => {
    await expect(
      runInTransaction(async () => {
        await usersService.createUser({
          email: 'tx.rollback@vibress.local',
          name: 'Tx Rollback',
          passwordHash: await hashPassword('TxSuperSecretPass123!'),
        });
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(await countRows('users', `email = 'tx.rollback@vibress.local'`)).toBe(0);
  });

  it('nested failure rolls back everything, inner success cannot escape outer rollback', async () => {
    await expect(
      runInTransaction(async () => {
        await usersService.createUser({
          email: 'tx.nested@vibress.local',
          name: 'Tx Nested',
          passwordHash: await hashPassword('TxSuperSecretPass123!'),
        });
        await runInTransaction(async () => {
          await usersService.createUser({
            email: 'tx.nested.inner@vibress.local',
            name: 'Tx Nested Inner',
            passwordHash: await hashPassword('TxSuperSecretPass123!'),
          });
        });
        throw new Error('outer failure');
      })
    ).rejects.toThrow('outer failure');
    expect(await countRows('users', `email LIKE 'tx.nested%'`)).toBe(0);
  });

  it('isInsideTransaction reflects context', async () => {
    expect(isInsideTransaction()).toBe(false);
    await runInTransaction(async () => {
      expect(isInsideTransaction()).toBe(true);
    });
  });

  describe('post creation failure injection', () => {
    it('audit insert failure rolls back post, authors, tags, and revision', async () => {
      const service = makePostsService({ failAudit: true });
      await expect(
        service.createPost(
          { title: 'Tx Audit Fail', primaryAuthorId: testUser.id, tagIds: [testTagId] },
          testUser.id
        )
      ).rejects.toThrow('injected: audit insert failure');

      expect(await countRows('posts', `title = 'Tx Audit Fail'`)).toBe(0);
      expect(await countRows('revisions', `title = 'Tx Audit Fail'`)).toBe(0);
      expect(await countRows('audit_events', `metadata->>'title' = 'Tx Audit Fail'`)).toBe(0);
    });

    it('revision insert failure rolls back post and author assignments', async () => {
      const service = makePostsService({ failRevision: true });
      await expect(
        service.createPost({ title: 'Tx Revision Fail', primaryAuthorId: testUser.id }, testUser.id)
      ).rejects.toThrow('injected: revision insert failure');

      expect(await countRows('posts', `title = 'Tx Revision Fail'`)).toBe(0);
      expect(await countRows('post_authors', `post_id IN (SELECT id FROM posts WHERE title = 'Tx Revision Fail')`)).toBe(0);
    });

    it('tag insert failure rolls back post and authors', async () => {
      const service = makePostsService({ failTags: true });
      await expect(
        service.createPost(
          { title: 'Tx Tag Fail', primaryAuthorId: testUser.id, tagIds: [testTagId] },
          testUser.id
        )
      ).rejects.toThrow('injected: tag insert failure');

      expect(await countRows('posts', `title = 'Tx Tag Fail'`)).toBe(0);
      expect(await countRows('post_authors', `post_id IN (SELECT id FROM posts WHERE title = 'Tx Tag Fail')`)).toBe(0);
      expect(await countRows('audit_events', `metadata->>'title' = 'Tx Tag Fail'`)).toBe(0);
    });

    it('successful create leaves consistent state', async () => {
      const service = makePostsService();
      const post = await service.createPost(
        { title: 'Tx Happy Path', primaryAuthorId: testUser.id, tagIds: [testTagId] },
        testUser.id
      );
      expect(await countRows('posts', `id = '${post.id}'`)).toBe(1);
      expect(await countRows('post_authors', `post_id = '${post.id}'`)).toBe(1);
      expect(await countRows('revisions', `resource_id = '${post.id}'`)).toBe(1);
      expect(await countRows('audit_events', `target_id = '${post.id}'`)).toBe(1);
    });
  });

  describe('post update failure injection', () => {
    it('media reference failure rolls back title and author changes', async () => {
      const happyService = makePostsService();
      const post = await happyService.createPost(
        { title: 'Tx Update Base', primaryAuthorId: testUser.id },
        testUser.id
      );

      const service = makePostsService({ failMedia: true });
      await expect(
        service.updatePost(
          post.id,
          { title: 'Tx Update Changed', content: { version: 1, text: 'changed' } },
          testUser.id
        )
      ).rejects.toThrow('injected: media reference failure');

      const pool = getDbPool();
      const res = await pool.query(`SELECT title FROM posts WHERE id = $1`, [post.id]);
      expect(res.rows[0].title).toBe('Tx Update Base');
      expect(await countRows('revisions', `resource_id = '${post.id}'`)).toBe(1);
      expect(await countRows('audit_events', `metadata->>'title' = 'Tx Update Changed'`)).toBe(0);
    });
  });

  describe('publish failure injection', () => {
    it('revision failure on publish reverts post status', async () => {
      const happyService = makePostsService();
      const post = await happyService.createPost(
        { title: 'Tx Publish Base', primaryAuthorId: testUser.id },
        testUser.id
      );
      await happyService.publishPost(post.id, testUser.id);

      const service = makePostsService({ failRevision: true });
      await expect(service.publishPost(post.id, testUser.id)).rejects.toThrow(
        'injected: revision insert failure'
      );

      const pool = getDbPool();
      const res = await pool.query(`SELECT status FROM posts WHERE id = $1`, [post.id]);
      expect(res.rows[0].status).toBe('published');
    });
  });

  describe('author setter atomicity', () => {
    it('FK failure during insert leaves existing authors intact', async () => {
      const service = makePostsService();
      const post = await service.createPost(
        { title: 'Tx Author Replace Base', primaryAuthorId: testUser.id },
        testUser.id
      );
      expect(await countRows('post_authors', `post_id = '${post.id}'`)).toBe(1);

      // Bogus user id violates FK; delete must roll back along with the failed insert
      await expect(
        authorRepo.setPostAuthors(post.id, ['00000000-0000-0000-0000-000000000000'], testUser.id)
      ).rejects.toThrow();

      expect(await countRows('post_authors', `post_id = '${post.id}'`)).toBe(1);
      expect(await countRows('post_authors', `post_id = '${post.id}' AND user_id = '${testUser.id}'`)).toBe(1);
    });
  });

  describe('page creation failure injection', () => {
    it('audit failure rolls back page and authors', async () => {
      const failingAuditRepo = new DrizzleAuditRepository();
      const originalRecord = failingAuditRepo.record.bind(failingAuditRepo);
      failingAuditRepo.record = async (data) => {
        throw new Error('injected: audit insert failure');
      };
      const revisionsService = new RevisionsService(revisionRepo);
      const service = new PagesService(pageRepo, revisionsService, authorRepo, failingAuditRepo);

      await expect(
        service.createPage({ title: 'Tx Page Fail', primaryAuthorId: testUser.id }, testUser.id)
      ).rejects.toThrow('injected: audit insert failure');

      expect(await countRows('pages', `title = 'Tx Page Fail'`)).toBe(0);
      expect(await countRows('page_authors', `page_id IN (SELECT id FROM pages WHERE title = 'Tx Page Fail')`)).toBe(0);
      expect(await countRows('audit_events', `metadata->>'title' = 'Tx Page Fail'`)).toBe(0);
    });
  });
});