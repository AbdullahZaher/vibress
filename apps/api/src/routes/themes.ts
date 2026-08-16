import { FastifyInstance } from "fastify";
import {
  requireStaffSession,
  requirePermission,
  validateOrigin,
} from "../middleware/auth";
import { themeService, themeInstaller, auditService } from "../services";
import { ThemeSettingsUpdateSchema } from "@vibress/api-contracts";
import {
  ThemeNotFoundError,
  ThemeInvalidError,
  ThemeIncompatibleError,
  ThemeSettingsInvalidError,
  ThemeActivationFailedError,
} from "@vibress/themes";
import {
  validateThemeId,
  ThemeSecurityError,
  ThemeZipError,
} from "@vibress/theme-core";
import { asCodedError, errorMessage } from "../helpers/errors";

export async function themeRoutes(fastify: FastifyInstance) {
  // List all themes (built-in + installed external)
  fastify.get("/themes", {
    preHandler: [requireStaffSession, requirePermission("themes.read")],
    handler: async (_req, reply) => {
      const themes = await themeService.listThemes();
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

      const theme = await themeService.getTheme(id);
      if (!theme) {
        return reply.status(404).send({
          errors: [
            {
              code: "THEME_NOT_FOUND",
              message: `Theme not found: ${id}`,
              requestId: req.id,
            },
          ],
        });
      }

      const active = await themeService.getActiveThemeConfiguration();
      return reply.status(200).send({
        manifest: theme.manifest,
        settingsSchema: theme.settingsSchema,
        isBuiltIn: theme.isBuiltIn,
        previewImage: theme.previewImage,
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
          isBuiltIn: true,
        });
      }
      return reply.status(200).send({
        themeId: active.manifest.id,
        themeVersion: active.manifest.version,
        settings: active.settings,
        settingsSchemaVersion: active.manifest.settingsSchemaVersion || 1,
        isBuiltIn: active.isBuiltIn,
        previewImage: active.previewImage,
      });
    },
  });

  // Upload external theme ZIP package
  fastify.post("/themes/upload", {
    preHandler: [
      requireStaffSession,
      requirePermission("themes.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      let fileData;
      try {
        fileData = await req.file();
      } catch (err) {
        return reply.status(400).send({
          errors: [
            {
              code: "THEME_UPLOAD_FAILED",
              message: errorMessage(err) || "Failed to parse multipart theme upload",
              requestId: req.id,
            },
          ],
        });
      }

      if (!fileData) {
        return reply.status(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "No theme ZIP file uploaded",
              requestId: req.id,
            },
          ],
        });
      }

      let zipBuffer: Buffer;
      try {
        zipBuffer = await fileData.toBuffer();
      } catch {
        return reply.status(400).send({
          errors: [
            {
              code: "THEME_UPLOAD_FAILED",
              message: "Failed to read uploaded theme archive buffer",
              requestId: req.id,
            },
          ],
        });
      }

      try {
        const installed = await themeInstaller.installFromZip(
          zipBuffer,
          req.user!.id,
        );

        await auditService.record({
          action: "theme.installed",
          actorUserId: req.user!.id,
          targetType: "theme",
          targetId: installed.themeId,
          metadata: {
            themeId: installed.themeId,
            version: installed.version,
            name: installed.name,
          },
        });

        return reply.status(201).send({
          theme: {
            id: installed.id,
            themeId: installed.themeId,
            name: installed.name,
            version: installed.version,
            themeApiVersion: installed.themeApiVersion,
            description: installed.description,
            author: installed.author,
            previewImage: installed.previewImage,
            manifest: installed.manifest,
            settingsSchema: installed.settingsSchema,
            status: installed.status,
            isBuiltIn: installed.isBuiltIn,
          },
        });
      } catch (err) {
        const e = asCodedError(err);
        return reply.status(400).send({
          errors: [
            {
              code: e.code || "THEME_INSTALL_FAILED",
              message: e.message,
              requestId: req.id,
            },
          ],
        });
      }
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
        const version = typeof (req.body as any)?.version === "string" ? (req.body as any).version : undefined;
        const config = await themeService.activateTheme(id, req.user!.id, version);

        await auditService.record({
          action: "theme.activated",
          actorUserId: req.user!.id,
          targetType: "theme",
          targetId: config.themeId,
          metadata: {
            themeId: config.themeId,
            version: config.themeVersion,
          },
        });

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
          err instanceof ThemeActivationFailedError ||
          err instanceof ThemeSecurityError ||
          err instanceof ThemeZipError
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
        return reply.status(400).send({
          errors: [
            {
              code: e.code || "THEME_ACTIVATION_FAILED",
              message: e.message,
              requestId: req.id,
            },
          ],
        });
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
        const settingsInput =
          typeof parseResult.data.settings === "object" &&
          parseResult.data.settings !== null &&
          !Array.isArray(parseResult.data.settings)
            ? (parseResult.data.settings as Record<string, unknown>)
            : parseResult.data;

        const config = await themeService.updateThemeSettings(
          id,
          settingsInput,
          req.user!.id,
        );

        await auditService.record({
          action: "theme.settings_updated",
          actorUserId: req.user!.id,
          targetType: "theme",
          targetId: config.themeId,
          metadata: {
            themeId: config.themeId,
            settings: config.settings,
          },
        });

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

  // Uninstall / Delete an external theme
  fastify.delete("/themes/:id", {
    preHandler: [
      requireStaffSession,
      requirePermission("themes.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        validateThemeId(id);
        const result = await themeService.uninstallTheme(id, req.user!.id);

        await auditService.record({
          action: "theme.uninstalled",
          actorUserId: req.user!.id,
          targetType: "theme",
          targetId: id,
          metadata: { themeId: id },
        });

        return reply.status(200).send(result);
      } catch (err) {
        if (err instanceof ThemeNotFoundError) {
          return reply.status(404).send({
            errors: [
              { code: err.code, message: err.message, requestId: req.id },
            ],
          });
        }
        const e = asCodedError(err);
        return reply.status(400).send({
          errors: [
            {
              code: e.code || "THEME_UNINSTALL_FAILED",
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

      const theme = await themeService.getTheme(id);
      if (!theme) {
        return reply.status(404).send({
          errors: [
            {
              code: "THEME_NOT_FOUND",
              message: `Theme not found: ${id}`,
              requestId: req.id,
            },
          ],
        });
      }

      const previewInfo = await themeService.createPreviewToken(id);
      return reply.status(200).send(previewInfo);
    },
  });

  // Resolve preview token (public-safe, returns theme id only)
  fastify.get("/themes/preview/:token", {
    handler: async (req, reply) => {
      const { token } = req.params as { token: string };
      const themeId = await themeService.resolvePreviewToken(token);
      if (!themeId) {
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
      return reply.status(200).send({ themeId });
    },
  });
}
