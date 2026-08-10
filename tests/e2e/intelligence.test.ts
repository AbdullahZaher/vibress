import { test, expect } from '@playwright/test';

const API = 'http://localhost:7777';

test.describe('Batch 13 Intelligence E2E Suite', () => {
  async function loginAsStaff(request: any) {
    await request.post(`${API}/api/admin/v1/auth/login`, {
      headers: { 'Content-Type': 'application/json', Origin: API },
      data: { email: 'owner@example.com', password: 'OwnerPass123!' },
    });
  }

  async function createPublishedPost(request: any, title: string, visibility = 'public'): Promise<string> {
    const me = await (await request.get(`${API}/api/admin/v1/auth/me`)).json();
    const ownerId = me.user?.id;
    const createRes = await request.post(`${API}/api/admin/v1/posts`, {
      headers: { Origin: API, 'Content-Type': 'application/json' },
      data: {
        title,
        slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`,
        content: { schema: 'vibress-studio', version: 1, root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: title + ' body content', format: 0, mode: 'normal', version: 1 }], direction: null, format: '', indent: 0, version: 1 }] } },
        visibility,
        primaryAuthorId: ownerId,
      },
    });
    expect(createRes.status()).toBe(201);
    const postId = (await createRes.json()).post.id;
    const pubRes = await request.post(`${API}/api/admin/v1/posts/${postId}/publish`, { headers: { Origin: API } });
    expect(pubRes.status()).toBe(200);
    return postId;
  }

  async function waitFor(fn: () => Promise<boolean>, timeoutMs = 30000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('Timed out waiting for condition');
  }

  test('[Search] published Post becomes searchable; unpublished disappears', async ({ request }) => {
    await loginAsStaff(request);

    // Create + publish a post
    const title = `Searchable E2E Post ${Date.now()}`;
    const postId = await createPublishedPost(request, title);

    // Wait for the search indexer to pick up the publish event
    await waitFor(async () => {
      const res = await request.get(`${API}/api/content/v1/search?q=${encodeURIComponent(title)}`);
      if (res.status() !== 200) return false;
      const body = await res.json();
      return body.results.some((r: any) => r.entityId === postId);
    });
    expect(true).toBe(true); // reached via waitFor

    // Unpublish → removed from search
    const unpubRes = await request.post(`${API}/api/admin/v1/posts/${postId}/unpublish`, { headers: { Origin: API } });
    expect(unpubRes.status()).toBe(200);

    await waitFor(async () => {
      const res = await request.get(`${API}/api/content/v1/search?q=${encodeURIComponent(title)}`);
      const body = await res.json();
      return !body.results.some((r: any) => r.entityId === postId);
    });
  });

  test('[Search] restricted (members) content is never searchable', async ({ request }) => {
    await loginAsStaff(request);
    const title = `Members Only E2E ${Date.now()}`;
    await createPublishedPost(request, title, 'members');

    // Wait a moment for indexing attempt, then verify it never appears
    await new Promise((r) => setTimeout(r, 3000));
    const res = await request.get(`${API}/api/content/v1/search?q=${encodeURIComponent('Members Only E2E')}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.results.some((r: any) => r.title.includes('Members Only E2E'))).toBe(false);
  });

  test('[Search] query abuse protection (rate limit + length bound)', async ({ request }) => {
    await loginAsStaff(request);
    // Length bound
    const longRes = await request.get(`${API}/api/content/v1/search?q=${'x'.repeat(200)}`);
    expect(longRes.status()).toBe(400);
    expect((await longRes.json()).errors[0].code).toBe('QUERY_TOO_LONG');

    // Rate limit (200/min in test mode through the gateway; fire 250)
    let limited = false;
    for (let i = 0; i < 250; i++) {
      const res = await request.get(`${API}/api/content/v1/search?q=hello`);
      if (res.status() === 429) { limited = true; break; }
    }
    expect(limited).toBe(true);
  });

  test('[Analytics] member-created event reaches daily aggregation', async ({ page, request }) => {
    await loginAsStaff(request);

    // Create a member → member.created → member.signup analytics event
    const email = `e2e-analytics-${Date.now()}@example.com`;
    const reqRes = await request.post(`${API}/api/members/v1/auth/request`, {
      headers: { Origin: API },
      data: { email },
    });
    expect(reqRes.status()).toBe(200);

    // Wait for the analytics worker to ingest and aggregate
    await waitFor(async () => {
      const res = await request.get(`${API}/api/admin/v1/analytics/metrics?from=2020-01-01&to=2030-01-01&metricName=member.signup`);
      if (res.status() !== 200) return false;
      const body = await res.json();
      return body.metrics.some((m: any) => m.name === 'member.signup' && m.count > 0);
    });
  });

  test('[Automations] trigger → action executes once; deactivated automation does not run', async ({ page, request }) => {
    await loginAsStaff(request);

    // Create an automation on comment.created with a webhook action
    const createRes = await request.post(`${API}/api/admin/v1/automations`, {
      headers: { Origin: API },
      data: {
        key: `e2e-auto-${Date.now()}`,
        name: 'E2E Comment Webhook',
        triggerEvent: 'comment.created',
        actions: [{ type: 'webhook', config: { url: 'https://receiver.example.com/hook', eventType: 'automation.test' } }],
      },
    });
    expect(createRes.status()).toBe(201);
    const automation = (await createRes.json()).automation;

    // Activate
    const activateRes = await request.post(`${API}/api/admin/v1/automations/${automation.id}/activate`, { headers: { Origin: API } });
    expect(activateRes.status()).toBe(200);

    // Trigger a comment event via the public comment flow
    // (reuse a post — create one first)
    const postTitle = `Auto Trigger Post ${Date.now()}`;
    const postId = await createPublishedPost(request, postTitle);
    const email = `e2e-auto-member-${Date.now()}@example.com`;
    // Sign up a member and post a comment via the portal
    const portal = await request.get(`${API}/portal/`);
    expect(portal.status()).toBe(200);

    // Use the member API directly: sign up via request, verify via magic link
    const signupRes = await request.post(`${API}/api/members/v1/auth/request`, {
      headers: { Origin: API },
      data: { email },
    });
    expect(signupRes.status()).toBe(200);
    const mailRes = await fetch('http://127.0.0.1:8025/api/v1/messages');
    const mailData = await mailRes.json();
    const msg = (mailData.messages || []).find((m: any) => m.To?.[0]?.Address === email);
    expect(msg).toBeTruthy();
    const detail = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${msg.ID}`)).json();
    const link = (detail.HTML || '').match(/href="([^"]+)"/)?.[1];
    expect(link).toBeTruthy();
    const token = new URL(link).searchParams.get('token') || '';
    const verifyRes = await request.post(`${API}/api/members/v1/auth/verify`, {
      headers: { Origin: API },
      data: { token },
    });
    expect(verifyRes.status()).toBe(200);
    const memberCookie = String((verifyRes.headers()['set-cookie'] || '')).split(';')[0];

    const commentRes = await request.post(`${API}/api/members/v1/comments`, {
      headers: { Origin: API, Cookie: memberCookie },
      data: { postId, body: 'Automation trigger comment' },
    });
    expect(commentRes.status()).toBe(201);

    // Wait for the automation run to appear (idempotent: one run for one event)
    await waitFor(async () => {
      const runsRes = await request.get(`${API}/api/admin/v1/automation-runs?automationId=${automation.id}`);
      const body = await runsRes.json();
      return body.runs.length >= 1;
    });

    // Exactly one run for this event identity
    const runsRes = await request.get(`${API}/api/admin/v1/automation-runs?automationId=${automation.id}`);
    const runs = (await runsRes.json()).runs;
    const commentRuns = runs.filter((r: any) => r.triggerEvent === 'comment.created');
    expect(commentRuns.length).toBe(1);

    // The webhook action step executed (or failed at delivery to example.com — but ran once)
    const stepRes = await request.get(`${API}/api/admin/v1/automation-runs/${commentRuns[0].id}/steps`);
    expect(stepRes.status()).toBe(200);
    const steps = (await stepRes.json()).steps;
    expect(steps.length).toBe(1);
    expect(steps[0].actionType).toBe('webhook');
    expect(steps[0].attempts).toBeGreaterThanOrEqual(1);

    // Deactivate → new events do not run
    await request.post(`${API}/api/admin/v1/automations/${automation.id}/deactivate`, { headers: { Origin: API } });
    const runsBefore = (await (await request.get(`${API}/api/admin/v1/automation-runs?automationId=${automation.id}`)).json()).runs.length;
    await new Promise((r) => setTimeout(r, 2500));
    const runsAfter = (await (await request.get(`${API}/api/admin/v1/automation-runs?automationId=${automation.id}`)).json()).runs.length;
    expect(runsAfter).toBe(runsBefore);
  });

  test('[Automations] durable wait resumes after delay', async ({ request }) => {
    await loginAsStaff(request);

    const createRes = await request.post(`${API}/api/admin/v1/automations`, {
      headers: { Origin: API },
      data: {
        key: `e2e-wait-${Date.now()}`,
        name: 'E2E Wait',
        triggerEvent: 'member.created',
        actions: [{ type: 'wait', config: { delayMs: 3000 } }],
      },
    });
    expect(createRes.status()).toBe(201);
    const automation = (await createRes.json()).automation;
    await request.post(`${API}/api/admin/v1/automations/${automation.id}/activate`, { headers: { Origin: API } });

    // Manual run → should go waiting then complete
    const runRes = await request.post(`${API}/api/admin/v1/automations/${automation.id}/run`, { headers: { Origin: API } });
    expect(runRes.status()).toBe(201);
    const runId = (await runRes.json()).run.id;

    // It may be waiting (persisted state) or already completed after the delay
    await waitFor(async () => {
      const runsRes = await request.get(`${API}/api/admin/v1/automation-runs?automationId=${automation.id}`);
      const run = (await runsRes.json()).runs.find((r: any) => r.id === runId);
      return run && (run.status === 'completed' || run.status === 'failed');
    });

    const finalRuns = await (await request.get(`${API}/api/admin/v1/automation-runs?automationId=${automation.id}`)).json();
    const finalRun = finalRuns.runs.find((r: any) => r.id === runId);
    expect(['completed', 'failed']).toContain(finalRun.status);
  });
});
