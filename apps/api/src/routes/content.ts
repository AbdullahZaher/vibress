import { FastifyInstance } from 'fastify';
import {
  PublicListFilterSchema,
} from '@vibress/api-contracts';
import {
  postsService,
  pagesService,
  tagsService,
  authorsService,
  mediaService,
  themeService,
  settingsService,
} from '../services';
import {
  buildPublicPostSummaryDto,
  buildPublicPostDetailDto,
  buildPublicPageDetailDto,
  formatPublicTag,
  formatPublicAuthor,
} from '../helpers/public-content-helpers';
import type { Author } from '@vibress/authors';
import { getConfig } from '@vibress/config';

/**
 * Wizard-managed site identity, precedence: DB setting → environment →
 * built-in default. SITE_URL stays infrastructure-driven (canonical URLs,
 * RSS, sitemap, cookies, CORS all depend on it) and is never overridden by
 * the database.
 */
async function buildPublicSiteIdentity(): Promise<{
  title: string;
  description: string;
  url: string;
  locale: string;
  tagline: string;
}> {
  const config = getConfig();
  const stored = await settingsService.getPublicSettings();
  const site = (stored.site ?? {}) as Record<string, unknown>;

  const str = (v: unknown, fallback: string): string =>
    typeof v === 'string' && v.trim() !== '' ? v : fallback;

  return {
    title: str(site.title, config.site.name),
    description: str(site.description, config.site.description),
    tagline: str(site.tagline, ''),
    url: config.site.url,
    locale: str(site.locale, config.site.locale),
  };
}
export async function publicContentRoutes(fastify: FastifyInstance) {
  // Public Site Metadata + Active Theme
  fastify.get('/site', {
    handler: async (req, reply) => {
      const site = await buildPublicSiteIdentity();
      const active = await themeService.getActiveTheme();

      return reply.status(200).send({
        site: {
          title: site.title,
          description: site.description,
          url: site.url,
          locale: site.locale,
          tagline: site.tagline,
        },
        theme: {
          themeId: active?.manifest.id || 'vibress-default',
          settings: active?.settings || {},
        },
      });
    },
  });

  // Public Posts List
  fastify.get('/posts', {
    handler: async (req, reply) => {
      const parseResult = PublicListFilterSchema.safeParse(req.query);
      const filter = parseResult.success ? parseResult.data : { page: 1, limit: 20 };

      const limit = filter.limit;
      const page = filter.page;
      const offset = (page - 1) * limit;

      const { posts, total } = await postsService.listPosts({
        publishedOnly: true,
        visibility: 'public',
        tagSlug: filter.tag,
        authorSlug: filter.author,
        limit,
        offset,
        sortBy: 'publishedAt',
        sortOrder: 'desc',
      });

      const summaries = await Promise.all(
        posts.map(async (post) => {
          const authorIds = await postsService.getPostTagIds(post.id); // get tag ids
          const tagIds = authorIds;
          const [authors, tagsList] = await Promise.all([
            authorsService.getPostAuthors(post.id),
            Promise.all(tagIds.map((tId) => tagsService.findById(tId))),
          ]);
          const validTags = tagsList.filter((t): t is NonNullable<typeof t> => !!t);

          return buildPublicPostSummaryDto(post, authors, validTags, mediaService);
        })
      );

      const totalPages = Math.ceil(total / limit) || 1;

      return reply.status(200).send({
        posts: summaries,
        pagination: {
          page,
          limit,
          total,
          pages: totalPages,
        },
      });
    },
  });

  // Public Single Post by Slug
  fastify.get('/posts/:slug', {
    handler: async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const post = await postsService.findPublishedBySlug(slug);

      if (!post) {
        return reply.status(404).send({
          errors: [
            {
              code: 'CONTENT_NOT_FOUND',
              message: 'Post not found',
              requestId: req.id,
            },
          ],
        });
      }

      const tagIds = await postsService.getPostTagIds(post.id);
      const [authors, tagsList] = await Promise.all([
        authorsService.getPostAuthors(post.id),
        Promise.all(tagIds.map((tId) => tagsService.findById(tId))),
      ]);
      const validTags = tagsList.filter((t): t is NonNullable<typeof t> => !!t);

      const postDetail = await buildPublicPostDetailDto(post, authors, validTags, mediaService);
      return reply.status(200).send({ post: postDetail });
    },
  });

  // Public Pages List
  fastify.get('/pages', {
    handler: async (req, reply) => {
      const parseResult = PublicListFilterSchema.safeParse(req.query);
      const filter = parseResult.success ? parseResult.data : { page: 1, limit: 20 };

      const limit = filter.limit;
      const page = filter.page;
      const offset = (page - 1) * limit;

      const { pages, total } = await pagesService.listPages({
        publishedOnly: true,
        visibility: 'public',
        limit,
        offset,
      });

      const details = await Promise.all(
        pages.map(async (pageObj) => {
          return buildPublicPageDetailDto(pageObj, mediaService);
        })
      );

      const totalPages = Math.ceil(total / limit) || 1;

      return reply.status(200).send({
        pages: details,
        pagination: {
          page,
          limit,
          total,
          pages: totalPages,
        },
      });
    },
  });

  // Public Single Page by Slug
  fastify.get('/pages/:slug', {
    handler: async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const pageObj = await pagesService.findPublishedBySlug(slug);

      if (!pageObj) {
        return reply.status(404).send({
          errors: [
            {
              code: 'CONTENT_NOT_FOUND',
              message: 'Page not found',
              requestId: req.id,
            },
          ],
        });
      }

      const pageDetail = await buildPublicPageDetailDto(pageObj, mediaService);
      return reply.status(200).send({ page: pageDetail });
    },
  });

  // Public Tags List
  fastify.get('/tags', {
    handler: async (req, reply) => {
      const tagsList = await tagsService.listAll();
      const formatted = tagsList.map(formatPublicTag);
      return reply.status(200).send({ tags: formatted });
    },
  });

  // Public Tag Detail
  fastify.get('/tags/:slug', {
    handler: async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const tag = await tagsService.findBySlug(slug);

      if (!tag) {
        return reply.status(404).send({
          errors: [
            {
              code: 'TAG_NOT_FOUND',
              message: 'Tag not found',
              requestId: req.id,
            },
          ],
        });
      }

      return reply.status(200).send({ tag: formatPublicTag(tag) });
    },
  });

  // Public Tag Posts Archive
  fastify.get('/tags/:slug/posts', {
    handler: async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const tag = await tagsService.findBySlug(slug);

      if (!tag) {
        return reply.status(404).send({
          errors: [
            {
              code: 'TAG_NOT_FOUND',
              message: 'Tag not found',
              requestId: req.id,
            },
          ],
        });
      }

      const parseResult = PublicListFilterSchema.safeParse(req.query);
      const filter = parseResult.success ? parseResult.data : { page: 1, limit: 20 };

      const limit = filter.limit;
      const page = filter.page;
      const offset = (page - 1) * limit;

      const { posts, total } = await postsService.listPosts({
        publishedOnly: true,
        visibility: 'public',
        tagSlug: slug,
        limit,
        offset,
        sortBy: 'publishedAt',
        sortOrder: 'desc',
      });

      const summaries = await Promise.all(
        posts.map(async (post) => {
          const tagIds = await postsService.getPostTagIds(post.id);
          const [authors, tagsList] = await Promise.all([
            authorsService.getPostAuthors(post.id),
            Promise.all(tagIds.map((tId) => tagsService.findById(tId))),
          ]);
          const validTags = tagsList.filter((t): t is NonNullable<typeof t> => !!t);

          return buildPublicPostSummaryDto(post, authors, validTags, mediaService);
        })
      );

      const totalPages = Math.ceil(total / limit) || 1;

      return reply.status(200).send({
        tag: formatPublicTag(tag),
        posts: summaries,
        pagination: {
          page,
          limit,
          total,
          pages: totalPages,
        },
      });
    },
  });

  // Public Authors List
  fastify.get('/authors', {
    handler: async (_req, reply) => {
      const authorRepo = (authorsService as unknown as { authorRepo: { listAuthors: () => Promise<Array<{ id: string; name: string; slug: string; bio: string | null }>>; findAuthorBySlug: (slug: string) => Promise<{ id: string; name: string; slug: string; bio: string | null } | null> } }).authorRepo;
      const authorList = await authorRepo.listAuthors();
      const formatted = authorList.map((a) => formatPublicAuthor(a as Author));
      return reply.status(200).send({ authors: formatted });
    },
  });

  // Public Author Detail
  fastify.get('/authors/:slug', {
    handler: async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const authorRepo = (authorsService as unknown as { authorRepo: { listAuthors: () => Promise<Array<{ id: string; name: string; slug: string; bio: string | null }>>; findAuthorBySlug: (slug: string) => Promise<{ id: string; name: string; slug: string; bio: string | null } | null> } }).authorRepo;
      const author = await authorRepo.findAuthorBySlug(slug);

      if (!author) {
        return reply.status(404).send({
          errors: [
            {
              code: 'AUTHOR_NOT_FOUND',
              message: 'Author not found',
              requestId: req.id,
            },
          ],
        });
      }

      return reply.status(200).send({ author: formatPublicAuthor(author as Author) });
    },
  });

  // Public Author Posts Archive
  fastify.get('/authors/:slug/posts', {
    handler: async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const authorRepo = (authorsService as unknown as { authorRepo: { listAuthors: () => Promise<Array<{ id: string; name: string; slug: string; bio: string | null }>>; findAuthorBySlug: (slug: string) => Promise<{ id: string; name: string; slug: string; bio: string | null } | null> } }).authorRepo;
      const author = await authorRepo.findAuthorBySlug(slug);

      if (!author) {
        return reply.status(404).send({
          errors: [
            {
              code: 'AUTHOR_NOT_FOUND',
              message: 'Author not found',
              requestId: req.id,
            },
          ],
        });
      }

      const parseResult = PublicListFilterSchema.safeParse(req.query);
      const filter = parseResult.success ? parseResult.data : { page: 1, limit: 20 };

      const limit = filter.limit;
      const page = filter.page;
      const offset = (page - 1) * limit;

      const { posts, total } = await postsService.listPosts({
        publishedOnly: true,
        visibility: 'public',
        authorSlug: slug,
        limit,
        offset,
        sortBy: 'publishedAt',
        sortOrder: 'desc',
      });

      const summaries = await Promise.all(
        posts.map(async (post) => {
          const tagIds = await postsService.getPostTagIds(post.id);
          const [authors, tagsList] = await Promise.all([
            authorsService.getPostAuthors(post.id),
            Promise.all(tagIds.map((tId) => tagsService.findById(tId))),
          ]);
          const validTags = tagsList.filter((t): t is NonNullable<typeof t> => !!t);

          return buildPublicPostSummaryDto(post, authors, validTags, mediaService);
        })
      );

      const totalPages = Math.ceil(total / limit) || 1;

      return reply.status(200).send({
        author: formatPublicAuthor(author as Author),
        posts: summaries,
        pagination: {
          page,
          limit,
          total,
          pages: totalPages,
        },
      });
    },
  });
}
