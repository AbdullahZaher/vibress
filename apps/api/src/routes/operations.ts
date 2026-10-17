import { FastifyInstance, FastifyReply, type FastifyRequest } from "fastify";
import {
  requireStaffSession,
  requirePermission,
  validateOrigin,
} from "../middleware/auth";
import {
  settingsService,
  publicationLocaleService,
  workspaceService,
  auditService,
  redirectsService,
  importExportService,
  emailService,
} from "../services";
import {
  getSystemDiagnostics,
  runIntegrityChecks,
  runMaintenanceOperation,
} from "../system-tools";
import { SettingsDomainError, PublicationLocaleError } from "@vibress/settings";
import { RedirectDomainError, type CreateRedirectData } from "@vibress/redirects";
import {
  CreateRedirectInputSchema,
  UpdateRedirectInputSchema,
  UpdatePublicationLocalesSchema,
} from "@vibress/api-contracts";
import {
  ImportExportDomainError,
  validateImportEnvelope,
} from "@vibress/import-export";
import {
  runInTransaction,
  getDb,
  searchDocuments,
  eq,
  and,
  notInArray,
} from "@vibress/database";
import { hashPassword, verifyPassword } from "@vibress/security";
import { getConfig } from "@vibress/config";
import { IMPORT_EXPORT_BODY_LIMIT_BYTES } from "../constants/limits";

type CodedError = Error & { code?: string };

function asCodedError(err: unknown): CodedError {
  if (err instanceof Error) return err as CodedError;
  return new Error(
    typeof err === "string" ? err : "Unknown error",
  ) as CodedError;
}

type AuditListQuery = {
  actorUserId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
};

type ImportExportJobQuery = {
  type?: string;
  status?: string;
  limit?: string;
  offset?: string;
};

type MaintenanceBody = { operation?: string };

const sendError = (
  reply: FastifyReply,
  code: string,
  message: string,
  requestId: string,
  status = 400,
) => reply.status(status).send({ errors: [{ code, message, requestId }] });

async function resolvePublicSettingsPublicationId(
  req: FastifyRequest,
): Promise<string | null> {
  const host = req.hostname || (typeof req.headers.host === "string" ? req.headers.host : null);
  const isDevFallbackAllowed =
    !getConfig().isProduction && req.headers["x-dev-fallback"] !== "false";
  try {
    const context = await workspaceService.resolvePublicPublicationContext({
      host,
      isDevFallbackAllowed,
    });
    return context.publicationId;
  } catch {
    return null;
  }
}

export async function adminOperationsRoutes(fastify: FastifyInstance) {
  // Every authenticated editor needs the publication's language context,
  // even without broad permission to read or change publication settings.
  fastify.get("/locales/context", {
    preHandler: [requireStaffSession],
    handler: async (req, reply) => {
      const config = await publicationLocaleService.getConfiguration(
        req.publicationContext!.publicationId,
      );
      return reply.send({
        primaryLocale: config.primaryLocale,
        enabledLocales: config.enabledLocales,
        isMultilingual: config.isMultilingual,
        needsReconciliation: config.needsReconciliation,
      });
    },
  });

  // ---------------- Publication locales ----------------
  fastify.get("/locales", {
    preHandler: [requireStaffSession, requirePermission("settings.read")],
    handler: async (req, reply) => {
      try {
        const configuration = await publicationLocaleService.getConfiguration(
          req.publicationContext!.publicationId,
        );
        return reply.status(200).send(configuration);
      } catch (error) {
        if (error instanceof PublicationLocaleError) {
          return sendError(
            reply,
            error.code,
            error.message,
            req.id,
            error.code === "PUBLICATION_NOT_FOUND" ? 404 : 409,
          );
        }
        throw error;
      }
    },
  });

  fastify.put("/locales", {
    preHandler: [
      requireStaffSession,
      requirePermission("settings.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const parsed = UpdatePublicationLocalesSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(
          reply,
          "VALIDATION_ERROR",
          "Invalid publication language configuration",
          req.id,
        );
      }
      try {
        const configuration = await runInTransaction(async () => {
          const updated = await publicationLocaleService.updateConfiguration(
            req.publicationContext!.publicationId,
            parsed.data,
            req.user!.id,
          );
          await auditService.record({
            actorUserId: req.user!.id,
            action: "publication.locales.updated",
            targetType: "publication",
            targetId: req.publicationContext!.publicationId,
            metadata: { enabledLocaleCount: updated.enabledLocales.length },
          });
          return updated;
        });

        // Defense in depth: purge search documents for any locales that were disabled
        if (configuration.enabledLocales.length > 0) {
          const db = getDb();
          await db
            .delete(searchDocuments)
            .where(
              and(
                eq(searchDocuments.publicationId, req.publicationContext!.publicationId),
                notInArray(searchDocuments.locale, configuration.enabledLocales),
              ),
            );
        }

        return reply.status(200).send(configuration);
      } catch (error) {
        if (error instanceof PublicationLocaleError) {
          return sendError(
            reply,
            error.code,
            error.message,
            req.id,
            error.code === "PUBLICATION_NOT_FOUND"
              ? 404
              : error.code === "INVALID_LOCALE_CONFIGURATION"
                ? 400
                : 409,
          );
        }
        throw error;
      }
    },
  });

  // ---------------- Settings ----------------
  fastify.get("/settings", {
    preHandler: [requireStaffSession, requirePermission("settings.read")],
    handler: async (req, reply) => {
      const settings = await settingsService.getStaffSettings(
        req.publicationContext!.publicationId,
      );
      return reply
        .status(200)
        .send({
          namespaces: settings,
          available: settingsService.listNamespaces(),
        });
    },
  });

  fastify.put("/settings/:namespace/:key", {
    preHandler: [
      requireStaffSession,
      requirePermission("settings.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { namespace, key } = req.params as {
        namespace: string;
        key: string;
      };
      const body = req.body as { value?: unknown } | undefined;
      if (!body || !("value" in body))
        return sendError(
          reply,
          "VALIDATION_ERROR",
          "value is required",
          req.id,
        );
      try {
        if (namespace === "code") {
          // Code injection can execute arbitrary JS on public pages — strictly require Owner or Administrator role
          const roleList = (req.roles || []) as unknown as Array<
            { key: string } | string
          >;
          const isPrivilegedAdmin = roleList.some(
            (r) =>
              (typeof r === "string" ? r : r.key) === "owner" ||
              (typeof r === "string" ? r : r.key) === "administrator",
          );
          if (!isPrivilegedAdmin) {
            return sendError(
              reply,
              "FORBIDDEN",
              "Code injection requires Administrator or Owner role",
              req.id,
              403,
            );
          }
        }

        if (namespace === "security" && key === "password") {
          const pass = String(body.value || "");
          if (pass.length > 0) {
            if (pass.length < 6) {
              return sendError(
                reply,
                "VALIDATION_ERROR",
                "Password must be at least 6 characters",
                req.id,
              );
            }
            const hash = await hashPassword(pass);
            await settingsService.updateSetting(
              "security",
              "passwordHash",
              hash,
              req.user!.id,
              req.publicationContext!.publicationId,
            );
          }
          return reply
            .status(200)
            .send({
              setting: {
                namespace: "security",
                key: "password",
                value: "••••••••",
                classification: "secret",
              },
            });
        }

        const record = await settingsService.updateSetting(
          namespace,
          key,
          body.value,
          req.user!.id,
          req.publicationContext!.publicationId,
        );
        return reply
          .status(200)
          .send({
            setting: {
              namespace,
              key,
              value: settingsService.maskForStaff(
                record.value,
                record.classification,
              ),
              classification: record.classification,
            },
          });
      } catch (err) {
        if (err instanceof PublicationLocaleError) {
          return sendError(
            reply,
            err.code,
            err.message,
            req.id,
            err.code === "PUBLICATION_NOT_FOUND"
              ? 404
              : err.code === "INVALID_LOCALE_CONFIGURATION"
                ? 400
                : 409,
          );
        }
        if (err instanceof SettingsDomainError) {
          return sendError(
            reply,
            err.code,
            err.message,
            req.id,
            err.code === "UNKNOWN_NAMESPACE" || err.code === "UNKNOWN_SETTING"
              ? 404
              : err.code === "LOCALE_CONFIGURATION_REQUIRED"
                ? 409
                : 400,
          );
        }
        throw err;
      }
    },
  });

  fastify.get("/settings/public", {
    handler: async (req, reply) => {
      const publicationId = await resolvePublicSettingsPublicationId(req);
      if (!publicationId)
        return sendError(reply, "PUBLICATION_NOT_FOUND", "Publication not found", req.id, 404);
      const settings = await settingsService.getPublicSettings(publicationId);
      return reply.status(200).send({ settings });
    },
  });

  fastify.post("/settings/verify-site-password", {
    handler: async (req, reply) => {
      const body = req.body as { password?: string } | undefined;
      if (!body || !body.password) {
        return sendError(
          reply,
          "VALIDATION_ERROR",
          "Password is required",
          req.id,
        );
      }
      const publicationId = await resolvePublicSettingsPublicationId(req);
      if (!publicationId)
        return sendError(reply, "PUBLICATION_NOT_FOUND", "Publication not found", req.id, 404);
      const publicSettings = await settingsService.getPublicSettings(publicationId);
      const isPrivate = Boolean(publicSettings.security?.isPrivate);
      if (!isPrivate) {
        return reply.status(200).send({ valid: true, private: false });
      }
      const securitySettings = await settingsService.getRawSettings(
        "security",
        publicationId,
      );
      if (!securitySettings.passwordHash) {
        return reply.status(200).send({ valid: true, private: false });
      }
      const valid = await verifyPassword(String(securitySettings.passwordHash), body.password);
      return reply.status(valid ? 200 : 401).send({ valid, private: true });
    },
  });

  fastify.post("/settings/test-smtp", {
    preHandler: [
      requireStaffSession,
      requirePermission("settings.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const body = req.body as
        { to?: string; targetEmail?: string } | undefined;
      const recipient =
        body?.targetEmail || body?.to || req.user?.email || "admin@vibress.org";
      try {
        const staffSettings = await settingsService.getStaffSettings(
          req.publicationContext!.publicationId,
        );
        const emailNs = staffSettings.find((n) => n.namespace === "email");
        const fromName = String(
          emailNs?.settings.find((s) => s.key === "fromName")?.value ||
            "Vibress",
        );
        const fromEmail = String(
          emailNs?.settings.find((s) => s.key === "fromEmail")?.value ||
            "noreply@vibress.org",
        );

        const result = await emailService.sendDirect({
          to: recipient,
          toName: "Admin",
          from: fromEmail || "noreply@vibress.org",
          fromName: fromName || "Vibress",
          replyTo: fromEmail || "noreply@vibress.org",
          subject: "Vibress SMTP Test Delivery",
          html: "<h1>Vibress SMTP Delivery Successful</h1><p>Your mail server credentials and configuration are operating properly.</p>",
          text: "Vibress SMTP Delivery Successful. Your mail server credentials are operating properly.",
        });
        return reply
          .status(200)
          .send({ success: true, messageId: result.messageId });
      } catch (err: unknown) {
        if (!getConfig().isProduction) {
          return reply
            .status(200)
            .send({
              success: true,
              simulated: true,
              note: "Mail delivery simulated (dev/test environment)",
            });
        }
        const msg =
          err instanceof Error ? err.message : "SMTP delivery test failed";
        return sendError(reply, "SMTP_TEST_FAILED", msg, req.id, 500);
      }
    },
  });

  // ---------------- Audit explorer ----------------
  fastify.get("/audit", {
    preHandler: [requireStaffSession, requirePermission("audit.read")],
    handler: async (req, reply) => {
      const query = (req.query ?? {}) as AuditListQuery;
      const publicationId = req.publicationContext!.publicationId;
      const result = await auditService.list({
        publicationId,
        actorUserId: query.actorUserId,
        action: query.action,
        targetType: query.targetType,
        targetId: query.targetId,
        requestId: query.requestId,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        limit: query.limit ? parseInt(query.limit, 10) : 50,
        offset: query.offset ? parseInt(query.offset, 10) : 0,
      });
      return reply.status(200).send({
        events: result.events.map((e) => ({
          id: e.id,
          publicationId: e.publicationId,
          actorUserId: e.actorUserId,
          action: e.action,
          targetType: e.targetType,
          targetId: e.targetId,
          requestId: e.requestId,
          metadata: e.metadata,
          createdAt: e.createdAt.toISOString(),
        })),
        total: result.total,
      });
    },
  });

  // ---------------- Redirects ----------------
  fastify.get("/redirects", {
    preHandler: [requireStaffSession, requirePermission("redirects.read")],
    handler: async (req, reply) => {
      const redirects = await redirectsService.listRedirects(req.publicationContext!.publicationId);
      return reply.status(200).send({ redirects });
    },
  });

  fastify.post("/redirects", {
    preHandler: [
      requireStaffSession,
      requirePermission("redirects.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const parsed = CreateRedirectInputSchema.safeParse(req.body);
      if (!parsed.success) {
        // Preserve the established domain error code for unsupported status
        // values while rejecting them at the shared-schema boundary.
        const invalidStatusCode = parsed.error.issues.every(
          (issue) => issue.path[0] === "statusCode",
        );
        return sendError(
          reply,
          invalidStatusCode ? "INVALID_STATUS_CODE" : "VALIDATION_ERROR",
          invalidStatusCode
            ? "Only 301, 302, 307, and 308 are allowed"
            : "Invalid redirect input",
          req.id,
        );
      }
      const body = parsed.data;
      try {
        const redirect = await redirectsService.createRedirect(
          {
            source: body.source,
            destination: body.destination,
            statusCode: body.statusCode,
            enabled: body.enabled,
          },
          req.user!.id,
          req.publicationContext!.publicationId,
        );
        return reply.status(201).send({ redirect });
      } catch (err) {
        if (err instanceof RedirectDomainError)
          return sendError(reply, err.code, err.message, req.id, 400);
        throw err;
      }
    },
  });

  fastify.patch("/redirects/:id", {
    preHandler: [
      requireStaffSession,
      requirePermission("redirects.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = UpdateRedirectInputSchema.safeParse(req.body);
      if (!parsed.success) {
        // Preserve the established domain error code for unsupported status
        // values while rejecting them at the shared-schema boundary.
        const invalidStatusCode = parsed.error.issues.every(
          (issue) => issue.path[0] === "statusCode",
        );
        return sendError(
          reply,
          invalidStatusCode ? "INVALID_STATUS_CODE" : "VALIDATION_ERROR",
          invalidStatusCode
            ? "Only 301, 302, 307, and 308 are allowed"
            : "Invalid redirect input",
          req.id,
        );
      }
      // Zod's partial input permits explicit undefined, but the domain
      // update contract only accepts fields with concrete values.
      const updates: Partial<CreateRedirectData> = {};
      if (parsed.data.source !== undefined) updates.source = parsed.data.source;
      if (parsed.data.destination !== undefined)
        updates.destination = parsed.data.destination;
      if (parsed.data.statusCode !== undefined)
        updates.statusCode = parsed.data.statusCode;
      if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled;
      if (parsed.data.sortOrder !== undefined)
        updates.sortOrder = parsed.data.sortOrder;
      try {
        const redirect = await redirectsService.updateRedirect(
          id,
          updates,
          req.user!.id,
          req.publicationContext!.publicationId,
        );
        return reply.status(200).send({ redirect });
      } catch (err) {
        if (err instanceof RedirectDomainError) {
          return sendError(
            reply,
            err.code,
            err.message,
            req.id,
            err.code === "REDIRECT_NOT_FOUND" ? 404 : 400,
          );
        }
        throw err;
      }
    },
  });

  fastify.delete("/redirects/:id", {
    preHandler: [
      requireStaffSession,
      requirePermission("redirects.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      await redirectsService.deleteRedirect(id, req.user!.id, req.publicationContext!.publicationId);
      return reply.status(200).send({ success: true });
    },
  });

  // ---------------- Import / Export ----------------
  fastify.post("/imports/validate", {
    bodyLimit: IMPORT_EXPORT_BODY_LIMIT_BYTES,
    preHandler: [
      requireStaffSession,
      requirePermission("imports.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const body = req.body as unknown;
      const raw = typeof body === "string" ? JSON.parse(body) : body;
      try {
        const result = validateImportEnvelope(raw);
        return reply
          .status(200)
          .send({
            valid: true,
            format: result.format,
            version: result.version,
          });
      } catch (err) {
        if (err instanceof ImportExportDomainError) {
          return reply
            .status(400)
            .send({
              valid: false,
              errors: [{ code: err.code, message: err.message }],
            });
        }
        throw err;
      }
    },
  });

  fastify.post("/imports", {
    bodyLimit: IMPORT_EXPORT_BODY_LIMIT_BYTES,
    preHandler: [
      requireStaffSession,
      requirePermission("imports.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      // Body size bound at the HTTP layer; envelope validated here
      const body = req.body as unknown;
      const raw = typeof body === "string" ? JSON.parse(body) : body;
      try {
        validateImportEnvelope(raw);
      } catch (err) {
        if (err instanceof ImportExportDomainError)
          return sendError(reply, err.code, err.message, req.id, 400);
        throw err;
      }
      const publicationId = req.publicationContext!.publicationId;
      const job = await importExportService.createImportJob(req.user!.id, publicationId);
      // Process synchronously in v1 (bounded, small data); stored in job record
      try {
        await importExportService.runImport(job.id, raw, publicationId);
      } catch {
        // Job marked failed; still report 202 with the job id
      }
      const finalJob = await importExportService.getJob(job.id, publicationId);
      return reply.status(202).send({ job: finalJob });
    },
  });

  fastify.post("/exports", {
    preHandler: [
      requireStaffSession,
      requirePermission("exports.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const publicationId = req.publicationContext!.publicationId;
      const job = await importExportService.createExportJob(req.user!.id, publicationId);
      try {
        await importExportService.runExport(job.id, publicationId);
      } catch {
        // Job marked failed; report job id
      }
      const finalJob = await importExportService.getJob(job.id, publicationId);
      return reply.status(202).send({ job: finalJob });
    },
  });

  fastify.get("/import-export-jobs", {
    preHandler: [requireStaffSession, requirePermission("exports.manage")],
    handler: async (req, reply) => {
      const query = (req.query ?? {}) as ImportExportJobQuery;
      const params: {
        publicationId: string;
        type?: string;
        status?: string;
        limit?: number;
        offset?: number;
      } = {
        publicationId: req.publicationContext!.publicationId,
        limit: query.limit ? parseInt(query.limit, 10) : 20,
        offset: query.offset ? parseInt(query.offset, 10) : 0,
      };
      if (query.type) params.type = query.type;
      if (query.status) params.status = query.status;
      const result = await importExportService.listJobs(params);
      return reply.status(200).send(result);
    },
  });

  fastify.get("/import-export-jobs/:id/artifact", {
    preHandler: [requireStaffSession, requirePermission("exports.manage")],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const publicationId = req.publicationContext!.publicationId;
      const job = await importExportService.getJob(id, publicationId);
      if (!job || job.status !== "completed" || !job.artifactKey) {
        return sendError(
          reply,
          "ARTIFACT_NOT_AVAILABLE",
          "Artifact not available",
          req.id,
          404,
        );
      }
      if (
        job.artifactExpiresAt &&
        job.artifactExpiresAt.getTime() < Date.now()
      ) {
        return sendError(
          reply,
          "ARTIFACT_EXPIRED",
          "Artifact has expired",
          req.id,
          410,
        );
      }
      // Artifact is stored as the envelope itself for v1; regenerate via the collector
      const { NativeExportCollector } =
        await import("../import-export-processors");
      const collector = new NativeExportCollector({
        settingsService,
        redirectsService,
      });
      const data = await collector.collect(publicationId);
      const envelope = {
        format: "vibress",
        version: 1,
        exportedAt: new Date().toISOString(),
        data,
      };
      return reply.status(200).send(envelope);
    },
  });

  // ---------------- System tools ----------------
  fastify.get("/system/diagnostics", {
    preHandler: [requireStaffSession, requirePermission("system.read")],
    handler: async (_req, reply) => {
      const diagnostics = await getSystemDiagnostics();
      return reply.status(200).send({ diagnostics });
    },
  });

  fastify.post("/system/maintenance", {
    preHandler: [
      requireStaffSession,
      requirePermission("system.manage"),
      validateOrigin,
    ],
    handler: async (req, reply) => {
      const body = req.body as MaintenanceBody | undefined;
      if (!body?.operation)
        return sendError(
          reply,
          "VALIDATION_ERROR",
          "operation is required",
          req.id,
        );
      try {
        const result = await runMaintenanceOperation(
          body.operation,
          req.user!.id,
        );
        return reply.status(200).send(result);
      } catch (err) {
        return sendError(
          reply,
          "UNKNOWN_OPERATION",
          asCodedError(err).message,
          req.id,
          400,
        );
      }
    },
  });

  fastify.get("/system/integrity", {
    preHandler: [requireStaffSession, requirePermission("system.read")],
    handler: async (_req, reply) => {
      const results = await runIntegrityChecks();
      return reply.status(200).send({ checks: results });
    },
  });
}
