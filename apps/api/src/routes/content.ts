import { FastifyInstance } from "fastify";
import { PublicListFilterSchema } from "@vibress/api-contracts";
import {
  postsService,
  pagesService,
  tagsService,
  authorsService,
  mediaService,
  themeService,
  settingsService,
  workspaceService,
} from "../services";
import {
  buildPublicPostSummaryDto,
  buildPublicPostDetailDto,
  buildPublicPageDetailDto,
  formatPublicTag,
  formatPublicAuthor,
} from "../helpers/public-content-helpers";
import type { Author } from "@vibress/authors";
import { getConfig } from "@vibress/config";
import {
  verifyPassword,
  signSiteAuthToken,
  SITE_AUTH_COOKIE_NAME,
} from "@vibress/security";
import { getDirection, canonicalizeLocale } from "@vibress/i18n";
import { TranslationService } from "@vibress/i18n/server";

const translationService = new TranslationService();

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
  direction: string;
  tagline: string;
  timezone: string;
  accentColor: string;
  iconUrl: string;
  logoUrl: string;
  coverUrl: string;
  primaryNav: Array<{ label: string; url: string }>;
  secondaryNav: Array<{ label: string; url: string }>;
  announcementEnabled: boolean;
  announcementText: string;
  announcementUrl: string;
  security: { isPrivate: boolean };
  analytics: Record<string, unknown>;
  code: Record<string, unknown>;
  comments: Record<string, unknown>;
}> {
  const config = getConfig();
  const stored = await settingsService.getPublicSettings();
  const site = (stored.site ?? {}) as Record<string, unknown>;

  const str = (v: unknown, fallback: string): string =>
    typeof v === "string" && v.trim() !== "" ? v : fallback;
  const resolvedLocale = str(site.locale, config.site.locale);

  return {
    title: str(site.title, config.site.name),
    description: str(site.description, config.site.description),
    tagline: str(site.tagline, ""),
    url: config.site.url,
    locale: resolvedLocale,
    direction: getDirection(resolvedLocale),
    timezone: str(site.timezone, "UTC"),
    accentColor: str(site.accentColor, "#6366f1"),
    iconUrl: str(site.iconUrl, ""),
    logoUrl: str(site.logoUrl, ""),
    coverUrl: str(site.coverUrl, ""),
    primaryNav: Array.isArray(site.primaryNav) ? site.primaryNav : [],
    secondaryNav: Array.isArray(site.secondaryNav) ? site.secondaryNav : [],
    announcementEnabled: Boolean(site.announcementEnabled),
    announcementText: str(site.announcementText, ""),
    announcementUrl: str(site.announcementUrl, ""),
    security: {
      isPrivate: Boolean(stored.security?.isPrivate),
    },
    analytics: (stored.analytics ?? {}) as Record<string, unknown>,
    code: (stored.code ?? {}) as Record<string, unknown>,
    comments: (stored.comments ?? {}) as Record<string, unknown>,
  };
}

export async function publicContentRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", async (req, reply) => {
    const host = req.hostname || (req.headers["host"] as string) || null;
    const isDevFallbackAllowed =
      !getConfig().isProduction && req.headers["x-dev-fallback"] !== "false";
    try {
      const pubCtx = await workspaceService.resolvePublicPublicationContext({
        host,
        isDevFallbackAllowed,
      });
      req.publicationContext = {
        publicationId: pubCtx.publicationId,
        workspaceId: pubCtx.workspaceId,
        actorType: pubCtx.actorType,
        isSystemOperation: pubCtx.isSystemOperation,
      };
    } catch {
      return reply.status(404).send({
        errors: [
          {
            code: "PUBLICATION_NOT_FOUND",
            message: "Publication not found",
            requestId: req.id,
          },
        ],
      });
    }
  });

  // Public Site Metadata + Active Theme
  fastify.get("/site", {
    handler: async (req, reply) => {
      const site = await buildPublicSiteIdentity();
      const active = await themeService.getActiveTheme();

      return reply.status(200).send({
        site: {
          title: site.title,
          description: site.description,
          url: site.url,
          locale: site.locale,
          direction: site.direction,
          tagline: site.tagline,
          timezone: site.timezone,
          accentColor: site.accentColor,
          iconUrl: site.iconUrl,
          logoUrl: site.logoUrl,
          coverUrl: site.coverUrl,
          primaryNav: site.primaryNav,
          secondaryNav: site.secondaryNav,
          announcementEnabled: site.announcementEnabled,
          announcementText: site.announcementText,
          announcementUrl: site.announcementUrl,
        },
        security: site.security,
        analytics: site.analytics,
        code: site.code,
        comments: site.comments,
        theme: {
          themeId: active?.manifest.id || "vibress-default",
          themeVersion: active?.manifest.version || "1.0.0",
          isBuiltIn: active?.isBuiltIn ?? true,
          settings: active?.settings || {},
          manifest: active?.manifest,
        },
      });
    },
  });

  // Public Verify Site Password
  fastify.post("/verify-site-password", {
    handler: async (req, reply) => {
      const body = req.body as { password?: string } | undefined;
      if (!body || typeof body.password !== "string") {
        return reply
          .status(400)
          .send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message: "Password is required",
                requestId: req.id,
              },
            ],
          });
      }
      const publicSettings = await settingsService.getPublicSettings();
      const isPrivate = Boolean(publicSettings.security?.isPrivate);
      if (!isPrivate) {
        return reply.status(200).send({ valid: true, private: false });
      }
      const stored = await (
        settingsService as unknown as {
          repo: {
            get: (ns: string, k: string) => Promise<{ value: unknown } | null>;
          };
        }
      ).repo.get("security", "passwordHash");
      if (!stored || !stored.value) {
        return reply.status(200).send({ valid: true, private: false });
      }
      const valid = await verifyPassword(String(stored.value), body.password);
      if (valid) {
        const secret =
          getConfig().secrets.encryptionKey ||
          process.env.VIBRESS_ENCRYPTION_KEY ||
          "vibress-site-privacy-secret";
        const token = signSiteAuthToken(secret);
        reply.setCookie(SITE_AUTH_COOKIE_NAME, token, {
          path: "/",
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 30 * 24 * 60 * 60,
        });
        return reply.status(200).send({ valid: true, private: true });
      }
      return reply
        .status(401)
        .send({ valid: false, private: true, message: "Invalid password" });
    },
  });

function extractRequestedLocale(req: any): string | null {
  const query = req.query as { locale?: string } | undefined;
  if (query?.locale && typeof query.locale === "string" && query.locale.trim()) {
    return canonicalizeLocale(query.locale.trim());
  }
  const acceptLang = req.headers["accept-language"];
  if (acceptLang && typeof acceptLang === "string") {
    const primary = acceptLang.split(",")[0]?.split(";")[0]?.trim();
    if (primary && primary !== "*") {
      return canonicalizeLocale(primary);
    }
  }
  return null;
}

  // Public Posts List
  fastify.get("/posts", {
    handler: async (req, reply) => {
      const parseResult = PublicListFilterSchema.safeParse(req.query);
      const filter = parseResult.success
        ? parseResult.data
        : { page: 1, limit: 20 };

      const limit = filter.limit;
      const page = filter.page;
      const offset = (page - 1) * limit;
      const requestedLocale = extractRequestedLocale(req);
      
      const pubId = req.publicationContext?.publicationId;
      const site = await buildPublicSiteIdentity();
      const defaultLocaleCode = (site.locale.split('-')[0] || "en").toLowerCase();
      const isTranslationRequest = requestedLocale && !requestedLocale.startsWith(defaultLocaleCode);

      const { posts, total } = await postsService.listPosts({
        publicationId: pubId,
        publishedOnly: true,
        visibility: "public",
        tagSlug: filter.tag,
        authorSlug: filter.author,
        limit,
        offset,
        sortBy: "publishedAt",
        sortOrder: "desc",
      });

      const summaries = await Promise.all(
        posts.map(async (post) => {
          let mergedPost: any = post;
          if (isTranslationRequest) {
            const tr = await translationService.getTranslation("post", post.id, requestedLocale, undefined, pubId);
            if (tr && (tr.status === "published" || tr.status === "approved" || tr.status === "translated")) {
              mergedPost = {
                ...post,
                title: tr.title,
                slug: tr.slug,
                excerpt: tr.excerpt ?? post.excerpt,
                content: Object.keys(tr.content || {}).length > 0 ? tr.content : post.content,
                metaTitle: tr.metaTitle ?? post.metaTitle,
                metaDescription: tr.metaDescription ?? post.metaDescription,
                locale: tr.targetLocale,
              };
            } else {
              // Missing translation: omit under non-default locale (no silent fallback)
              return null;
            }
          }

          const authorIds = await postsService.getPostTagIds(post.id);
          const [authors, tagsList] = await Promise.all([
            authorsService.getPostAuthors(post.id),
            Promise.all(authorIds.map((tId) => tagsService.findById(tId))),
          ]);
          const validTags = tagsList.filter(
            (t): t is NonNullable<typeof t> => !!t,
          );

          return buildPublicPostSummaryDto(
            mergedPost,
            authors,
            validTags,
            mediaService,
          );
        }),
      );

      const validSummaries = summaries.filter((s): s is NonNullable<typeof s> => s !== null);
      const totalCount = isTranslationRequest ? validSummaries.length : total;
      const totalPages = Math.ceil(totalCount / limit) || 1;

      return reply.status(200).send({
        posts: validSummaries,
        locale: requestedLocale || "en",
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: totalPages,
        },
      });
    },
  });

  // Public Single Post by Slug
  fastify.get("/posts/:slug", {
    handler: async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const requestedLocale = extractRequestedLocale(req);
      const pubId = req.publicationContext?.publicationId;
      
      const site = await buildPublicSiteIdentity();
      const defaultLocaleCode = (site.locale.split('-')[0] || "en").toLowerCase();
      const isTranslationRequest = requestedLocale && !requestedLocale.startsWith(defaultLocaleCode);

      let post = await postsService.findPublishedBySlug(slug, pubId);
      let translationItem = null;

      if (!post) {
        // Try finding by localized slug
        if (requestedLocale) {
          translationItem = await translationService.findTranslationBySlug("post", requestedLocale, slug, pubId);
        }
        if (!translationItem) {
          translationItem =
            (await translationService.findTranslationBySlug("post", "ar-SA", slug, pubId)) ||
            (await translationService.findTranslationBySlugAny("post", slug, pubId));
        }

        if (translationItem) {
          post = await postsService.findById(translationItem.contentId, pubId);
          if (!post || post.status !== "published") {
            post = null;
          }
        }
      } else if (isTranslationRequest) {
        // Source post found, check for translated representation
        translationItem = await translationService.getTranslation(
          "post",
          post.id,
          requestedLocale,
          undefined,
          pubId,
        );

        if (
          !translationItem ||
          (translationItem.status !== "published" &&
            translationItem.status !== "approved" &&
            translationItem.status !== "translated")
        ) {
          return reply.status(404).send({
            errors: [
              {
                code: "TRANSLATION_NOT_FOUND",
                message: `Translation for locale '${requestedLocale}' not found`,
                requestId: req.id,
              },
            ],
          });
        }
      }

      if (!post) {
        return reply.status(404).send({
          errors: [
            {
              code: "CONTENT_NOT_FOUND",
              message: "Post not found",
              requestId: req.id,
            },
          ],
        });
      }

      const mergedPost: any = translationItem
        ? {
            ...post,
            title: translationItem.title,
            slug: translationItem.slug,
            excerpt: translationItem.excerpt ?? post.excerpt,
            content:
              Object.keys(translationItem.content || {}).length > 0
                ? translationItem.content
                : post.content,
            metaTitle: translationItem.metaTitle ?? post.metaTitle,
            metaDescription:
              translationItem.metaDescription ?? post.metaDescription,
            locale: translationItem.targetLocale,
          }
        : post;

      const tagIds = await postsService.getPostTagIds(post.id);
      const [authors, tagsList] = await Promise.all([
        authorsService.getPostAuthors(post.id),
        Promise.all(tagIds.map((tId) => tagsService.findById(tId))),
      ]);
      const validTags = tagsList.filter((t): t is NonNullable<typeof t> => !!t);

      const postDetail = await buildPublicPostDetailDto(
        mergedPost,
        authors,
        validTags,
        mediaService,
      );
      return reply.status(200).send({ post: postDetail, locale: mergedPost.locale || "en" });
    },
  });

  // Public Pages List
  fastify.get("/pages", {
    handler: async (req, reply) => {
      const parseResult = PublicListFilterSchema.safeParse(req.query);
      const filter = parseResult.success
        ? parseResult.data
        : { page: 1, limit: 20 };

      const limit = filter.limit;
      const page = filter.page;
      const offset = (page - 1) * limit;
      const requestedLocale = extractRequestedLocale(req);
      
      const pubId = req.publicationContext?.publicationId;
      const site = await buildPublicSiteIdentity();
      const defaultLocaleCode = (site.locale.split('-')[0] || "en").toLowerCase();
      const isTranslationRequest = requestedLocale && !requestedLocale.startsWith(defaultLocaleCode);

      const { pages, total } = await pagesService.listPages({
        publicationId: pubId,
        publishedOnly: true,
        visibility: "public",
        limit,
        offset,
      });

      const details = await Promise.all(
        pages.map(async (pageObj) => {
          let mergedPage: any = pageObj;
          if (isTranslationRequest) {
            const tr = await translationService.getTranslation("page", pageObj.id, requestedLocale, undefined, pubId);
            if (tr && (tr.status === "published" || tr.status === "approved" || tr.status === "translated")) {
              mergedPage = {
                ...pageObj,
                title: tr.title,
                slug: tr.slug,
                excerpt: tr.excerpt ?? pageObj.excerpt,
                content: Object.keys(tr.content || {}).length > 0 ? tr.content : pageObj.content,
                metaTitle: tr.metaTitle ?? pageObj.metaTitle,
                metaDescription: tr.metaDescription ?? pageObj.metaDescription,
                locale: tr.targetLocale,
              };
            } else {
              return null;
            }
          }
          return buildPublicPageDetailDto(mergedPage, mediaService);
        }),
      );

      const validDetails = details.filter((d): d is NonNullable<typeof d> => d !== null);
      const totalCount = isTranslationRequest ? validDetails.length : total;
      const totalPages = Math.ceil(totalCount / limit) || 1;

      return reply.status(200).send({
        pages: validDetails,
        locale: requestedLocale || "en",
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: totalPages,
        },
      });
    },
  });

  // Public Single Page by Slug
  fastify.get("/pages/:slug", {
    handler: async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const requestedLocale = extractRequestedLocale(req);
      const pubId = req.publicationContext?.publicationId;
      
      const site = await buildPublicSiteIdentity();
      const defaultLocaleCode = (site.locale.split('-')[0] || "en").toLowerCase();
      const isTranslationRequest = requestedLocale && !requestedLocale.startsWith(defaultLocaleCode);

      let pageObj = await pagesService.findPublishedBySlug(slug, pubId);
      let translationItem = null;

      if (!pageObj) {
        if (requestedLocale) {
          translationItem = await translationService.findTranslationBySlug("page", requestedLocale, slug, pubId);
        }
        if (!translationItem) {
          translationItem =
            (await translationService.findTranslationBySlug("page", "ar-SA", slug, pubId)) ||
            (await translationService.findTranslationBySlugAny("page", slug, pubId));
        }

        if (translationItem) {
          pageObj = await pagesService.findById(translationItem.contentId, pubId);
          if (!pageObj || pageObj.status !== "published") {
            pageObj = null;
          }
        }
      } else if (isTranslationRequest) {
        translationItem = await translationService.getTranslation(
          "page",
          pageObj.id,
          requestedLocale,
          undefined,
          pubId,
        );

        if (
          !translationItem ||
          (translationItem.status !== "published" &&
            translationItem.status !== "approved" &&
            translationItem.status !== "translated")
        ) {
          return reply.status(404).send({
            errors: [
              {
                code: "TRANSLATION_NOT_FOUND",
                message: `Translation for locale '${requestedLocale}' not found`,
                requestId: req.id,
              },
            ],
          });
        }
      }

      if (!pageObj) {
        return reply.status(404).send({
          errors: [
            {
              code: "CONTENT_NOT_FOUND",
              message: "Page not found",
              requestId: req.id,
            },
          ],
        });
      }

      const mergedPage: any = translationItem
        ? {
            ...pageObj,
            title: translationItem.title,
            slug: translationItem.slug,
            excerpt: translationItem.excerpt ?? pageObj.excerpt,
            content:
              Object.keys(translationItem.content || {}).length > 0
                ? translationItem.content
                : pageObj.content,
            metaTitle: translationItem.metaTitle ?? pageObj.metaTitle,
            metaDescription:
              translationItem.metaDescription ?? pageObj.metaDescription,
            locale: translationItem.targetLocale,
          }
        : pageObj;

      const pageDetail = await buildPublicPageDetailDto(mergedPage, mediaService);
      return reply.status(200).send({ page: pageDetail, locale: mergedPage.locale || "en" });
    },
  });

  // Public Tags List
  fastify.get("/tags", {
    handler: async (req, reply) => {
      const pubId = req.publicationContext?.publicationId;
      const tagsList = await tagsService.listAll(pubId);
      const formatted = tagsList.map(formatPublicTag);
      return reply.status(200).send({ tags: formatted });
    },
  });

  // Public Tag Detail
  fastify.get("/tags/:slug", {
    handler: async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const pubId = req.publicationContext?.publicationId;
      const tag = await tagsService.findBySlug(slug, pubId);

      if (!tag) {
        return reply.status(404).send({
          errors: [
            {
              code: "TAG_NOT_FOUND",
              message: "Tag not found",
              requestId: req.id,
            },
          ],
        });
      }

      return reply.status(200).send({ tag: formatPublicTag(tag) });
    },
  });

  // Public Tag Posts Archive
  fastify.get("/tags/:slug/posts", {
    handler: async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const pubId = req.publicationContext?.publicationId;
      const tag = await tagsService.findBySlug(slug, pubId);

      if (!tag) {
        return reply.status(404).send({
          errors: [
            {
              code: "TAG_NOT_FOUND",
              message: "Tag not found",
              requestId: req.id,
            },
          ],
        });
      }

      const parseResult = PublicListFilterSchema.safeParse(req.query);
      const filter = parseResult.success
        ? parseResult.data
        : { page: 1, limit: 20 };

      const limit = filter.limit;
      const page = filter.page;
      const offset = (page - 1) * limit;

      const { posts, total } = await postsService.listPosts({
        publicationId: pubId,
        publishedOnly: true,
        visibility: "public",
        tagSlug: slug,
        limit,
        offset,
        sortBy: "publishedAt",
        sortOrder: "desc",
      });

      const summaries = await Promise.all(
        posts.map(async (post) => {
          const tagIds = await postsService.getPostTagIds(post.id);
          const [authors, tagsList] = await Promise.all([
            authorsService.getPostAuthors(post.id),
            Promise.all(tagIds.map((tId) => tagsService.findById(tId))),
          ]);
          const validTags = tagsList.filter(
            (t): t is NonNullable<typeof t> => !!t,
          );

          return buildPublicPostSummaryDto(
            post,
            authors,
            validTags,
            mediaService,
          );
        }),
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
  fastify.get("/authors", {
    handler: async (_req, reply) => {
      const authorRepo = (
        authorsService as unknown as {
          authorRepo: {
            listAuthors: () => Promise<
              Array<{
                id: string;
                name: string;
                slug: string;
                bio: string | null;
              }>
            >;
            findAuthorBySlug: (
              slug: string,
            ) => Promise<{
              id: string;
              name: string;
              slug: string;
              bio: string | null;
            } | null>;
          };
        }
      ).authorRepo;
      const authorList = await authorRepo.listAuthors();
      const formatted = authorList.map((a) => formatPublicAuthor(a as Author));
      return reply.status(200).send({ authors: formatted });
    },
  });

  // Public Author Detail
  fastify.get("/authors/:slug", {
    handler: async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const authorRepo = (
        authorsService as unknown as {
          authorRepo: {
            listAuthors: () => Promise<
              Array<{
                id: string;
                name: string;
                slug: string;
                bio: string | null;
              }>
            >;
            findAuthorBySlug: (
              slug: string,
            ) => Promise<{
              id: string;
              name: string;
              slug: string;
              bio: string | null;
            } | null>;
          };
        }
      ).authorRepo;
      const author = await authorRepo.findAuthorBySlug(slug);

      if (!author) {
        return reply.status(404).send({
          errors: [
            {
              code: "AUTHOR_NOT_FOUND",
              message: "Author not found",
              requestId: req.id,
            },
          ],
        });
      }

      return reply
        .status(200)
        .send({ author: formatPublicAuthor(author as Author) });
    },
  });

  // Public Author Posts Archive
  fastify.get("/authors/:slug/posts", {
    handler: async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const authorRepo = (
        authorsService as unknown as {
          authorRepo: {
            listAuthors: () => Promise<
              Array<{
                id: string;
                name: string;
                slug: string;
                bio: string | null;
              }>
            >;
            findAuthorBySlug: (
              slug: string,
            ) => Promise<{
              id: string;
              name: string;
              slug: string;
              bio: string | null;
            } | null>;
          };
        }
      ).authorRepo;
      const author = await authorRepo.findAuthorBySlug(slug);

      if (!author) {
        return reply.status(404).send({
          errors: [
            {
              code: "AUTHOR_NOT_FOUND",
              message: "Author not found",
              requestId: req.id,
            },
          ],
        });
      }

      const parseResult = PublicListFilterSchema.safeParse(req.query);
      const filter = parseResult.success
        ? parseResult.data
        : { page: 1, limit: 20 };

      const limit = filter.limit;
      const page = filter.page;
      const offset = (page - 1) * limit;

      const pubId = req.publicationContext?.publicationId;
      const { posts, total } = await postsService.listPosts({
        publicationId: pubId,
        publishedOnly: true,
        visibility: "public",
        authorSlug: slug,
        limit,
        offset,
        sortBy: "publishedAt",
        sortOrder: "desc",
      });

      const summaries = await Promise.all(
        posts.map(async (post) => {
          const tagIds = await postsService.getPostTagIds(post.id);
          const [authors, tagsList] = await Promise.all([
            authorsService.getPostAuthors(post.id),
            Promise.all(tagIds.map((tId) => tagsService.findById(tId))),
          ]);
          const validTags = tagsList.filter(
            (t): t is NonNullable<typeof t> => !!t,
          );

          return buildPublicPostSummaryDto(
            post,
            authors,
            validTags,
            mediaService,
          );
        }),
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
