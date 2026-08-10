import { describe, it, expect, vi } from 'vitest';
import { RedirectsService, RedirectDomainError, PROTECTED_ROUTE_PREFIXES } from '../src/application/redirects-service';
import { RedirectRepository, Redirect, CreateRedirectData } from '../src/domain/redirect';

function makeRedirect(overrides: Partial<Redirect> = {}): Redirect {
  return {
    id: 'r1',
    source: '/old-path',
    destination: '/new-path',
    statusCode: 301,
    enabled: true,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('RedirectsService', () => {
  const repo: RedirectRepository = {
    create: vi.fn(async (d) => makeRedirect({ source: d.source, destination: d.destination })),
    findById: vi.fn(async () => null),
    findBySource: vi.fn(async () => null),
    update: vi.fn(async (id, d) => makeRedirect({ id, ...d })),
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    listEnabled: vi.fn(async () => []),
  };

  function makeService(overrides: Record<string, unknown> = {}) {
    return new RedirectsService((overrides.repo as RedirectRepository) || repo);
  }

  it('creates a valid internal redirect', async () => {
    const service = makeService();
    const redirect = await service.createRedirect({ source: '/old', destination: '/new' }, 'u1');
    expect(redirect.source).toBe('/old');
  });

  it('rejects a non-relative source', async () => {
    const service = makeService();
    await expect(service.createRedirect({ source: 'old', destination: '/new' }, null))
      .rejects.toMatchObject({ code: 'INVALID_SOURCE' });
    await expect(service.createRedirect({ source: '//evil.com', destination: '/new' }, null))
      .rejects.toMatchObject({ code: 'INVALID_SOURCE' });
  });

  it('rejects redirecting protected routes', async () => {
    const service = makeService();
    for (const prefix of PROTECTED_ROUTE_PREFIXES) {
      await expect(service.createRedirect({ source: `${prefix}/x`, destination: '/new' }, null))
        .rejects.toMatchObject({ code: 'PROTECTED_ROUTE' });
    }
  });

  it('rejects unsafe external destinations', async () => {
    const service = makeService();
    await expect(service.createRedirect({ source: '/a', destination: 'javascript:alert(1)' }, null))
      .rejects.toMatchObject({ code: 'INVALID_DESTINATION' });
    await expect(service.createRedirect({ source: '/a', destination: 'data:text/html,x' }, null))
      .rejects.toMatchObject({ code: 'INVALID_DESTINATION' });
    await expect(service.createRedirect({ source: '/a', destination: 'ftp://x.com' }, null))
      .rejects.toMatchObject({ code: 'INVALID_DESTINATION' });
  });

  it('allows http/https external destinations', async () => {
    const service = makeService();
    const redirect = await service.createRedirect({ source: '/out', destination: 'https://example.com/page' }, null);
    expect(redirect.destination).toBe('https://example.com/page');
  });

  it('rejects an unsupported status code', async () => {
    const service = makeService();
    await expect(service.createRedirect({ source: '/a', destination: '/b', statusCode: 200 }, null))
      .rejects.toMatchObject({ code: 'INVALID_STATUS_CODE' });
  });

  it('rejects a duplicate source', async () => {
    const repoWith: RedirectRepository = { ...repo, findBySource: vi.fn(async () => makeRedirect()) };
    const service = makeService({ repo: repoWith });
    await expect(service.createRedirect({ source: '/old-path', destination: '/new' }, null))
      .rejects.toMatchObject({ code: 'SOURCE_EXISTS' });
  });

  it('resolves a redirect chain with loop protection', async () => {
    const redirects = [
      makeRedirect({ id: 'a', source: '/a', destination: '/b', statusCode: 301 }),
      makeRedirect({ id: 'b', source: '/b', destination: '/c', statusCode: 302 }),
    ];
    const repoWith: RedirectRepository = { ...repo, listEnabled: vi.fn(async () => redirects) };
    const service = makeService({ repo: repoWith });
    const resolved = await service.resolve('/a');
    expect(resolved).toEqual({ destination: '/c', statusCode: 302 });
  });

  it('detects and breaks a redirect loop', async () => {
    const redirects = [
      makeRedirect({ id: 'a', source: '/a', destination: '/b' }),
      makeRedirect({ id: 'b', source: '/b', destination: '/a' }),
    ];
    const repoWith: RedirectRepository = { ...repo, listEnabled: vi.fn(async () => redirects) };
    const service = makeService({ repo: repoWith });
    const resolved = await service.resolve('/a');
    expect(resolved).toBeNull(); // loop broken
  });
});
