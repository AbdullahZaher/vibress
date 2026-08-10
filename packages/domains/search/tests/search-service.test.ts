import { describe, it, expect, vi } from 'vitest';
import { SearchService, SearchDomainError, sanitizeSearchQuery } from '../src/application/search-service';
import { SearchRepository, SearchDocumentInput, SearchResult } from '../src/domain/search';

describe('sanitizeSearchQuery', () => {
  it('trims and collapses whitespace', () => {
    expect(sanitizeSearchQuery('  hello   world ')).toBe('hello world');
  });

  it('rejects queries over the length bound', () => {
    expect(() => sanitizeSearchQuery('a'.repeat(200))).toThrowError(expect.objectContaining({ code: 'QUERY_TOO_LONG' }));
  });

  it('rejects empty queries', () => {
    expect(() => sanitizeSearchQuery('   ')).toThrowError(expect.objectContaining({ code: 'EMPTY_QUERY' }));
  });

  it('rejects pathological wildcard-only queries', () => {
    expect(() => sanitizeSearchQuery('***%%%')).toThrowError(expect.objectContaining({ code: 'INVALID_QUERY' }));
  });
});

describe('SearchService', () => {
  const repo: SearchRepository = {
    upsert: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    setSearchable: vi.fn(async () => undefined),
    query: vi.fn(async () => ({ results: [], total: 0 })),
    count: vi.fn(async () => 0),
    clear: vi.fn(async () => undefined),
  };

  it('search passes the sanitized query to the repository', async () => {
    const service = new SearchService(repo);
    await service.search('  hello world  ', 10, 0);
    expect(repo.query).toHaveBeenCalledWith('hello world', 10, 0);
  });

  it('indexDocument ignores empty titles', async () => {
    const service = new SearchService(repo);
    await service.indexDocument({ entityType: 'post', entityId: 'p1', title: '   ' });
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('rebuild clears the index and re-indexes all content', async () => {
    const docs: SearchDocumentInput[] = [
      { entityType: 'post', entityId: 'p1', title: 'Post One' },
      { entityType: 'page', entityId: 'pg1', title: 'Page One' },
      { entityType: 'tag', entityId: 't1', title: 'Tag One' },
    ];
    const service = new SearchService(repo);
    const count = await service.rebuild({ listIndexableContent: async () => docs });
    expect(count).toBe(3);
    expect(repo.clear).toHaveBeenCalled();
    expect(repo.upsert).toHaveBeenCalledTimes(3);
  });
});
