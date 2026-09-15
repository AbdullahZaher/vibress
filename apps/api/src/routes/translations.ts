import { FastifyInstance } from "fastify";
import {
  translationService,
  postsService,
  pagesService,
  settingsService,
  auditService,
  getAiGatewayService,
} from "../services";
import {
  requireStaffSession,
  requirePermission,
  validateOrigin,
} from "../middleware/auth";
import { TranslationStatus } from "@vibress/database";
import { defaultTranslationGlossary } from "@vibress/i18n";
import { hasPermission } from "@vibress/security";

export async function translationRoutes(fastify: FastifyInstance) {
  // Helper to fetch enabled publication locales
  async function getPublicationLocales(): Promise<{
    defaultLocale: string;
    enabledLocales: string[];
  }> {
    const siteSettings = await settingsService
      .getRawSettings("site")
      .catch(() => ({} as Record<string, unknown>));

    const defaultLocale = (siteSettings.locale as string) || "en";
    let enabledLocales = ["en", "ar-SA"];

    if (siteSettings.enabledLocales) {
      if (Array.isArray(siteSettings.enabledLocales)) {
        enabledLocales = siteSettings.enabledLocales as string[];
      } else if (typeof siteSettings.enabledLocales === "string") {
        enabledLocales = (siteSettings.enabledLocales as string)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }

    if (!enabledLocales.includes(defaultLocale)) {
      enabledLocales.unshift(defaultLocale);
    }
    if (!enabledLocales.includes("ar-SA") && !enabledLocales.includes("ar")) {
      enabledLocales.push("ar-SA");
    }

    return { defaultLocale, enabledLocales };
  }

  // 1. Get Translation Matrix
  fastify.get("/translations/matrix", {
    preHandler: [requireStaffSession, requirePermission("translations.read")],
    handler: async (req, reply) => {
      const { contentType, search, locale, status, onlyStale, limit, offset } =
        (req.query ?? {}) as {
          contentType?: "post" | "page" | "all";
          search?: string;
          locale?: string;
          status?: string;
          onlyStale?: string;
          limit?: string;
          offset?: string;
        };

      const { defaultLocale, enabledLocales } = await getPublicationLocales();

      const result = await translationService.getTranslationMatrix(
        {
          contentType: contentType || undefined,
          search: search || undefined,
          locale: locale || undefined,
          status: status || undefined,
          onlyStale: onlyStale === "true" || onlyStale === "1",
          limit: limit ? parseInt(limit, 10) : 20,
          offset: offset ? parseInt(offset, 10) : 0,
          publicationId: req.publicationContext?.publicationId,
        },
        enabledLocales,
        defaultLocale,
      );

      return reply.status(200).send({
        items: result.items,
        total: result.total,
        enabledLocales,
        defaultLocale,
      });
    },
  });

  // 2. Get Translation Review Queue
  fastify.get("/translations/queue", {
    preHandler: [requireStaffSession, requirePermission("translations.read")],
    handler: async (req, reply) => {
      const { defaultLocale, enabledLocales } = await getPublicationLocales();
      const queue = await translationService.getTranslationQueue(
        enabledLocales,
        defaultLocale,
        req.publicationContext?.publicationId,
      );
      return reply.status(200).send(queue);
    },
  });

  // 3. Get Localization Health & Coverage Metrics
  fastify.get("/translations/health", {
    preHandler: [requireStaffSession, requirePermission("translations.read")],
    handler: async (req, reply) => {
      const { defaultLocale, enabledLocales } = await getPublicationLocales();
      const health = await translationService.getLocalizationHealth(
        enabledLocales,
        defaultLocale,
        req.publicationContext?.publicationId,
      );
      return reply.status(200).send(health);
    },
  });

  // 4. Get Translation by ID
  fastify.get("/translations/:id", {
    preHandler: [requireStaffSession, requirePermission("translations.read")],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const tr = await translationService.getTranslationById(
        id,
        req.publicationContext?.publicationId,
      );
      if (!tr) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: "Translation not found",
        });
      }

      // Fetch source content to compute source reference diff context
      let sourceItem: {
        title: string;
        slug: string;
        excerpt: string | null;
        content: unknown;
        updatedAt: Date;
      } | null = null;

      if (tr.contentType === "post") {
        const p = await postsService
          .findById(tr.contentId, req.publicationContext?.publicationId)
          .catch(() => null);
        if (p) {
          sourceItem = {
            title: p.title,
            slug: p.slug,
            excerpt: p.excerpt,
            content: p.content,
            updatedAt: p.updatedAt,
          };
        }
      } else if (tr.contentType === "page") {
        const pg = await pagesService
          .findById(tr.contentId, req.publicationContext?.publicationId)
          .catch(() => null);
        if (pg) {
          sourceItem = {
            title: pg.title,
            slug: pg.slug,
            excerpt: pg.excerpt,
            content: pg.content,
            updatedAt: pg.updatedAt,
          };
        }
      }

      const isStale =
        tr.status === "stale" ||
        (sourceItem && tr.translatedAt
          ? sourceItem.updatedAt.getTime() > tr.translatedAt.getTime()
          : false);

      return reply.status(200).send({
        translation: {
          ...tr,
          status: isStale ? "stale" : tr.status,
          isStale: Boolean(isStale),
        },
        source: sourceItem,
      });
    },
  });

  // 5. List Translations for a Content Item
  fastify.get("/content/:type/:id/translations", {
    preHandler: [requireStaffSession, requirePermission("translations.read")],
    handler: async (req, reply) => {
      const { type, id } = req.params as { type: string; id: string };
      const translations = await translationService.listTranslationsForContent(
        type,
        id,
        req.publicationContext?.publicationId,
      );
      return reply.status(200).send({ translations });
    },
  });

  // 6. Create / Upsert Translation for Content Item
  fastify.post("/content/:type/:id/translations", {
    preHandler: [
      validateOrigin,
      requireStaffSession,
      requirePermission("translations.create"),
    ],
    handler: async (req, reply) => {
      const user = req.user!;
      const { type, id } = req.params as { type: "post" | "page"; id: string };
      const body = (req.body ?? {}) as {
        targetLocale: string;
        title: string;
        slug: string;
        excerpt?: string;
        content?: Record<string, unknown>;
        metaTitle?: string;
        metaDescription?: string;
        status?: TranslationStatus;
        translationProvider?: string;
      };

      if (!body.targetLocale || !body.title || !body.slug) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "targetLocale, title, and slug are required",
        });
      }

      const { defaultLocale } = await getPublicationLocales();

      // Check if source exists
      let sourceUpdatedAt = new Date();
      if (type === "post") {
        const post = await postsService.findById(
          id,
          req.publicationContext?.publicationId,
        );
        if (!post) {
          return reply.status(404).send({
            statusCode: 404,
            error: "Not Found",
            message: "Source post not found",
          });
        }
        sourceUpdatedAt = post.updatedAt;
      } else if (type === "page") {
        const page = await pagesService.findById(
          id,
          req.publicationContext?.publicationId,
        );
        if (!page) {
          return reply.status(404).send({
            statusCode: 404,
            error: "Not Found",
            message: "Source page not found",
          });
        }
        sourceUpdatedAt = page.updatedAt;
      }

      const translation = await translationService.upsertTranslation({
        contentType: type,
        contentId: id,
        sourceLocale: defaultLocale,
        targetLocale: body.targetLocale,
        title: body.title,
        slug: body.slug,
        excerpt: body.excerpt,
        content: body.content,
        metaTitle: body.metaTitle,
        metaDescription: body.metaDescription,
        status: body.status || "draft",
        translationProvider: body.translationProvider || "human",
        sourceUpdatedAt,
        publicationId: req.publicationContext?.publicationId,
      });

      await auditService.record({
        actorUserId: user.id,
        action: "translation.created",
        targetType: "translation",
        targetId: translation.id,
        metadata: {
          contentType: type,
          contentId: id,
          targetLocale: body.targetLocale,
          status: translation.status,
        },
      });

      return reply.status(201).send({ translation });
    },
  });

  // 7. Update Translation Fields
  fastify.patch("/translations/:id", {
    preHandler: [
      validateOrigin,
      requireStaffSession,
      requirePermission("translations.edit"),
    ],
    handler: async (req, reply) => {
      const user = req.user!;
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as {
        title?: string;
        slug?: string;
        excerpt?: string;
        content?: Record<string, unknown>;
        metaTitle?: string;
        metaDescription?: string;
        status?: TranslationStatus;
        translationProvider?: string;
      };

      const existing = await translationService.getTranslationById(
        id,
        req.publicationContext?.publicationId,
      );
      if (!existing) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: "Translation not found",
        });
      }

      const updated = await translationService.upsertTranslation({
        contentType: existing.contentType as any,
        contentId: existing.contentId,
        translationGroupId: existing.translationGroupId,
        sourceLocale: existing.sourceLocale,
        targetLocale: existing.targetLocale,
        title: body.title ?? existing.title,
        slug: body.slug ?? existing.slug,
        excerpt: body.excerpt !== undefined ? body.excerpt : existing.excerpt,
        content: body.content !== undefined ? body.content : existing.content,
        metaTitle:
          body.metaTitle !== undefined ? body.metaTitle : existing.metaTitle,
        metaDescription:
          body.metaDescription !== undefined
            ? body.metaDescription
            : existing.metaDescription,
        status: body.status !== undefined ? body.status : existing.status,
        translationProvider:
          body.translationProvider ?? existing.translationProvider ?? "human",
        publicationId: req.publicationContext?.publicationId,
      });

      await auditService.record({
        actorUserId: user.id,
        action: "translation.updated",
        targetType: "translation",
        targetId: id,
        metadata: {
          targetLocale: existing.targetLocale,
          status: updated.status,
        },
      });

      return reply.status(200).send({ translation: updated });
    },
  });

  // 8. Submit Translation for Editorial Review
  fastify.post("/translations/:id/submit-review", {
    preHandler: [
      validateOrigin,
      requireStaffSession,
      requirePermission("translations.review"),
    ],
    handler: async (req, reply) => {
      const user = req.user!;
      const { id } = req.params as { id: string };
      try {
        const updated = await translationService.submitForReview(
          id,
          req.publicationContext?.publicationId,
        );
        if (!updated) {
          return reply.status(404).send({
            statusCode: 404,
            error: "Not Found",
            message: "Translation not found",
          });
        }

        await auditService.record({
          actorUserId: user.id,
          action: "translation.submitted_review",
          targetType: "translation",
          targetId: id,
          metadata: { targetLocale: updated.targetLocale },
        });

        return reply.status(200).send({ translation: updated });
      } catch (err: any) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: err.message,
        });
      }
    },
  });

  // 9. Approve Translation
  fastify.post("/translations/:id/approve", {
    preHandler: [
      validateOrigin,
      requireStaffSession,
      requirePermission("translations.approve"),
    ],
    handler: async (req, reply) => {
      const user = req.user!;
      const { id } = req.params as { id: string };
      try {
        const updated = await translationService.approveTranslation(
          id,
          user.id,
          req.publicationContext?.publicationId,
        );
        if (!updated) {
          return reply.status(404).send({
            statusCode: 404,
            error: "Not Found",
            message: "Translation not found",
          });
        }

        await auditService.record({
          actorUserId: user.id,
          action: "translation.approved",
          targetType: "translation",
          targetId: id,
          metadata: { targetLocale: updated.targetLocale },
        });

        return reply.status(200).send({ translation: updated });
      } catch (err: any) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: err.message,
        });
      }
    },
  });

  // 10. Publish Translation
  fastify.post("/translations/:id/publish", {
    preHandler: [
      validateOrigin,
      requireStaffSession,
      requirePermission("translations.publish"),
    ],
    handler: async (req, reply) => {
      const user = req.user!;
      const { id } = req.params as { id: string };
      try {
        const updated = await translationService.publishTranslation(
          id,
          req.publicationContext?.publicationId,
        );
        if (!updated) {
          return reply.status(404).send({
            statusCode: 404,
            error: "Not Found",
            message: "Translation not found",
          });
        }

        await auditService.record({
          actorUserId: user.id,
          action: "translation.published",
          targetType: "translation",
          targetId: id,
          metadata: { targetLocale: updated.targetLocale },
        });

        return reply.status(200).send({ translation: updated });
      } catch (err: any) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: err.message,
        });
      }
    },
  });

  // 11. AI Translation Draft Generation (Safety Guarantee: Saves in 'needs_review', NEVER auto-published)
  fastify.post("/content/:type/:id/ai-translate", {
    preHandler: [
      validateOrigin,
      requireStaffSession,
      requirePermission("translations.create"),
    ],
    handler: async (req, reply) => {
      const user = req.user!;
      const { type, id } = req.params as { type: "post" | "page"; id: string };
      const body = (req.body ?? {}) as {
        targetLocale: string;
        provider?: string;
        model?: string;
      };

      if (!body.targetLocale) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "targetLocale is required",
        });
      }

      const { defaultLocale } = await getPublicationLocales();

      // Retrieve source content
      let sourceTitle = "";
      let sourceSlug = "";
      let sourceExcerpt: string | null = null;
      let sourceContent: Record<string, unknown> = {};
      let sourceUpdatedAt = new Date();

      if (type === "post") {
        const post = await postsService.findById(id, req.publicationContext?.publicationId);
        if (!post) {
          return reply.status(404).send({
            statusCode: 404,
            error: "Not Found",
            message: "Source post not found",
          });
        }
        sourceTitle = post.title;
        sourceSlug = post.slug;
        sourceExcerpt = post.excerpt;
        sourceContent = (post.content as Record<string, unknown>) || {};
        sourceUpdatedAt = post.updatedAt;
      } else if (type === "page") {
        const page = await pagesService.findById(id, req.publicationContext?.publicationId);
        if (!page) {
          return reply.status(404).send({
            statusCode: 404,
            error: "Not Found",
            message: "Source page not found",
          });
        }
        sourceTitle = page.title;
        sourceSlug = page.slug;
        sourceExcerpt = page.excerpt;
        sourceContent = (page.content as Record<string, unknown>) || {};
        sourceUpdatedAt = page.updatedAt;
      }

      // Translate using AI Gateway
      let translatedTitle = sourceTitle;
      let translatedExcerpt = sourceExcerpt || "";
      const translatedSlug = `${sourceSlug}-${body.targetLocale.toLowerCase().slice(0, 2)}`;

      try {
        const aiGateway = await getAiGatewayService();
        const targetLocaleName =
          body.targetLocale === "ar-SA" || body.targetLocale === "ar"
            ? "Arabic"
            : body.targetLocale === "fr-FR" || body.targetLocale === "fr"
              ? "French"
              : body.targetLocale === "fa-IR" || body.targetLocale === "fa"
                ? "Persian"
                : body.targetLocale;

        const glossaryInstructions = defaultTranslationGlossary.buildGlossaryPromptInstructions(
          defaultLocale,
          body.targetLocale,
        );

        const aiResponse = await aiGateway.generate({
          task: "translate",
          prompt: `Title: ${sourceTitle}\nExcerpt: ${sourceExcerpt || ""}${glossaryInstructions}`,
          targetLanguage: targetLocaleName,
          userId: user.id,
        });

        if (aiResponse && aiResponse.text) {
          const lines = aiResponse.text.split("\n").map((l) => l.trim()).filter(Boolean);
          if (lines[0]) {
            translatedTitle = lines[0].replace(/^(Title:|العنوان:)/i, "").trim();
          }
          if (lines[1]) {
            translatedExcerpt = lines.slice(1).join("\n").replace(/^(Excerpt:|الملخص:)/i, "").trim();
          }
        }
      } catch {
        // Fallback translation stub for offline/test environments
        translatedTitle =
          body.targetLocale.startsWith("ar")
            ? `[ترجمة آلية] ${sourceTitle}`
            : `[AI ${body.targetLocale}] ${sourceTitle}`;
      }

      // Save as reviewable draft with 'needs_review' status (NEVER published directly)
      const translation = await translationService.upsertTranslation({
        publicationId: req.publicationContext?.publicationId,
        contentType: type,
        contentId: id,
        sourceLocale: defaultLocale,
        targetLocale: body.targetLocale,
        title: translatedTitle,
        slug: translatedSlug,
        excerpt: translatedExcerpt,
        content: sourceContent,
        status: "needs_review",
        translationProvider: `ai:${body.provider || "gateway"}`,
        sourceUpdatedAt,
      });

      await auditService.record({
        actorUserId: user.id,
        action: "translation.ai_generated",
        targetType: "translation",
        targetId: translation.id,
        metadata: {
          targetLocale: body.targetLocale,
          provider: body.provider || "gateway",
          status: "needs_review",
        },
      });

      return reply.status(200).send({
        translation,
        message:
          "AI translation draft generated successfully and placed in 'needs_review' status.",
      });
    },
  });

  // 12. Bulk Translation Operations
  fastify.post("/translations/bulk", {
    preHandler: [
      validateOrigin,
      requireStaffSession,
      requirePermission("translations.edit"),
    ],
    handler: async (req, reply) => {
      const user = req.user!;
      const body = (req.body ?? {}) as {
        translationIds: string[];
        action: "submit_review" | "approve" | "publish" | "mark_stale" | "delete";
      };

      if (!body.translationIds || !Array.isArray(body.translationIds) || !body.action) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "translationIds array and action are required",
        });
      }

      // Granular action-specific permission enforcement
      const userPerms = req.permissions || [];
      const userRoles = req.roles || [];
      const checkPerm = (p: string) => hasPermission(userPerms, p, userRoles);

      if (body.action === "publish" && !checkPerm("translations.publish")) {
        return reply.status(403).send({
          statusCode: 403,
          error: "Forbidden",
          message: "You do not have permission 'translations.publish' to perform bulk publish.",
        });
      }
      if (body.action === "approve" && !checkPerm("translations.approve")) {
        return reply.status(403).send({
          statusCode: 403,
          error: "Forbidden",
          message: "You do not have permission 'translations.approve' to perform bulk approve.",
        });
      }
      if (body.action === "delete" && !checkPerm("translations.manage")) {
        return reply.status(403).send({
          statusCode: 403,
          error: "Forbidden",
          message: "You do not have permission 'translations.manage' to perform bulk delete.",
        });
      }

      const result = await translationService.bulkUpdateTranslations({
        translationIds: body.translationIds,
        action: body.action,
        reviewerId: user.id,
        publicationId: req.publicationContext?.publicationId,
      });

      await auditService.record({
        actorUserId: user.id,
        action: "translation.bulk_action",
        targetType: "translation",
        targetId: "bulk",
        metadata: {
          action: body.action,
          count: result.updatedCount,
          succeeded: result.succeededIds,
          failed: result.failed,
          errors: result.errors,
        },
      });

      return reply.status(200).send(result);
    },
  });
}
