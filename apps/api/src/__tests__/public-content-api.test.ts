import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../main';
import { FastifyInstance } from 'fastify';
import { postsService, pagesService, tagsService, authorsService, usersService } from '../services';
import { hashPassword } from '@vibress/security';

describe('Batch 6 — Public Content API & Visibility Security Integration', () => {
  let app: FastifyInstance;
  let testAuthorId: string;
  let testAuthorSlug: string;
  let testTagId: string;
  let testTagSlug: string;

  let publishedPostSlug: string;
  let draftPostSlug: string;
  let scheduledPostSlug: string;
  let publishedPageSlug: string;
  let draftPageSlug: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    // Create a test author user
    const pwHash = await hashPassword('AuthorPass123!');
    const author = await usersService.createUser({
      email: `public.author.${Date.now()}@example.com`,
      name: 'Public Test Author',
      slug: `public-author-${Date.now()}`,
      bio: 'Lover of open publishing.',
      passwordHash: pwHash,
      status: 'active',
    });
    testAuthorId = author.id;
    testAuthorSlug = author.slug!;

    // Create a test tag
    const tag = await tagsService.createTag({
      name: `PublicTag-${Date.now()}`,
      slug: `public-tag-${Date.now()}`,
      description: 'A tag for public tests',
    });
    testTagId = tag.id;
    testTagSlug = tag.slug;

    // Create Published Post
    const pubPost = await postsService.createPost(
      {
        title: 'Published Public Post',
        slug: `pub-post-${Date.now()}`,
        excerpt: 'Summary of published post',
        content: {
          schema: 'vibress-studio',
          version: 1,
          root: {
            type: 'root',
            children: [
              {
                type: 'paragraph',
                children: [{ type: 'text', text: 'Hello public world of Vibress!' }],
              },
            ],
          },
        },
        primaryAuthorId: testAuthorId,
        tagIds: [testTagId],
      },
      testAuthorId
    );
    await postsService.publishPost(pubPost.id, testAuthorId);
    publishedPostSlug = pubPost.slug;

    // Create Draft Post
    const draftPost = await postsService.createPost(
      {
        title: 'Draft Secret Post',
        slug: `draft-post-${Date.now()}`,
        excerpt: 'Secret draft post summary',
        content: {
          schema: 'vibress-studio',
          version: 1,
          root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Draft content' }] }] },
        },
        primaryAuthorId: testAuthorId,
      },
      testAuthorId
    );
    draftPostSlug = draftPost.slug;

    // Create Scheduled Post in future
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const schedPost = await postsService.createPost(
      {
        title: 'Future Scheduled Post',
        slug: `sched-post-${Date.now()}`,
        excerpt: 'Future scheduled post summary',
        content: { schema: 'vibress-studio', version: 1, root: { type: 'root', children: [] } },
        primaryAuthorId: testAuthorId,
      },
      testAuthorId
    );
    await postsService.schedulePost(schedPost.id, futureDate, testAuthorId);
    scheduledPostSlug = schedPost.slug;

    // Create Published Page
    const pubPage = await pagesService.createPage(
      {
        title: 'Published About Page',
        slug: `about-page-${Date.now()}`,
        excerpt: 'About us page summary',
        content: {
          schema: 'vibress-studio',
          version: 1,
          root: {
            type: 'root',
            children: [{ type: 'paragraph', children: [{ type: 'text', text: 'About Vibress platform.' }] }],
          },
        },
        primaryAuthorId: testAuthorId,
      },
      testAuthorId
    );
    await pagesService.publishPage(pubPage.id, testAuthorId);
    publishedPageSlug = pubPage.slug;

    // Create Draft Page
    const draftPage = await pagesService.createPage(
      {
        title: 'Draft Private Page',
        slug: `draft-page-${Date.now()}`,
        excerpt: 'Private page summary',
        content: { schema: 'vibress-studio', version: 1, root: { type: 'root', children: [] } },
        primaryAuthorId: testAuthorId,
      },
      testAuthorId
    );
    draftPageSlug = draftPage.slug;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should list published posts and exclude drafts and scheduled future posts', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/content/v1/posts',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.posts).toBeDefined();
    expect(Array.isArray(body.posts)).toBe(true);

    const slugs = body.posts.map((p: any) => p.slug);
    expect(slugs).toContain(publishedPostSlug);
    expect(slugs).not.toContain(draftPostSlug);
    expect(slugs).not.toContain(scheduledPostSlug);
  });

  it('should fetch published post by slug with rendered HTML and DTO allowlisting', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/content/v1/posts/${publishedPostSlug}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.post).toBeDefined();
    expect(body.post.slug).toBe(publishedPostSlug);
    expect(body.post.html).toContain('<p>Hello public world of Vibress!</p>');
    expect(body.post.seo).toBeDefined();
    expect(body.post.seo.canonicalUrl).toContain(publishedPostSlug);

    // Verify DTO security allowlist (no internal DB/auth leakage)
    expect(body.post.passwordHash).toBeUndefined();
    expect(body.post.createdBy).toBeUndefined();
    expect(body.post.updatedBy).toBeUndefined();
    expect(body.post.publishedBy).toBeUndefined();
    expect(body.post.primaryAuthorId).toBeUndefined();
  });

  it('should return 404 for draft post, scheduled future post, and invalid slug', async () => {
    const draftRes = await app.inject({
      method: 'GET',
      url: `/api/content/v1/posts/${draftPostSlug}`,
    });
    expect(draftRes.statusCode).toBe(404);
    const draftErr = JSON.parse(draftRes.body);
    expect(draftErr.errors[0].code).toBe('CONTENT_NOT_FOUND');

    const schedRes = await app.inject({
      method: 'GET',
      url: `/api/content/v1/posts/${scheduledPostSlug}`,
    });
    expect(schedRes.statusCode).toBe(404);

    const invalidRes = await app.inject({
      method: 'GET',
      url: '/api/content/v1/posts/non-existent-slug-xyz',
    });
    expect(invalidRes.statusCode).toBe(404);
  });

  it('should prevent draft leakage through authenticated staff session on public endpoints', async () => {
    // Even if auth headers or cookies are sent, public content endpoints MUST NOT leak drafts!
    const res = await app.inject({
      method: 'GET',
      url: `/api/content/v1/posts/${draftPostSlug}`,
      headers: {
        authorization: 'Bearer fake-staff-token',
        cookie: 'sessionToken=fake-staff-session',
      },
    });

    expect(res.statusCode).toBe(404);
  });

  it('should fetch published page by slug and return 404 for draft page', async () => {
    const pubRes = await app.inject({
      method: 'GET',
      url: `/api/content/v1/pages/${publishedPageSlug}`,
    });

    expect(pubRes.statusCode).toBe(200);
    const body = JSON.parse(pubRes.body);
    expect(body.page.slug).toBe(publishedPageSlug);
    expect(body.page.html).toContain('<p>About Vibress platform.</p>');

    const draftRes = await app.inject({
      method: 'GET',
      url: `/api/content/v1/pages/${draftPageSlug}`,
    });
    expect(draftRes.statusCode).toBe(404);
  });

  it('should list tags and fetch tag posts archive', async () => {
    const tagsRes = await app.inject({
      method: 'GET',
      url: '/api/content/v1/tags',
    });
    expect(tagsRes.statusCode).toBe(200);

    const tagPostsRes = await app.inject({
      method: 'GET',
      url: `/api/content/v1/tags/${testTagSlug}/posts`,
    });
    expect(tagPostsRes.statusCode).toBe(200);
    const body = JSON.parse(tagPostsRes.body);
    expect(body.tag.slug).toBe(testTagSlug);
    expect(body.posts.length).toBeGreaterThanOrEqual(1);
    expect(body.posts[0].slug).toBe(publishedPostSlug);
  });

  it('should list authors and fetch author posts archive', async () => {
    const authorPostsRes = await app.inject({
      method: 'GET',
      url: `/api/content/v1/authors/${testAuthorSlug}/posts`,
    });

    expect(authorPostsRes.statusCode).toBe(200);
    const body = JSON.parse(authorPostsRes.body);
    expect(body.author.slug).toBe(testAuthorSlug);
    expect(body.posts.length).toBeGreaterThanOrEqual(1);
  });

  it('should enforce Studio renderer XSS protection on public HTML output', async () => {
    const xssPost = await postsService.createPost(
      {
        title: 'Malicious XSS Post',
        slug: `xss-post-${Date.now()}`,
        content: {
          schema: 'vibress-studio',
          version: 1,
          root: {
            type: 'root',
            children: [
              {
                type: 'paragraph',
                children: [
                  { type: 'text', text: '<script>alert("xss")</script>' },
                ],
              },
              {
                type: 'link',
                url: 'javascript:alert(1)',
                children: [{ type: 'text', text: 'Unsafe link' }],
              },
            ],
          },
        },
        primaryAuthorId: testAuthorId,
      },
      testAuthorId
    );
    await postsService.publishPost(xssPost.id, testAuthorId);

    const res = await app.inject({
      method: 'GET',
      url: `/api/content/v1/posts/${xssPost.slug}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.post.html).not.toContain('<script>');
    expect(body.post.html).toContain('&lt;script&gt;');
    expect(body.post.html).not.toContain('href="javascript:');
  });
});
