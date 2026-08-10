import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  postList: vi.fn(),
  pageList: vi.fn(),
  tagListAll: vi.fn(),
}));

vi.mock('@vibress/posts', () => ({
  DrizzlePostRepository: class {
    list = mocks.postList;
  },
}));
vi.mock('@vibress/pages', () => ({
  DrizzlePageRepository: class {
    list = mocks.pageList;
  },
}));
vi.mock('@vibress/tags', () => ({
  DrizzleTagRepository: class {
    listAll = mocks.tagListAll;
  },
}));
vi.mock('@vibress/studio-renderer', () => ({
  renderStudioDocumentToPlainText: (c: any) => c?.text ?? '',
}));

import { WorkerSearchContentSource } from '../src/processors/search-content-source';

const post = (id: number) => ({
  id: `p${id}`, title: `Post ${id}`, slug: `post-${id}`,
  content: { text: 'body' }, visibility: 'public',
});

const page = (id: number) => ({
  id: `pg${id}`, title: `Page ${id}`, slug: `page-${id}`,
  content: { text: 'body' }, visibility: 'public',
});

describe('WorkerSearchContentSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tagListAll.mockResolvedValue([]);
  });

  it('paginates through more than 100 published posts', async () => {
    const posts = Array.from({ length: 250 }, (_, i) => post(i + 1));
    mocks.postList.mockImplementation(async (filter: any) => ({
      posts: posts.slice(filter.offset || 0, (filter.offset || 0) + filter.limit),
      total: posts.length,
    }));
    mocks.pageList.mockResolvedValue({ pages: [], total: 0 });

    const source = new WorkerSearchContentSource();
    const docs = await source.listIndexableContent();
    const postDocs = docs.filter((d: any) => d.entityType === 'post');
    expect(postDocs).toHaveLength(250);
    expect(mocks.postList).toHaveBeenCalledTimes(3);
  });

  it('filters out non-public posts and pages', async () => {
    mocks.postList.mockResolvedValue({
      posts: [{ ...post(1), visibility: 'public' }, { ...post(2), visibility: 'members' }],
      total: 2,
    });
    mocks.pageList.mockResolvedValue({
      pages: [{ ...page(1), visibility: 'public' }, { ...page(2), visibility: 'private' }],
      total: 2,
    });

    const source = new WorkerSearchContentSource();
    const docs = await source.listIndexableContent();
    const types = docs.map((d: any) => `${d.entityType}:${d.slug}`);
    expect(types).toEqual(['post:post-1', 'page:page-1']);
  });
});
