import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrations, seedDatabase, getDbPool, closeDbPool } from '@vibress/database';
import { DrizzleUserRepository, UsersService } from '@vibress/users';
import { DrizzleRoleRepository, RolesService } from '@vibress/roles';
import { DrizzleAuditRepository, AuditService } from '@vibress/audit';
import { DrizzleRevisionRepository, RevisionsService } from '@vibress/revisions';
import { DrizzleTagRepository, TagsService } from '@vibress/tags';
import { DrizzleAuthorRepository, AuthorsService } from '@vibress/authors';
import { DrizzlePostRepository, PostsService } from '@vibress/posts';
import { DrizzlePageRepository, PagesService } from '@vibress/pages';
import { hashPassword } from '@vibress/security';

describe('Content Core Database Integration', () => {
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
  let auditService: AuditService;
  let revisionsService: RevisionsService;
  let tagsService: TagsService;
  let authorsService: AuthorsService;
  let postsService: PostsService;
  let pagesService: PagesService;

  let testUser: any;

  beforeAll(async () => {
    await runMigrations();

    const pool = getDbPool();
    await pool.query(`
      TRUNCATE TABLE audit_events, sessions, role_permissions, user_roles, permissions, roles, revisions, post_tags, post_authors, page_authors, tags, pages, posts, users CASCADE;
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
    auditService = new AuditService(auditRepo);
    revisionsService = new RevisionsService(revisionRepo);
    tagsService = new TagsService(tagRepo);
    authorsService = new AuthorsService(authorRepo);
    postsService = new PostsService(postRepo, revisionsService, authorRepo, auditRepo);
    pagesService = new PagesService(pageRepo, revisionsService, authorRepo, auditRepo);

    // Create test author user
    const passHash = await hashPassword('AuthorPass123!');
    testUser = await usersService.createUser({
      email: 'content.author@vibress.local',
      name: 'Content Author',
      passwordHash: passHash,
    });
    const ownerRole = await rolesService.findByKey('owner');
    await rolesService.assignRoleToUser(testUser.id, ownerRole!.id);
  }, 30000);

  afterAll(async () => {
    await closeDbPool();
  });

  it('creates, updates, and soft deletes posts with revisions', async () => {
    const post = await postsService.createPost(
      {
        title: 'Integration Test Post',
        excerpt: 'Test Excerpt',
        content: { version: 1, text: 'Initial Content' },
        primaryAuthorId: testUser.id,
      },
      testUser.id
    );

    expect(post.title).toBe('Integration Test Post');
    expect(post.slug).toBe('integration-test-post');
    expect(post.status).toBe('draft');
    expect(post.version).toBe(1);

    // Verify initial revision
    const revs1 = await revisionsService.getRevisions('post', post.id);
    expect(revs1.length).toBe(1);
    expect(revs1[0]?.revisionNumber).toBe(1);

    // Update post
    const updated = await postsService.updatePost(
      post.id,
      { title: 'Updated Integration Test Post', content: { version: 1, text: 'Updated Content' } },
      testUser.id
    );

    expect(updated.title).toBe('Updated Integration Test Post');
    expect(updated.version).toBe(2);

    const revs2 = await revisionsService.getRevisions('post', post.id);
    expect(revs2.length).toBe(2);

    // Restore previous revision (revision 1)
    const restored = await postsService.restoreRevision(post.id, revs1[0]!.id, testUser.id);
    expect(restored.title).toBe('Integration Test Post');

    const revs3 = await revisionsService.getRevisions('post', post.id);
    expect(revs3.length).toBe(3); // Restore creates a new revision!

    // Soft delete
    await postsService.deletePost(post.id, testUser.id);
    const foundAfterDelete = await postsService.findById(post.id);
    expect(foundAfterDelete).toBeNull();
  });

  it('enforces optimistic concurrency control (version conflict)', async () => {
    const post = await postsService.createPost(
      { title: 'Concurrency Post', primaryAuthorId: testUser.id },
      testUser.id
    );

    // Simulate Client A updating post (version 1 -> 2)
    await postsService.updatePost(
      post.id,
      { title: 'Client A Title', expectedVersion: 1 },
      testUser.id
    );

    // Simulate Client B attempting to update using stale version 1 -> fails with CONTENT_CONFLICT
    await expect(
      postsService.updatePost(
        post.id,
        { title: 'Client B Title', expectedVersion: 1 },
        testUser.id
      )
    ).rejects.toThrow('Content has been modified by another request');
  });

  it('manages tags and tag assignment to posts', async () => {
    const tag1 = await tagsService.createTag({ name: 'Technology' });
    const tag2 = await tagsService.createTag({ name: 'Tutorial' });

    expect(tag1.slug).toBe('technology');
    expect(tag2.slug).toBe('tutorial');

    const post = await postsService.createPost(
      {
        title: 'Tagged Post',
        primaryAuthorId: testUser.id,
        tagIds: [tag1.id, tag2.id],
      },
      testUser.id
    );

    const postTagIds = await postsService.getPostTagIds(post.id);
    expect(postTagIds).toContain(tag1.id);
    expect(postTagIds).toContain(tag2.id);

    // Delete tag1 -> removes association safely without deleting post
    await tagsService.deleteTag(tag1.id);
    const postTagIdsAfterDelete = await postsService.getPostTagIds(post.id);
    expect(postTagIdsAfterDelete).not.toContain(tag1.id);

    const postAfterTagDelete = await postsService.findById(post.id);
    expect(postAfterTagDelete).not.toBeNull();
  });

  it('manages pages CRUD and publication state', async () => {
    const page = await pagesService.createPage(
      { title: 'About Us', primaryAuthorId: testUser.id },
      testUser.id
    );

    expect(page.title).toBe('About Us');
    expect(page.slug).toBe('about-us');
    expect(page.status).toBe('draft');

    const publishedPage = await pagesService.publishPage(page.id, testUser.id);
    expect(publishedPage.status).toBe('published');
    expect(publishedPage.publishedAt).toBeDefined();

    const unpublishedPage = await pagesService.unpublishPage(page.id, testUser.id);
    expect(unpublishedPage.status).toBe('draft');
  });
});
