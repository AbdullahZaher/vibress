import { test, expect } from '@playwright/test';

test.describe('Batch 7 Theme Engine E2E Suite', () => {
  let postSlug: string;

  async function loginOwner(request: any) {
    await request.post('http://localhost:7777/api/admin/v1/auth/login', {
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:7777' },
      data: { email: 'owner@example.com', password: 'OwnerPass123!' },
    });
  }

  test.beforeAll(async ({ request }) => {
    await loginOwner(request);

    // Ensure Default theme is active
    await request.post('http://localhost:7777/api/admin/v1/themes/vibress-default/activate', {
      headers: { Origin: 'http://localhost:7777' },
    });

    // Create and publish a test post
    const meRes = await request.get('http://localhost:7777/api/admin/v1/auth/me', {
      headers: { Origin: 'http://localhost:7777' },
    });
    const meData = await meRes.json();
    const ownerId = meData.user.id;

    const postRes = await request.post('http://localhost:7777/api/admin/v1/posts', {
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:7777' },
      data: {
        title: 'Batch 7 Theme Test Post',
        slug: `b7-theme-post-${Date.now()}`,
        excerpt: 'Theme engine test post excerpt',
        content: {
          schema: 'vibress-studio',
          version: 1,
          root: {
            type: 'root',
            children: [
              { type: 'paragraph', children: [{ type: 'text', text: 'Theme engine test body.' }] },
            ],
          },
        },
        primaryAuthorId: ownerId,
      },
    });
    const postData = await postRes.json();
    postSlug = postData.post.slug;
    await request.post(`http://localhost:7777/api/admin/v1/posts/${postData.post.id}/publish`, {
      headers: { Origin: 'http://localhost:7777' },
    });
  });

  test('[Default Theme] Public post renders with default layout and content', async ({ page }) => {
    const res = await page.goto(`http://localhost:7777/posts/${postSlug}`);
    expect(res?.status()).toBe(200);

    await expect(page.locator('[data-theme="vibress-default"]')).toBeAttached();
    await expect(page.locator('h1.article-title')).toContainText('Batch 7 Theme Test Post');
    await expect(page.locator('.studio-html-content')).toContainText('Theme engine test body.');
  });

  test('[Preview] Preview Minimal without activating', async ({ page, request }) => {
    await loginOwner(request);

    // Get preview token via admin API
    const previewRes = await request.post('http://localhost:7777/api/admin/v1/themes/vibress-minimal/preview', {
      headers: { Origin: 'http://localhost:7777' },
    });
    expect(previewRes.status()).toBe(200);
    const previewData = await previewRes.json();
    const token = previewData.previewToken;

    // Visit preview URL — should render Minimal theme
    const res = await page.goto(`http://localhost:7777/preview/${token}/posts/${postSlug}`);
    expect(res?.status()).toBe(200);
    await expect(page.locator('[data-theme="vibress-minimal"]')).toBeAttached();
    await expect(page.locator('h1.gh-article-title')).toContainText('Batch 7 Theme Test Post');

    // Normal public URL still renders Default
    const normal = await page.goto(`http://localhost:7777/posts/${postSlug}`);
    expect(normal?.status()).toBe(200);
    await expect(page.locator('[data-theme="vibress-default"]')).toBeAttached();
  });

  test('[Preview Expired] Invalid/expired token redirects safely', async ({ page }) => {
    const res = await page.goto('http://localhost:7777/preview/invalidtoken123/posts/x');
    expect(res?.status()).toBe(200);
    await expect(page.locator('[data-theme="vibress-default"]')).toBeAttached();
  });

  test('[Theme Switch] Activate Minimal → public renders Minimal with same content', async ({ page, request }) => {
    await loginOwner(request);

    // Activate Minimal
    const actRes = await request.post('http://localhost:7777/api/admin/v1/themes/vibress-minimal/activate', {
      headers: { Origin: 'http://localhost:7777' },
    });
    expect(actRes.status()).toBe(200);

    const res = await page.goto(`http://localhost:7777/posts/${postSlug}`);
    expect(res?.status()).toBe(200);
    await expect(page.locator('[data-theme="vibress-minimal"]')).toBeAttached();
    await expect(page.locator('h1.gh-article-title')).toContainText('Batch 7 Theme Test Post');
    await expect(page.locator('.studio-html-content')).toContainText('Theme engine test body.');

    // Restore Default
    await request.post('http://localhost:7777/api/admin/v1/themes/vibress-default/activate', {
      headers: { Origin: 'http://localhost:7777' },
    });
  });

  test('[Settings Update] Change setting at runtime reflects on public site', async ({ page, request }) => {
    await loginOwner(request);

    // Activate Minimal and set accent color
    await request.post('http://localhost:7777/api/admin/v1/themes/vibress-minimal/activate', {
      headers: { Origin: 'http://localhost:7777' },
    });
    const settingsRes = await request.patch('http://localhost:7777/api/admin/v1/themes/vibress-minimal/settings', {
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:7777' },
      data: { accentColor: '#123456' },
    });
    expect(settingsRes.status()).toBe(200);

    // Public site reflects the setting in CSS variable
    const res = await page.goto(`http://localhost:7777/posts/${postSlug}`);
    expect(res?.status()).toBe(200);
    const html = await page.content();
    expect(html).toContain('#123456');

    // Restore Default
    await request.post('http://localhost:7777/api/admin/v1/themes/vibress-default/activate', {
      headers: { Origin: 'http://localhost:7777' },
    });
  });

  test('[Invalid Activation Atomicity] Failed activation keeps current theme', async ({ request }) => {
    await loginOwner(request);

    // Current theme is Default
    await request.post('http://localhost:7777/api/admin/v1/themes/vibress-default/activate', {
      headers: { Origin: 'http://localhost:7777' },
    });

    // Attempt invalid activation
    const badRes = await request.post('http://localhost:7777/api/admin/v1/themes/node%3Afs/activate', {
      headers: { Origin: 'http://localhost:7777' },
    });
    expect(badRes.status()).toBe(404);

    // Active theme unchanged
    const activeRes = await request.get('http://localhost:7777/api/admin/v1/themes/active', {
      headers: { Origin: 'http://localhost:7777' },
    });
    const activeData = await activeRes.json();
    expect(activeData.themeId).toBe('vibress-default');
  });

  test('[Visibility] Drafts stay hidden after theme switch', async ({ page, request }) => {
    await loginOwner(request);

    const meRes = await request.get('http://localhost:7777/api/admin/v1/auth/me', {
      headers: { Origin: 'http://localhost:7777' },
    });
    const ownerId = (await meRes.json()).user.id;

    const draftRes = await request.post('http://localhost:7777/api/admin/v1/posts', {
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:7777' },
      data: {
        title: 'B7 Hidden Draft',
        slug: `b7-hidden-draft-${Date.now()}`,
        content: { schema: 'vibress-studio', version: 1, root: { type: 'root', children: [] } },
        primaryAuthorId: ownerId,
      },
    });
    const draftSlug = (await draftRes.json()).post.slug;

    // Activate Minimal
    await request.post('http://localhost:7777/api/admin/v1/themes/vibress-minimal/activate', {
      headers: { Origin: 'http://localhost:7777' },
    });

    const res = await page.goto(`http://localhost:7777/posts/${draftSlug}`);
    expect(res?.status()).toBe(404);

    // Restore Default
    await request.post('http://localhost:7777/api/admin/v1/themes/vibress-default/activate', {
      headers: { Origin: 'http://localhost:7777' },
    });
  });
});
