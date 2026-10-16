import { FastifyInstance } from "fastify";
import {
  PublicListFilterSchema,
  PublicRedirectResolveQuerySchema,
  PublicLegacyTranslationRedirectSchema,
} from "@vibress/api-contracts";
import {
  postsService,
  pagesService,
  tagsService,
  authorsService,
  mediaService,
  themeService,
  settingsService,
  publicationLocaleService,
  workspaceService,
  commentsService,
  redirectsService,
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
import { getDirection, getLocalePrefix } from "@vibress/i18n";
import { canonicalPublicationLocale } from "@vibress/settings";
import type { FastifyRequest } from "fastify";
import { TranslationService } from "@vibress/i18n/server";

const translationService = new TranslationService();

/**
 * Wizard-managed site identity, precedence: DB setting → environment →
 * built-in default. SITE_URL stays infrastructure-driven (canonical URLs,
 * RSS, sitemap, cookies, CORS all depend on it) and is never overridden by
 * the database.
 */
async function buildPublicSiteIdentity(publicationId: string): Promise<{
  title: string;
  description: string;
  url: string;
  locale: string;
  enabledLocales: string[];
  needsLocaleReconciliation: boolean;
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
  const stored = await settingsService.getPublicSettings(publicationId);
  const site = (stored.site ?? {}) as Record<string, unknown>;

  const str = (v: unknown, fallback: string): string =>
    typeof v === "string" && v.trim() !== "" ? v : fallback;
  const localePolicy = await publicationLocaleService.getConfiguration(publicationId);
  const resolvedLocale = localePolicy.primaryLocale;

  return {
    title: str(site.title, config.site.name),
    description: str(site.description, config.site.description),
    tagline: str(site.tagline, ""),
    url: config.site.url,
    locale: resolvedLocale,
    enabledLocales: localePolicy.enabledLocales,
    needsLocaleReconciliation: localePolicy.needsReconciliation,
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

  fastify.get("/legacy-translation/resolve", {
    handler: async (req, reply) => {
      const parsed = PublicLegacyTranslationRedirectSchema.safeParse(req.query);
      if (!parsed.success) return reply.status(400).send({ errors: [{
        code: "VALIDATION_ERROR", message: "Invalid locale lookup", requestId: req.id,
      }] });
      const publicationId = req.publicationContext!.publicationId;
      const policy = await publicationLocaleService.getConfiguration(publicationId);
      const translation = await translationService.findUniquePublishedTranslationBySlug(
        parsed.data.type, parsed.data.slug, publicationId,
      );
      if (!translation || translation.status !== "published" ||
          translation.targetLocale === policy.primaryLocale ||
          !policy.enabledLocales.includes(translation.targetLocale)) {
        return reply.status(404).send({ errors: [{
          code: "CONTENT_NOT_FOUND", message: "Content not found", requestId: req.id,
        }] });
      }
      const source = parsed.data.type === "post"
        ? await postsService.findById(translation.contentId, publicationId)
        : await pagesService.findById(translation.contentId, publicationId);
      if (!source || source.status !== "published" ||
          source.visibility !== "public" || source.deletedAt ||
          !source.publishedAt || source.publishedAt.getTime() > Date.now()) {
        return reply.status(404).send({ errors: [{
          code: "CONTENT_NOT_FOUND", message: "Content not found", requestId: req.id,
        }] });
      }
      const localePrefix = getLocalePrefix(
        translation.targetLocale, policy.primaryLocale, policy.enabledLocales,
      );
      const pathType = parsed.data.type === "post" ? "posts" : "pages";
      return reply.send({
        path: `${localePrefix}/${pathType}/${encodeURIComponent(translation.slug)}`,
      });
    },
  });

  // Host-authoritative public redirect resolution. Never accept a tenant ID
  // from a URL or request header as authorization.
  fastify.get("/redirects/resolve", {
    handler: async (req, reply) => {
      const parsed = PublicRedirectResolveQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({
          errors: [{ code: "VALIDATION_ERROR", message: "Invalid redirect path", requestId: req.id }],
        });
      }
      const redirect = await redirectsService.resolve(
        parsed.data.path,
        req.publicationContext!.publicationId,
      );
      return reply.status(200).send({ redirect });
    },
  });

  // Public Site Metadata + Active Theme
  fastify.get("/site", {
    handler: async (req, reply) => {
      const publicationId = req.publicationContext!.publicationId;
      const site = await buildPublicSiteIdentity(req.publicationContext!.publicationId);
      const active = await themeService.getActiveTheme(publicationId);

      reply.header("x-vibress-publication-id", publicationId);
      return reply.status(200).send({
        site: {
          title: site.title,
          description: site.description,
          url: site.url,
          locale: site.locale,
          enabledLocales: site.enabledLocales,
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
          legacyStorage: active?.legacyStorage ?? false,
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
      const publicSettings = await settingsService.getPublicSettings(
        req.publicationContext!.publicationId,
      );
      const isPrivate = Boolean(publicSettings.security?.isPrivate);
      if (!isPrivate) {
        return reply.status(200).send({ valid: true, private: false });
      }
      const securitySettings = await settingsService.getRawSettings(
        "security",
        req.publicationContext!.publicationId,
      );
      if (!securitySettings.passwordHash) {
        return reply.status(200).send({ valid: true, private: false });
      }
      const valid = await verifyPassword(String(securitySettings.passwordHash), body.password);
      if (valid) {
        const secret =
          getConfig().secrets.encryptionKey ||
          process.env.VIBRESS_ENCRYPTION_KEY ||
          "vibress-site-privacy-secret";
        const token = signSiteAuthToken(
          secret,
          req.publicationContext!.publicationId,
        );
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

function publiclyVisibleTranslation(status: string): boolean {
  // Review or translation-complete states do not constitute publication,
  // including during upgrade reconciliation.
  return status === "published";
}

function extractRequestedLocale(
  req: FastifyRequest,
  enabledLocales: readonly string[],
): { locale: string | null; invalidExplicit: boolean } {
  const query = req.query as { locale?: unknown } | undefined;
  if (query && "locale" in query) {
    if (typeof query.locale !== "string") return { locale: null, invalidExplicit: true };
    try {
      const explicit = canonicalPublicationLocale(query.locale);
      return enabledLocales.includes(explicit)
        ? { locale: explicit, invalidExplicit: false }
        : { locale: null, invalidExplicit: true };
    } catch {
      return { locale: null, invalidExplicit: true };
    }
  }
  const header = req.headers["accept-language"];
  if (typeof header === "string") {
    // Header language preference is advisory, never an enablement override.
    for (const candidate of header.split(",")) {
      const code = candidate.split(";")[0]?.trim();
      if (!code || code === "*") continue;
      try {
        const canonical = canonicalPublicationLocale(code);
        if (enabledLocales.includes(canonical)) {
          return { locale: canonical, invalidExplicit: false };
        }
        const base = canonical.split("-")[0];
        const matches = enabledLocales.filter((enabled) =>
          enabled === base || enabled.split("-")[0] === base);
        if (matches.length === 1) {
          return { locale: matches[0]!, invalidExplicit: false };
        }
      } catch {
        // Skip malformed browser preferences without failing the public site.
      }
    }
  }
  return { locale: null, invalidExplicit: false };
}

  // Published-only, host-scoped alternate URLs for SEO. The source record
  // cannot be resolved across publications or via a disabled locale slug.
  async function serveAlternates(
    type: "post" | "page",
    req: FastifyRequest,
    reply: import("fastify").FastifyReply,
  ) {
    const { slug } = req.params as { slug: string };
    const pubId = req.publicationContext!.publicationId;
    const site = await buildPublicSiteIdentity(pubId);
    const selection = extractRequestedLocale(req, site.enabledLocales);
    if (selection.invalidExplicit) {
      return reply.status(404).send({ errors: [{
        code: "LOCALE_NOT_ENABLED", message: "Language is not enabled", requestId: req.id,
      }] });
    }
    const locale = selection.locale ?? site.locale;
    const isPost = type === "post";
    let source = isPost
      ? await postsService.findPublishedBySlug(slug, pubId)
      : await pagesService.findPublishedBySlug(slug, pubId);
    if (!source && locale !== site.locale) {
      const translated = await translationService.findTranslationBySlug(type, locale, slug, pubId, true);
      if (translated && publiclyVisibleTranslation(translated.status)) {
        source = isPost
          ? await postsService.findById(translated.contentId, pubId)
          : await pagesService.findById(translated.contentId, pubId);
      }
    }
    if (!source || source.status !== "published" ||
        source.visibility !== "public" || source.deletedAt ||
          !source.publishedAt || source.publishedAt.getTime() > Date.now()) {
      return reply.status(404).send({ errors: [{
        code: "CONTENT_NOT_FOUND", message: "Content not found", requestId: req.id,
      }] });
    }
    const stored = await translationService.listTranslationsForContent(type, source.id, pubId);
    const alternates: Record<string, string> = {
      [site.locale]: `/${type === "post" ? "posts" : "pages"}/${encodeURIComponent(source.slug)}`,
    };
    for (const row of stored) {
      if (!publiclyVisibleTranslation(row.status) || !site.enabledLocales.includes(row.targetLocale) ||
          row.targetLocale === site.locale) continue;
      alternates[row.targetLocale] =
        `/${type === "post" ? "posts" : "pages"}/${encodeURIComponent(row.slug)}`;
    }
    return reply.status(200).send({ primaryLocale: site.locale, enabledLocales: site.enabledLocales, alternates });
  }

  fastify.get("/posts/:slug/alternates", {
    handler: async (req, reply) => serveAlternates("post", req, reply),
  });
  fastify.get("/pages/:slug/alternates", {
    handler: async (req, reply) => serveAlternates("page", req, reply),
  });

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
      const pubId = req.publicationContext!.publicationId;
      const site = await buildPublicSiteIdentity(pubId);
      const selection = extractRequestedLocale(req, site.enabledLocales);
      if (selection.invalidExplicit) {
        return reply.status(404).send({ errors: [{
          code: "LOCALE_NOT_ENABLED",
          message: "Requested language is not enabled",
          requestId: req.id,
        }] });
      }
      const requestedLocale = selection.locale ?? site.locale;
      const isTranslationRequest = requestedLocale !== site.locale;

      const { posts, total } = isTranslationRequest
        ? await (async () => {
            const localized = await translationService.listPublishedLocalizedSourceIds(
              "post", pubId, requestedLocale,
              { limit, offset, tagSlug: filter.tag, authorSlug: filter.author },
            );
            const sources = await Promise.all(
              localized.ids.map((id) => postsService.findById(id, pubId)),
            );
            return {
              posts: sources.filter((post): post is NonNullable<typeof post> =>
                !!post && post.status === "published" &&
                post.visibility === "public" && !post.deletedAt),
              total: localized.total,
            };
          })()
        : await postsService.listPosts({
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

      const postIds = posts.map((p) => p.id);
      const commentCounts =
        postIds.length > 0 && pubId
          ? await commentsService.getCommentCounts(pubId, postIds)
          : new Map<string, number>();

      const summaries = await Promise.all(
        posts.map(async (post) => {
          let mergedPost: typeof post & { locale?: string } = post;
          if (isTranslationRequest) {
            const tr = await translationService.getTranslation("post", post.id, requestedLocale, undefined, pubId, true);
            if (tr && (publiclyVisibleTranslation(tr.status))) {
              mergedPost = {
                ...post,
                title: tr.title,
                slug: tr.slug,
                excerpt: tr.excerpt,
                content: tr.content,
                metaTitle: tr.metaTitle,
                metaDescription: tr.metaDescription,
                canonicalUrl: null,
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
            commentCounts.get(post.id) ?? 0,
            { locale: requestedLocale, primaryLocale: site.locale, enabledLocales: site.enabledLocales },
          );
        }),
      );

      const validSummaries = summaries.filter((s): s is NonNullable<typeof s> => s !== null);
      const totalCount = total;
      const totalPages = Math.ceil(totalCount / limit) || 1;

      return reply.status(200).send({
        posts: validSummaries,
        locale: requestedLocale,
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
      const pubId = req.publicationContext!.publicationId;
      const site = await buildPublicSiteIdentity(pubId);
      const selection = extractRequestedLocale(req, site.enabledLocales);
      if (selection.invalidExplicit) {
        return reply.status(404).send({ errors: [{
          code: "LOCALE_NOT_ENABLED",
          message: "Requested language is not enabled",
          requestId: req.id,
        }] });
      }
      const requestedLocale = selection.locale ?? site.locale;
      const isTranslationRequest = requestedLocale !== site.locale;

      let post = await postsService.findPublishedBySlug(slug, pubId);
      let translationItem = null;

      if (!post) {
        // Try finding by localized slug
        if (isTranslationRequest) {
          translationItem = await translationService.findTranslationBySlug("post", requestedLocale, slug, pubId, true);
        } else {
          for (const loc of site.enabledLocales) {
            if (loc === site.locale) continue;
            const item = await translationService.findTranslationBySlug("post", loc, slug, pubId, true);
            if (item && publiclyVisibleTranslation(item.status)) {
              translationItem = item;
              break;
            }
          }
        }

        if (!translationItem || !publiclyVisibleTranslation(translationItem.status)) translationItem = null;
        if (translationItem) {
          post = await postsService.findById(translationItem.contentId, pubId);
          if (!post || post.status !== "published" ||
              post.visibility !== "public" || post.deletedAt ||
              !post.publishedAt || post.publishedAt.getTime() > Date.now()) {
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
          true,
        );

        if (
          !translationItem ||
          !publiclyVisibleTranslation(translationItem.status)
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

      if (!post || post.visibility !== "public" || post.deletedAt ||
              !post.publishedAt || post.publishedAt.getTime() > Date.now()) {
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

      const mergedPost: typeof post & { locale?: string } = translationItem
        ? {
            ...post,
            title: translationItem.title,
            slug: translationItem.slug,
            excerpt: translationItem.excerpt,
            content:
              translationItem.content,
            metaTitle: translationItem.metaTitle,
            metaDescription:
              translationItem.metaDescription,
            canonicalUrl: null,
            locale: translationItem.targetLocale,
          }
        : post;

      const tagIds = await postsService.getPostTagIds(post.id);
      const [authors, tagsList] = await Promise.all([
        authorsService.getPostAuthors(post.id),
        Promise.all(tagIds.map((tId) => tagsService.findById(tId))),
      ]);
      const validTags = tagsList.filter((t): t is NonNullable<typeof t> => !!t);

      const commentCounts = pubId
        ? await commentsService.getCommentCounts(pubId, [post.id])
        : new Map<string, number>();

      const postDetail = await buildPublicPostDetailDto(
        mergedPost,
        authors,
        validTags,
        mediaService,
        commentCounts.get(post.id) ?? 0,
        { locale: translationItem?.targetLocale ?? requestedLocale, primaryLocale: site.locale, enabledLocales: site.enabledLocales },
      );
      return reply.status(200).send({ post: postDetail, locale: translationItem?.targetLocale ?? requestedLocale });
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
      const pubId = req.publicationContext!.publicationId;
      const site = await buildPublicSiteIdentity(pubId);
      const selection = extractRequestedLocale(req, site.enabledLocales);
      if (selection.invalidExplicit) {
        return reply.status(404).send({ errors: [{
          code: "LOCALE_NOT_ENABLED",
          message: "Requested language is not enabled",
          requestId: req.id,
        }] });
      }
      const requestedLocale = selection.locale ?? site.locale;
      const isTranslationRequest = requestedLocale !== site.locale;

      const { pages, total } = isTranslationRequest
        ? await (async () => {
            const localized = await translationService.listPublishedLocalizedSourceIds(
              "page", pubId, requestedLocale, { limit, offset },
            );
            const sources = await Promise.all(
              localized.ids.map((id) => pagesService.findById(id, pubId)),
            );
            return {
              pages: sources.filter((pageObj): pageObj is NonNullable<typeof pageObj> =>
                !!pageObj && pageObj.status === "published" &&
                pageObj.visibility === "public" && !pageObj.deletedAt),
              total: localized.total,
            };
          })()
        : await pagesService.listPages({
            publicationId: pubId,
            publishedOnly: true,
            visibility: "public",
            limit,
            offset,
          });

      const details = await Promise.all(
        pages.map(async (pageObj) => {
          let mergedPage: typeof pageObj & { locale?: string } = pageObj;
          if (isTranslationRequest) {
            const tr = await translationService.getTranslation("page", pageObj.id, requestedLocale, undefined, pubId, true);
            if (tr && (publiclyVisibleTranslation(tr.status))) {
              mergedPage = {
                ...pageObj,
                title: tr.title,
                slug: tr.slug,
                excerpt: tr.excerpt,
                content: tr.content,
                metaTitle: tr.metaTitle,
                metaDescription: tr.metaDescription,
                canonicalUrl: null,
                locale: tr.targetLocale,
              };
            } else {
              return null;
            }
          }
          return buildPublicPageDetailDto(
            mergedPage, mediaService,
            { locale: requestedLocale, primaryLocale: site.locale, enabledLocales: site.enabledLocales },
          );
        }),
      );

      const validDetails = details.filter((d): d is NonNullable<typeof d> => d !== null);
      const totalCount = total;
      const totalPages = Math.ceil(totalCount / limit) || 1;

      return reply.status(200).send({
        pages: validDetails,
        locale: requestedLocale,
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
      const pubId = req.publicationContext!.publicationId;
      const site = await buildPublicSiteIdentity(pubId);
      const selection = extractRequestedLocale(req, site.enabledLocales);
      if (selection.invalidExplicit) {
        return reply.status(404).send({ errors: [{
          code: "LOCALE_NOT_ENABLED",
          message: "Requested language is not enabled",
          requestId: req.id,
        }] });
      }
      const requestedLocale = selection.locale ?? site.locale;
      const isTranslationRequest = requestedLocale !== site.locale;

      let pageObj = await pagesService.findPublishedBySlug(slug, pubId);
      let translationItem = null;

      if (!pageObj) {
        if (isTranslationRequest) {
          translationItem = await translationService.findTranslationBySlug("page", requestedLocale, slug, pubId, true);
        } else {
          for (const loc of site.enabledLocales) {
            if (loc === site.locale) continue;
            const item = await translationService.findTranslationBySlug("page", loc, slug, pubId, true);
            if (item && publiclyVisibleTranslation(item.status)) {
              translationItem = item;
              break;
            }
          }
        }

        if (!translationItem || !publiclyVisibleTranslation(translationItem.status)) translationItem = null;
        if (translationItem) {
          pageObj = await pagesService.findById(translationItem.contentId, pubId);
          if (!pageObj || pageObj.status !== "published" ||
              pageObj.visibility !== "public" || pageObj.deletedAt ||
              !pageObj.publishedAt || pageObj.publishedAt.getTime() > Date.now()) {
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
          true,
        );

        if (
          !translationItem ||
          !publiclyVisibleTranslation(translationItem.status)
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

      if (!pageObj || pageObj.visibility !== "public" || pageObj.deletedAt ||
              !pageObj.publishedAt || pageObj.publishedAt.getTime() > Date.now()) {
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

      const mergedPage: typeof pageObj & { locale?: string } = translationItem
        ? {
            ...pageObj,
            title: translationItem.title,
            slug: translationItem.slug,
            excerpt: translationItem.excerpt,
            content:
              translationItem.content,
            metaTitle: translationItem.metaTitle,
            metaDescription:
              translationItem.metaDescription,
            canonicalUrl: null,
            locale: translationItem.targetLocale,
          }
        : pageObj;

      const pageDetail = await buildPublicPageDetailDto(
        mergedPage, mediaService,
        { locale: translationItem?.targetLocale ?? requestedLocale, primaryLocale: site.locale, enabledLocales: site.enabledLocales },
      );
      return reply.status(200).send({ page: pageDetail, locale: translationItem?.targetLocale ?? requestedLocale });
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

      const publicationId = req.publicationContext!.publicationId;
      const site = await buildPublicSiteIdentity(publicationId);
      const selection = extractRequestedLocale(req, site.enabledLocales);
      if (selection.invalidExplicit) {
        return reply.status(404).send({ errors: [{
          code: "LOCALE_NOT_ENABLED", message: "Requested language is not enabled",
          requestId: req.id,
        }] });
      }
      const requestedLocale = selection.locale ?? site.locale;
      const isTranslationRequest = requestedLocale !== site.locale;

      const parseResult = PublicListFilterSchema.safeParse(req.query);
      const filter = parseResult.success
        ? parseResult.data
        : { page: 1, limit: 20 };

      const limit = filter.limit;
      const page = filter.page;
      const offset = (page - 1) * limit;

      const { posts, total } = isTranslationRequest
        ? await (async () => {
            const localized = await translationService.listPublishedLocalizedSourceIds(
              "post", publicationId, requestedLocale,
              { limit, offset, tagSlug: slug },
            );
            const sources = await Promise.all(
              localized.ids.map((id) => postsService.findById(id, publicationId)),
            );
            return {
              posts: sources.filter((post): post is NonNullable<typeof post> =>
                !!post && post.status === "published" &&
                post.visibility === "public" && !post.deletedAt),
              total: localized.total,
            };
          })()
        : await postsService.listPosts({
            publicationId,
            publishedOnly: true,
            visibility: "public",
            tagSlug: slug,
            limit,
            offset,
            sortBy: "publishedAt",
            sortOrder: "desc",
          });

      const postIds = posts.map((p) => p.id);
      const commentCounts =
        postIds.length > 0 && pubId
          ? await commentsService.getCommentCounts(pubId, postIds)
          : new Map<string, number>();

      const summaries = await Promise.all(
        posts.map(async (post) => {
          let mergedPost: typeof post & { locale?: string } = post;
          if (isTranslationRequest) {
            const translation = await translationService.getTranslation(
              "post", post.id, requestedLocale, undefined, publicationId, true,
            );
            if (!translation || translation.status !== "published") return null;
            mergedPost = {
              ...post,
              title: translation.title,
              slug: translation.slug,
              excerpt: translation.excerpt,
              content: translation.content,
              metaTitle: translation.metaTitle,
              metaDescription: translation.metaDescription,
              canonicalUrl: null,
              locale: translation.targetLocale,
            };
          }
          const tagIds = await postsService.getPostTagIds(post.id);
          const [authors, tagsList] = await Promise.all([
            authorsService.getPostAuthors(post.id),
            Promise.all(tagIds.map((tId) => tagsService.findById(tId))),
          ]);
          const validTags = tagsList.filter(
            (t): t is NonNullable<typeof t> => !!t,
          );

          return buildPublicPostSummaryDto(
            mergedPost,
            authors,
            validTags,
            mediaService,
            commentCounts.get(post.id) ?? 0,
            { locale: requestedLocale, primaryLocale: site.locale, enabledLocales: site.enabledLocales },
          );
        }),
      );

      const validSummaries = summaries.filter((item): item is NonNullable<typeof item> => item !== null);
      const totalPages = Math.ceil(total / limit) || 1;

      return reply.status(200).send({
        tag: formatPublicTag(tag),
        posts: validSummaries,
        locale: requestedLocale,
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
    handler: async (req, reply) => {
      const authorList = await authorsService.listAuthors(
        req.publicationContext?.publicationId,
      );
      const formatted = authorList.map((a) => formatPublicAuthor(a as Author));
      return reply.status(200).send({ authors: formatted });
    },
  });

  // Public Author Detail
  fastify.get("/authors/:slug", {
    handler: async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const author = await authorsService.findAuthorBySlug(
        slug,
        req.publicationContext?.publicationId,
      );

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
      const author = await authorsService.findAuthorBySlug(
        slug,
        req.publicationContext?.publicationId,
      );

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

      const publicationId = req.publicationContext!.publicationId;
      const site = await buildPublicSiteIdentity(publicationId);
      const selection = extractRequestedLocale(req, site.enabledLocales);
      if (selection.invalidExplicit) {
        return reply.status(404).send({ errors: [{
          code: "LOCALE_NOT_ENABLED", message: "Requested language is not enabled",
          requestId: req.id,
        }] });
      }
      const requestedLocale = selection.locale ?? site.locale;
      const isTranslationRequest = requestedLocale !== site.locale;

      const parseResult = PublicListFilterSchema.safeParse(req.query);
      const filter = parseResult.success
        ? parseResult.data
        : { page: 1, limit: 20 };

      const limit = filter.limit;
      const page = filter.page;
      const offset = (page - 1) * limit;

      const pubId = req.publicationContext?.publicationId;
      const { posts, total } = isTranslationRequest
        ? await (async () => {
            const localized = await translationService.listPublishedLocalizedSourceIds(
              "post", publicationId, requestedLocale,
              { limit, offset, authorSlug: slug },
            );
            const sources = await Promise.all(
              localized.ids.map((id) => postsService.findById(id, publicationId)),
            );
            return {
              posts: sources.filter((post): post is NonNullable<typeof post> =>
                !!post && post.status === "published" &&
                post.visibility === "public" && !post.deletedAt),
              total: localized.total,
            };
          })()
        : await postsService.listPosts({
            publicationId,
            publishedOnly: true,
            visibility: "public",
            authorSlug: slug,
            limit,
            offset,
            sortBy: "publishedAt",
            sortOrder: "desc",
          });

      const postIds = posts.map((p) => p.id);
      const commentCounts =
        postIds.length > 0 && pubId
          ? await commentsService.getCommentCounts(pubId, postIds)
          : new Map<string, number>();

      const summaries = await Promise.all(
        posts.map(async (post) => {
          let mergedPost: typeof post & { locale?: string } = post;
          if (isTranslationRequest) {
            const translation = await translationService.getTranslation(
              "post", post.id, requestedLocale, undefined, publicationId, true,
            );
            if (!translation || translation.status !== "published") return null;
            mergedPost = {
              ...post,
              title: translation.title,
              slug: translation.slug,
              excerpt: translation.excerpt,
              content: translation.content,
              metaTitle: translation.metaTitle,
              metaDescription: translation.metaDescription,
              canonicalUrl: null,
              locale: translation.targetLocale,
            };
          }
          const tagIds = await postsService.getPostTagIds(post.id);
          const [authors, tagsList] = await Promise.all([
            authorsService.getPostAuthors(post.id),
            Promise.all(tagIds.map((tId) => tagsService.findById(tId))),
          ]);
          const validTags = tagsList.filter(
            (t): t is NonNullable<typeof t> => !!t,
          );

          return buildPublicPostSummaryDto(
            mergedPost,
            authors,
            validTags,
            mediaService,
            commentCounts.get(post.id) ?? 0,
            { locale: requestedLocale, primaryLocale: site.locale, enabledLocales: site.enabledLocales },
          );
        }),
      );

      const validSummaries = summaries.filter((item): item is NonNullable<typeof item> => item !== null);
      const totalPages = Math.ceil(total / limit) || 1;

      return reply.status(200).send({
        author: formatPublicAuthor(author as Author),
        posts: validSummaries,
        locale: requestedLocale,
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
