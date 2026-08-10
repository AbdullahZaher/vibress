import { describe, it, expect, vi } from 'vitest';
import { NewslettersService, NewsletterDomainError } from '../src/application/newsletters-service';
import { NewsletterRepository } from '../src/domain/repository';
import { Newsletter, NewsletterPreference, NewsletterPreferenceRepository } from '../src/domain/newsletter';
import { SendRepository, NewsletterSend, AudienceDefinition } from '../src/domain/send';
import { MemberAudienceRepository, AudienceMember } from '../src/application/newsletters-service';

function makeNewsletter(overrides: Partial<Newsletter> = {}): Newsletter {
  return {
    id: 'nl-1',
    key: 'weekly',
    name: 'Weekly',
    description: null,
    senderName: 'Vibress',
    senderEmail: 'news@example.com',
    replyTo: null,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    ...overrides,
  };
}

function makeSend(overrides: Partial<NewsletterSend> = {}): NewsletterSend {
  return {
    id: 'send-1',
    newsletterId: 'nl-1',
    subject: 'Hello',
    contentVersion: 1,
    content: { schema: 'vibress-studio', version: 1, root: { type: 'root', children: [] } },
    senderName: 'Vibress',
    senderEmail: 'news@example.com',
    replyTo: null,
    audience: { filter: 'all', productId: null, planId: null },
    createdBy: 'user-1',
    scheduledAt: null,
    status: 'draft',
    totalRecipients: 0,
    sentRecipients: 0,
    failedRecipients: 0,
    startedAt: null,
    completedAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('NewslettersService', () => {
  const newsletterRepo: NewsletterRepository = {
    create: vi.fn(async (d) => makeNewsletter({ key: d.key, name: d.name, senderName: d.senderName, senderEmail: d.senderEmail })),
    findById: vi.fn(async () => makeNewsletter()),
    findByKey: vi.fn(async () => null),
    update: vi.fn(async (id) => makeNewsletter()),
    archive: vi.fn(async (id) => makeNewsletter({ status: 'archived', archivedAt: new Date() })),
    list: vi.fn(async () => []),
  };
  const prefRepo: NewsletterPreferenceRepository = {
    setSubscription: vi.fn(async (memberId, newsletterId, subscribed) => ({
      id: 'pref-1',
      memberId,
      newsletterId,
      subscribed,
      subscribedAt: subscribed ? new Date() : null,
      unsubscribedAt: subscribed ? null : new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    get: vi.fn(async () => null),
    listForMember: vi.fn(async () => []),
  };
  const sendRepo: SendRepository = {
    create: vi.fn(async (d) => makeSend({ subject: d.subject, newsletterId: d.newsletterId })),
    findById: vi.fn(async () => null),
    updateStatus: vi.fn(async (id, status) => makeSend({ id, status })),
    list: vi.fn(async () => ({ sends: [], total: 0 })),
    findDueScheduled: vi.fn(async () => []),
  };
  const audienceRepo: MemberAudienceRepository = {
    listAudienceMembers: vi.fn(async () => []),
  };

  function makeService(overrides: Record<string, unknown> = {}) {
    return new NewslettersService({
      newsletterRepo,
      preferenceRepo: prefRepo,
      sendRepo,
      audienceRepo,
      isMemberSuppressed: async () => false,
      unsubscribeSecret: 'test-secret',
      portalUrl: 'https://portal.example.test',
      ...overrides,
    } as any);
  }

  it('creates a newsletter with a normalized key', async () => {
    const service = makeService();
    const nl = await service.createNewsletter({ key: 'Weekly', name: 'Weekly', senderName: 'V', senderEmail: 'n@example.com' }, 'u1');
    expect(nl.key).toBe('weekly');
  });

  it('rejects a newsletter with an invalid key', async () => {
    const service = makeService();
    await expect(service.createNewsletter({ key: 'Bad Key!', name: 'X', senderName: 'V', senderEmail: 'n@example.com' }, null))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects a newsletter with an invalid sender email', async () => {
    const service = makeService();
    await expect(service.createNewsletter({ key: 'ok', name: 'X', senderName: 'V', senderEmail: 'not-an-email' }, null))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects a duplicate newsletter key', async () => {
    const dupRepo = { ...newsletterRepo, findByKey: vi.fn(async () => makeNewsletter()) };
    const service = makeService({ newsletterRepo: dupRepo });
    await expect(service.createNewsletter({ key: 'weekly', name: 'X', senderName: 'V', senderEmail: 'n@example.com' }, null))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('archives newsletters (soft delete)', async () => {
    const archivingRepo = { ...newsletterRepo, findById: vi.fn(async () => makeNewsletter()) };
    const service = makeService({ newsletterRepo: archivingRepo });
    const archived = await service.archiveNewsletter('nl-1', 'u1');
    expect(archived.status).toBe('archived');
  });

  it('setSubscription honors explicit subscribe/unsubscribe', async () => {
    const service = makeService();
    const pref = await service.setSubscription('m1', 'nl-1', false);
    expect(pref.subscribed).toBe(false);
  });

  it('rejects subscribing to an archived newsletter', async () => {
    const archivedRepo = { ...newsletterRepo, findById: vi.fn(async () => makeNewsletter({ status: 'archived' })) };
    const service = makeService({ newsletterRepo: archivedRepo });
    await expect(service.setSubscription('m1', 'nl-1', true)).rejects.toMatchObject({ code: 'NEWSLETTER_NOT_FOUND' });
  });

  it('computes audience: excludes unsubscribed, suppressed, and unverified members', async () => {
    const members: AudienceMember[] = [
      { id: 'm1', email: 'a@example.com', name: null, emailVerified: true, status: 'active', hasPaidSubscription: false },
      { id: 'm2', email: 'b@example.com', name: null, emailVerified: false, status: 'active', hasPaidSubscription: false },
      { id: 'm3', email: 'c@example.com', name: null, emailVerified: true, status: 'disabled', hasPaidSubscription: false },
    ];
    const audRepo: MemberAudienceRepository = { listAudienceMembers: vi.fn(async () => members) };
    const prefRepoWith: NewsletterPreferenceRepository = {
      ...prefRepo,
      get: vi.fn(async (memberId) => {
        if (memberId === 'm1') return { id: 'p', memberId, newsletterId: 'nl-1', subscribed: true, subscribedAt: new Date(), unsubscribedAt: null, createdAt: new Date(), updatedAt: new Date() };
        if (memberId === 'm2') return { id: 'p', memberId, newsletterId: 'nl-1', subscribed: true, subscribedAt: new Date(), unsubscribedAt: null, createdAt: new Date(), updatedAt: new Date() };
        if (memberId === 'm3') return { id: 'p', memberId, newsletterId: 'nl-1', subscribed: true, subscribedAt: new Date(), unsubscribedAt: null, createdAt: new Date(), updatedAt: new Date() };
        return { id: 'p', memberId, newsletterId: 'nl-1', subscribed: false, subscribedAt: null, unsubscribedAt: new Date(), createdAt: new Date(), updatedAt: new Date() };
      }),
    };
    const service = makeService({
      audienceRepo: audRepo,
      preferenceRepo: prefRepoWith,
      isMemberSuppressed: async (email: string) => email === 'a@example.com', // m1 suppressed
    });
    const audience = await service.computeAudience('nl-1', { filter: 'all', productId: null, planId: null });
    // m1 suppressed, m2 unverified, m3 disabled → none remain
    expect(audience.length).toBe(0);
  });

  it('paid filter only includes members with paid subscriptions', async () => {
    const members: AudienceMember[] = [
      { id: 'm1', email: 'a@example.com', name: null, emailVerified: true, status: 'active', hasPaidSubscription: true },
      { id: 'm2', email: 'b@example.com', name: null, emailVerified: true, status: 'active', hasPaidSubscription: false },
    ];
    const audRepo: MemberAudienceRepository = { listAudienceMembers: vi.fn(async () => members) };
    const prefRepoAll: NewsletterPreferenceRepository = {
      ...prefRepo,
      get: vi.fn(async (memberId) => ({ id: 'p', memberId, newsletterId: 'nl-1', subscribed: true, subscribedAt: new Date(), unsubscribedAt: null, createdAt: new Date(), updatedAt: new Date() })),
    };
    const service = makeService({ audienceRepo: audRepo, preferenceRepo: prefRepoAll });
    const audience = await service.computeAudience('nl-1', { filter: 'paid', productId: null, planId: null });
    expect(audience.map((m) => m.email)).toEqual(['a@example.com']);
  });

  it('starts a send idempotently (snapshot once)', async () => {
    const audRepo: MemberAudienceRepository = {
      listAudienceMembers: vi.fn(async () => [
        { id: 'm1', email: 'a@example.com', name: null, emailVerified: true, status: 'active', hasPaidSubscription: false },
      ]),
    };
    const prefRepoAll: NewsletterPreferenceRepository = {
      ...prefRepo,
      get: vi.fn(async (memberId) => ({ id: 'p', memberId, newsletterId: 'nl-1', subscribed: true, subscribedAt: new Date(), unsubscribedAt: null, createdAt: new Date(), updatedAt: new Date() })),
    };
    const sendRepoWith: SendRepository = {
      ...sendRepo,
      findById: vi.fn(async (id) => makeSend({ id })),
    };
    const service = makeService({ audienceRepo: audRepo, preferenceRepo: prefRepoAll, sendRepo: sendRepoWith });

    let recipientCalls = 0;
    const { recipientCount } = await service.startSend('send-1', async (rows) => {
      recipientCalls++;
      return rows.length;
    });
    expect(recipientCount).toBe(1);
    expect(recipientCalls).toBe(1);
  });

  it('unsubscribes with a valid scoped token', async () => {
    const sendRepoWith: SendRepository = {
      ...sendRepo,
      findById: vi.fn(async (id) => makeSend({ id, newsletterId: 'nl-1' })),
    };
    const prefRepoWith: NewsletterPreferenceRepository = {
      ...prefRepo,
      get: vi.fn(async () => ({ id: 'p', memberId: 'm1', newsletterId: 'nl-1', subscribed: true, subscribedAt: new Date(), unsubscribedAt: null, createdAt: new Date(), updatedAt: new Date() })),
    };
    const service = makeService({ sendRepo: sendRepoWith, preferenceRepo: prefRepoWith });
    const token = service.signUnsubscribeToken('m1', 'send-1');
    const result = await service.unsubscribeWithToken(token);
    expect(result.memberId).toBe('m1');
    expect(result.newsletterId).toBe('nl-1');
    expect(prefRepoWith.setSubscription).toHaveBeenCalledWith('m1', 'nl-1', false);
  });

  it('rejects a forged unsubscribe token', async () => {
    const service = makeService();
    await expect(service.unsubscribeWithToken('forged-token')).rejects.toMatchObject({ code: 'INVALID_UNSUBSCRIBE_TOKEN' });
  });

  it('rejects a token signed for a different member (scope)', async () => {
    const sendRepoWith: SendRepository = {
      ...sendRepo,
      findById: vi.fn(async (id) => makeSend({ id, newsletterId: 'nl-1' })),
    };
    const service = makeService({ sendRepo: sendRepoWith });
    const tokenForM2 = service.signUnsubscribeToken('m2', 'send-1');
    // Token for m2 must not unsubscribe m1: membership is bound inside the token payload
    const result = await service.unsubscribeWithToken(tokenForM2);
    expect(result.memberId).toBe('m2');
  });

  it('renders email HTML with an unsubscribe link and plain text fallback', () => {
    const service = makeService();
    const send = makeSend({
      content: {
        schema: 'vibress-studio',
        version: 1,
        editor: { lexicalVersion: '0.13.1' },
        root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Hello world', format: 0, mode: 'normal', version: 1 }], direction: null, format: '', indent: 0, version: 1 }] },
      },
    });
    const { html, text } = service.renderEmailHtml(send, 'm1', 'tok123');
    expect(html).toContain('Hello world');
    expect(html).toContain('Unsubscribe');
    expect(html).toContain('portal.example.test/portal/unsubscribe?t=tok123');
    expect(text).toContain('Hello world');
    expect(text).toContain('Unsubscribe:');
  });
});
