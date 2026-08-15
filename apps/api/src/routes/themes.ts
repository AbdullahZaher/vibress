import { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import {
  requireStaffSession,
  requirePermission,
  validateOrigin,
} from "../middleware/auth";
import { themeService } from "../services";
import { listThemeMetadata, getThemeMetadata } from "@vibress/themes-registry";
import { ThemeSettingsUpdateSchema } from "@vibress/api-contracts";
import {
  ThemeNotFoundError,
  ThemeInvalidError,
  ThemeIncompatibleError,
  ThemeSettingsInvalidError,
  ThemeActivationFailedError,
} from "@vibress/themes";
import { validateThemeId } from "@vibress/theme-core";
import { asCodedError } from "../helpers/errors";

const PREVIEW_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PREVIEW_TOKENS = new Map<
  string,
  { themeId: string; expiresAt: number }
>();

export async function themeRoutes(fastify: FastifyInstance) {
  // List themes
  fastify.get("/themes", {
    preHandler: [requireStaffSession, requirePermission("themes.read")],
    handler: async (_req, reply) => {
      const active = await themeService.getActiveThemeConfiguration();
      const themes = listThemeMetadata().map((t) => ({
        manifest: t.manifest,
        settingsSchema: t.settingsSchema,
        isActive: active?.themeId === t.manifest.id,
      }));
      return reply.status(200).send({ themes });
    },
  });

  // Get single theme
  fastify.get("/themes/:id", {
    preHandler: [requireStaffSession, requirePermission("themes.read")],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        validateThemeId(id);
      } catch (err) {
        const e = asCodedError(err);
        return reply.status(404).send({
          errors: [
            {
              code: e.code || "THEME_NOT_FOUND",
              message: e.message,
              requestId: req.id,
            },
          ],
        });
      }
      const theme = getThemeMetadata(id);
      if (!theme) {
        return reply.status(404).send({
          errors: [
            {
              code: "THEME_NOT_FOUND",
              message: "Theme not found",
              requestId: req.id,
            },
          ],
        });
      }
      const active = await themeService.getActiveThemeConfiguration();
      return reply.status(200).send({
        manifest: theme.manifest,
        settingsSchema: theme.settingsSchema,
        isActive: active?.themeId === theme.manifest.id,
      });
    },
  });

  // Get active theme
  fastify.get("/themes/active", {
    preHandler: [requireStaffSession, requirePermission("themes.read")],
    handler: async (_req, reply) => {
      const active = await themeService.getActiveTheme();
      if (!active) {
        return reply.status(200).send({
          themeId: "vibress-default",
          themeVersion: "1.0.0",
          settings: {},
          settingsSchemaVersion: 1,
        });
      }
      return reply.status(200).send({
        themeId: active.manifest.id,
        themeVersion: active.manifest.version,
        settings: active.settings,
        settingsSchemaVersion: active.manifest.settingsSchemaVersion || 1,
      });
    },
  });

  // Activate theme
  fastify.post("/themes/:id/activate", {
    preHandler: [
      requireStaffSession,
      requirePermission("themes.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        validateThemeId(id);
        const config = await themeService.activateTheme(id, req.user!.id);
        return reply.status(200).send({
          theme: {
            themeId: config.themeId,
            themeVersion: config.themeVersion,
            settings: config.settings,
            settingsSchemaVersion: config.settingsSchemaVersion,
          },
        });
      } catch (err) {
        if (err instanceof ThemeNotFoundError) {
          return reply.status(404).send({
            errors: [
              { code: err.code, message: err.message, requestId: req.id },
            ],
          });
        }
        if (
          err instanceof ThemeInvalidError ||
          err instanceof ThemeIncompatibleError ||
          err instanceof ThemeSettingsInvalidError ||
          err instanceof ThemeActivationFailedError
        ) {
          return reply.status(400).send({
            errors: [
              { code: err.code, message: err.message, requestId: req.id },
            ],
          });
        }
        const e = asCodedError(err);
        if (e.code === "THEME_NOT_FOUND") {
          return reply.status(404).send({
            errors: [
              {
                code: "THEME_NOT_FOUND",
                message: e.message,
                requestId: req.id,
              },
            ],
          });
        }
        throw err;
      }
    },
  });

  // Update theme settings
  fastify.patch("/themes/:id/settings", {
    preHandler: [
      requireStaffSession,
      requirePermission("themes.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const parseResult = ThemeSettingsUpdateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Invalid settings payload",
              requestId: req.id,
            },
          ],
        });
      }

      try {
        validateThemeId(id);
        const config = await themeService.updateThemeSettings(
          id,
          parseResult.data,
          req.user!.id,
        );
        return reply.status(200).send({
          theme: {
            themeId: config.themeId,
            themeVersion: config.themeVersion,
            settings: config.settings,
            settingsSchemaVersion: config.settingsSchemaVersion,
          },
        });
      } catch (err) {
        if (err instanceof ThemeNotFoundError) {
          return reply.status(404).send({
            errors: [
              { code: err.code, message: err.message, requestId: req.id },
            ],
          });
        }
        if (err instanceof ThemeSettingsInvalidError) {
          return reply.status(400).send({
            errors: [
              { code: err.code, message: err.message, requestId: req.id },
            ],
          });
        }
        const e = asCodedError(err);
        return reply.status(400).send({
          errors: [
            {
              code: e.code || "THEME_SETTINGS_INVALID",
              message: e.message,
              requestId: req.id,
            },
          ],
        });
      }
    },
  });

  // Create theme preview token
  fastify.post("/themes/:id/preview", {
    preHandler: [
      requireStaffSession,
      requirePermission("themes.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        validateThemeId(id);
      } catch (err) {
        const e = asCodedError(err);
        return reply.status(404).send({
          errors: [
            {
              code: e.code || "THEME_NOT_FOUND",
              message: e.message,
              requestId: req.id,
            },
          ],
        });
      }
      const theme = getThemeMetadata(id);
      if (!theme) {
        return reply.status(404).send({
          errors: [
            {
              code: "THEME_NOT_FOUND",
              message: "Theme not found",
              requestId: req.id,
            },
          ],
        });
      }

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = Date.now() + PREVIEW_TOKEN_TTL_MS;
      PREVIEW_TOKENS.set(token, { themeId: id, expiresAt });

      return reply.status(200).send({
        previewToken: token,
        expiresAt: new Date(expiresAt).toISOString(),
        themeId: id,
      });
    },
  });

  // Resolve preview token (public-safe, returns theme id only)
  fastify.get("/themes/preview/:token", {
    handler: async (req, reply) => {
      const { token } = req.params as { token: string };
      const entry = PREVIEW_TOKENS.get(token);
      if (!entry || entry.expiresAt < Date.now()) {
        PREVIEW_TOKENS.delete(token);
        return reply.status(404).send({
          errors: [
            {
              code: "THEME_PREVIEW_INVALID",
              message: "Preview token expired or invalid",
              requestId: req.id,
            },
          ],
        });
      }
      return reply.status(200).send({ themeId: entry.themeId });
    },
  });
}
