import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../apps/api/src/main';
import { getDbPool, closeDbPool, seedDatabase, runMigrations } from '@vibress/database';
import { hashPassword } from '@vibress/security';
import { DrizzleUserRepository, UsersService } from '@vibress/users';
import { DrizzleRoleRepository, RolesService } from '@vibress/roles';
import crypto from 'node:crypto';

/**
 * Public Content API — Studio card coverage.
 *
 * Proves that Posts AND Pages created with every supported Studio card type
 * (plus a legacy react-studio-card fixture) are served by the public Content
 * API with canonical content and fully rendered, sanitized semantic HTML.
 */
describe('Studio public content (Posts + Pages)', () => {
  let app: ReturnType<typeof buildApp>;
  let ownerCookie = '';
  let ownerId = '';

  const mediaAssetIds = {
    image: crypto.randomUUID(),
    galleryA: crypto.randomUUID(),
    galleryB: crypto.randomUUID(),
    video: crypto.randomUUID(),
    audio: crypto.randomUUID(),
    file: crypto.randomUUID(),
  };

  const ALL_CARDS = [
    { cardType: 'image', cardData: { assetId: '', src: '/seed.png', alt: 'Alt text', caption: 'A caption' } },
    { cardType: 'gallery', cardData: { images: [{ assetId: '', src: '/g1.png', alt: 'one' }, { assetId: '', src: '/g2.png', alt: 'two' }] } },
    { cardType: 'video', cardData: { assetId: '', src: '/v.mp4', caption: 'Video caption' } },
    { cardType: 'audio', cardData: { assetId: '', src: '/a.mp3', title: 'Podcast' } },
    { cardType: 'file', cardData: { assetId: '', src: '/f.pdf', fileName: 'report.pdf', fileSize: '1.2 MB' } },
    { cardType: 'bookmark', cardData: { url: 'https://example.com/a', title: 'Example', description: 'desc' } },
    { cardType: 'embed', cardData: { url: 'https://www.youtube.com/watch?v=abc123', embedType: 'video' } },
    { cardType: 'button', cardData: { text: 'Buy now', url: 'https://store.example/p' } },
    { cardType: 'callout', cardData: { text: 'Note this', emoji: '💡', backgroundColor: 'grey' } },
    { cardType: 'toggle', cardData: { heading: 'FAQ', content: 'Answer text' } },
    { cardType: 'markdown', cardData: { markdown: '**bold** markdown' } },
    { cardType: 'html', cardData: { html: '<div class="widget">Safe widget</div><script>alert(1)</script>' } },
    { cardType: 'divider', cardData: {} },
  ] as Array<{ cardType: string; cardData: Record<string, unknown> }>;

  const cardNodes = (type = 'studio-card') =>
    ALL_CARDS.map((c) => {
      const data = JSON.parse(JSON.stringify(c.cardData)) as Record<string, unknown>;
      const assetFor: Record<string, string> = {
        image: mediaAssetIds.image,
        video: mediaAssetIds.video,
        audio: mediaAssetIds.audio,
        file: mediaAssetIds.file,
      };
      if (typeof data.assetId === 'string' && assetFor[c.cardType]) {
        data.assetId = assetFor[c.cardType];
      }
      if (Array.isArray(data.images)) {
        data.images = data.images.map((img, i) => ({
          ...(img as Record<string, unknown>),
          assetId: i === 0 ? mediaAssetIds.galleryA : mediaAssetIds.galleryB,
        }));
      }
      return { type, cardType: c.cardType, cardData: data, version: 1 };
    });

  async function loginAsOwner() {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/v1/auth/login',
      payload: { email: 'st-owner@test.local', password: 'AnalyticsPass123!' },
    });
    expect(res.statusCode).toBe(200);
    const setCookie = (res.headers['set-cookie'] as unknown as string) || '';
    ownerCookie = setCookie.split(';')[0] ?? '';
    ownerId = res.json().user.id;
  }

  async function createPublishedPost(title: string, slug: string, nodes: unknown[]): Promise<string> {
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/v1/posts',
      headers: { cookie: ownerCookie, 'content-type': 'application/json', origin: 'http://localhost:7777' },
      payload: {
        title,
        slug,
        primaryAuthorId: ownerId,
        content: { schema: 'vibress-studio', version: 1, root: { type: 'root', children: nodes } },
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().post.id;
    const pub = await app.inject({
      method: 'POST',
      url: `/api/admin/v1/posts/${id}/publish`,
      headers: { cookie: ownerCookie, 'content-type': 'application/json', origin: 'http://localhost:7777' },
      payload: {},
    });
    expect(pub.statusCode).toBe(200);
    return id;
  }

  beforeAll(async () => {
    await runMigrations();
    const pool = getDbPool();
    await pool.query(`
      TRUNCATE TABLE media_references, media_assets, pages, posts, revisions, audit_events,
      sessions, role_permissions, user_roles, permissions, roles, users CASCADE;
    `);
    await seedDatabase({ skipDevUsers: true });

    const userRepo = new DrizzleUserRepository();
    const roleRepo = new DrizzleRoleRepository();
    const usersService = new UsersService(userRepo);
    const rolesService = new RolesService(roleRepo);
    const hash = await hashPassword('AnalyticsPass123!');
    const user = await usersService.createUser({
      email: 'st-owner@test.local',
      name: 'Studio Owner',
      passwordHash: hash,
      status: 'active',
    });
    const role = await rolesService.findByKey('owner');
    if (role) await rolesService.assignRoleToUser(user.id, role.id);

    // Seed media assets so resolveDocumentMedia can produce durable URLs.
    const now = new Date().toISOString();
    const assetRows = [
      [mediaAssetIds.image, 'media/seed-image.png', 'seed.png', 'seed.png', 'image/png', 'png', 1024, 'image'],
      [mediaAssetIds.galleryA, 'media/g1.png', 'g1.png', 'g1.png', 'image/png', 'png', 512, 'image'],
      [mediaAssetIds.galleryB, 'media/g2.png', 'g2.png', 'g2.png', 'image/png', 'png', 512, 'image'],
      [mediaAssetIds.video, 'media/v.mp4', 'v.mp4', 'v.mp4', 'video/mp4', 'mp4', 4096, 'video'],
      [mediaAssetIds.audio, 'media/a.mp3', 'a.mp3', 'a.mp3', 'audio/mpeg', 'mp3', 2048, 'audio'],
      [mediaAssetIds.file, 'media/f.pdf', 'f.pdf', 'f.pdf', 'application/pdf', 'pdf', 1024, 'file'],
    ] as const;
    for (const [id, key, name, display, mime, ext, size, type] of assetRows) {
      await pool.query(
        `INSERT INTO media_assets (id, storage_provider, storage_key, original_filename, display_name, mime_type, extension, size_bytes, checksum, asset_type, created_at, updated_at)
         VALUES ($1, 'local', $2, $3, $4, $5, $6, $7, 'deadbeef', $8, $9, $9)`,
        [id, key, name, display, mime, ext, size, type, now]
      );
    }

    app = buildApp();
    await app.ready();
    await loginAsOwner();
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
    await closeDbPool();
  });

  it('serves all card types through the public Content API (Post)', async () => {
    const slug = `studio-cards-post-${Date.now()}`;
    await createPublishedPost('Studio Cards Post', slug, cardNodes('studio-card'));

    const res = await app.inject({ method: 'GET', url: `/api/content/v1/posts/${slug}` });
    expect(res.statusCode).toBe(200);
    const body = res.json().post;

    // content: canonical nodes with resolved media URLs
    const children = body.content.root.children as Array<{ type: string; cardType: string; cardData: Record<string, unknown> }>;
    expect(children.every((n) => n.type === 'studio-card')).toBe(true);

    const image = children.find((n) => n.cardType === 'image');
    expect(image?.cardData.src).toBe('/content/media/media/seed-image.png');
    expect(image?.cardData.alt).toBe('Alt text');

    const gallery = children.find((n) => n.cardType === 'gallery');
    expect((gallery?.cardData.images as Array<{ src: string }>)[0].src).toContain('/content/media/media/');
    const video = children.find((n) => n.cardType === 'video');
    expect(video?.cardData.src).toBe('/content/media/media/v.mp4');
    const audio = children.find((n) => n.cardType === 'audio');
    expect(audio?.cardData.src).toBe('/content/media/media/a.mp3');
    const file = children.find((n) => n.cardType === 'file');
    expect(file?.cardData.src).toBe('/content/media/media/f.pdf');

    // html: every card rendered as semantic markup (and sanitized)
    const html: string = body.html;
    expect(html).toContain('kg-image-card');
    expect(html).toContain('kg-gallery-card');
    expect(html).toContain('kg-video-card');
    expect(html).toContain('kg-audio-card');
    expect(html).toContain('kg-file-card');
    expect(html).toContain('kg-bookmark-card');
    expect(html).toContain('kg-embed-card');
    expect(html).toContain('kg-button-card');
    expect(html).toContain('kg-callout-card');
    expect(html).toContain('kg-toggle-card');
    expect(html).toContain('<strong>bold</strong>'); // markdown
    expect(html).toContain('<hr>'); // divider
    expect(html).toContain('Safe widget'); // html card
    expect(html).not.toContain('<script');
    expect(html).toContain('https://www.youtube-nocookie.com/embed/abc123');
    // the html card payload carried a script — sanitized away
  });

  it('serves all card types through the public Content API (Page)', async () => {
    const slug = `studio-cards-page-${Date.now()}`;
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/v1/pages',
      headers: { cookie: ownerCookie, 'content-type': 'application/json', origin: 'http://localhost:7777' },
      payload: {
        title: 'Studio Cards Page',
        slug,
        primaryAuthorId: ownerId,
        content: { schema: 'vibress-studio', version: 1, root: { type: 'root', children: cardNodes('studio-card') } },
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().page.id;
    const pub = await app.inject({
      method: 'POST',
      url: `/api/admin/v1/pages/${id}/publish`,
      headers: { cookie: ownerCookie, 'content-type': 'application/json', origin: 'http://localhost:7777' },
      payload: {},
    });
    expect(pub.statusCode).toBe(200);

    const res = await app.inject({ method: 'GET', url: `/api/content/v1/pages/${slug}` });
    expect(res.statusCode).toBe(200);
    const body = res.json().page;
    const children = body.content.root.children as Array<{ cardType: string }>;
    expect(children.length).toBe(13);
    expect(body.html).toContain('kg-image-card');
    expect(body.html).toContain('kg-video-card');
    expect(body.html).toContain('kg-audio-card');
  });

  it('normalizes legacy react-studio-card content at read time', async () => {
    const slug = `legacy-cards-post-${Date.now()}`;
    await createPublishedPost('Legacy Cards Post', slug, cardNodes('react-studio-card'));

    const res = await app.inject({ method: 'GET', url: `/api/content/v1/posts/${slug}` });
    expect(res.statusCode).toBe(200);
    const body = res.json().post;

    // content is returned canonical
    const children = body.content.root.children as Array<{ type: string; cardType: string; cardData: Record<string, unknown> }>;
    expect(children.every((n) => n.type === 'studio-card')).toBe(true);
    const image = children.find((n) => n.cardType === 'image');
    expect(image?.cardData.src).toBe('/content/media/media/seed-image.png');

    // html renders the legacy cards
    expect(body.html).toContain('kg-image-card');
    expect(body.html).toContain('kg-video-card');
  });

  it('does not let a malicious HTML card escape sanitization', async () => {
    const slug = `xss-post-${Date.now()}`;
    const malicious = [
      { type: 'studio-card', cardType: 'html', cardData: {
        html: '<script>alert(1)</script><img src=x onerror=alert(2)><a href="javascript:alert(3)">click</a><div onclick="x()">div</div><iframe srcdoc="<script>alert(4)</script>"></iframe><p>safe paragraph</p>',
      }, version: 1 },
    ];
    await createPublishedPost('XSS Post', slug, malicious);

    const res = await app.inject({ method: 'GET', url: `/api/content/v1/posts/${slug}` });
    expect(res.statusCode).toBe(200);
    const html: string = res.json().post.html;
    expect(html).toContain('safe paragraph');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('srcdoc');
    expect(html).not.toContain('<iframe');
  });
});
