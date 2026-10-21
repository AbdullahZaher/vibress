import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  ExtensionAdminNavigationParamsSchema,
  ExtensionAdminFrameTicketQuerySchema,
  ExtensionAdminFrameTicketResponseSchema,
} from "@vibress/api-contracts";
import { PluginDomainError } from "@vibress/plugins";
import { requireStaffSession, validateOrigin, COOKIE_NAME } from "../middleware/auth";
import { authService, pluginsService, workspaceService } from "../services";
import { admitAdminViews } from "../plugins/admin-view-registry";
import { canAccessExtensionAdminRoute } from "../plugins/admin-view-permissions";
import { adminUiFrameTickets, sessionFingerprint } from "../plugins/admin-ui-frame-tickets";

const MAX_HTML_BYTES = 256 * 1024;
const FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "script-src-attr 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "connect-src 'none'",
  "font-src 'none'",
  "media-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
  // Always an opaque origin, including when the URL is opened in a top-level tab.
  "sandbox allow-scripts",
].join("; ");

function reject(req: FastifyRequest, reply: FastifyReply, code: string, status: number) {
  return reply.code(status).send({
    errors: [{ code, message: code.toLowerCase().replaceAll("_", " "), requestId: req.id }],
  });
}

function denyOnPluginTransition(error: unknown): number {
  return error instanceof PluginDomainError &&
    (error.code === "PLUGIN_PUBLICATION_INACTIVE" || error.code === "PLUGIN_INACTIVE") ? 404 : 503;
}

/**
 * No authorization is inherited from the sidebar, iframe ticket or operator
 * lockfile. Every request must pass the original Host publication-scoped
 * module/view/permission admission and a fresh verified asset read.
 */
async function authorizedHtml(
  pluginId: string, viewId: string, publicationId: string,
  roles: readonly string[], permissions: readonly string[], localRole: string | null | undefined,
): Promise<
  | { html: string; sha256: string }
  | { denied: number; code: string }
> {
  const module = await pluginsService.resolveExtensionApiModule(
    pluginId, publicationId, "extension.routes.admin",
  );
  if (!module) return { denied: 404, code: "EXTENSION_UI_NOT_FOUND" };
  const views = admitAdminViews(module);
  if (!views) return { denied: 503, code: "EXTENSION_INVALID_ADMIN_VIEWS" };
  const view = views.find((item) => item.viewId === viewId);
  if (!view) return { denied: 404, code: "EXTENSION_UI_NOT_FOUND" };
  if (!canAccessExtensionAdminRoute(permissions, roles, localRole, view.permission)) {
    return { denied: 403, code: "PERMISSION_DENIED" };
  }
  const html = await pluginsService.readExtensionAdminUiAsset(pluginId, publicationId, viewId);
  if (html === null) return { denied: 404, code: "EXTENSION_UI_NOT_FOUND" };
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    return { denied: 503, code: "EXTENSION_INVALID_UI" };
  }
  return { html, sha256: createHash("sha256").update(html, "utf8").digest("hex") };
}

export async function adminExtensionFrameRoutes(fastify: FastifyInstance) {
  // This endpoint alone issues a ticket, and only after Staff auth and Origin.
  // No arbitrary iframe URL or permission comes from an extension.
  fastify.post("/extensions/:pluginId/views/:viewId/frame-ticket", {
    preHandler: [requireStaffSession, validateOrigin],
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    handler: async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      reply.header("Referrer-Policy", "no-referrer");
      const params = ExtensionAdminNavigationParamsSchema.safeParse(req.params);
      if (!params.success) return reject(req, reply, "VALIDATION_ERROR", 400);
      const publicationId = req.publicationContext?.publicationId;
      if (!publicationId || !req.user || !req.roles || !req.permissions) {
        return reject(req, reply, "PUBLICATION_ACCESS_DENIED", 403);
      }
      const sessionToken = req.cookies?.[COOKIE_NAME];
      // A ticket for an embedded page is cookie-session only. Bearer tokens
      // must not be serialized into, or bridged to, browser plugin contexts.
      if (!sessionToken || typeof sessionToken !== "string") {
        return reject(req, reply, "AUTHENTICATION_REQUIRED", 401);
      }

      try {
        const { pluginId, viewId } = params.data;
        const admitted = await authorizedHtml(
          pluginId, viewId, publicationId, req.roles, req.permissions, req.publicationContext?.role,
        );
        if ("denied" in admitted) return reject(req, reply, admitted.code, admitted.denied);
        const ticket = await adminUiFrameTickets.issue({
          staffId: req.user.id,
          sessionHash: sessionFingerprint(sessionToken),
          publicationId, pluginId, viewId, sha256: admitted.sha256,
        });
        // Opaque ticket expires in 45s and is consumed once in Redis. This URL
        // is constructed by Host, never loaded from plugin-controlled metadata.
        const src = `/api/admin/v1/extensions/${pluginId}/views/${viewId}/frame?ticket=${ticket}`;
        const response = ExtensionAdminFrameTicketResponseSchema.safeParse({ src });
        if (!response.success) return reject(req, reply, "EXTENSION_INVALID_UI", 503);
        return reply.code(200).send(response.data);
      } catch (error) {
        return reject(req, reply, "EXTENSION_UNAVAILABLE", denyOnPluginTransition(error));
      }
    },
  });

  // A navigation cannot send the Admin's active-publication header. Resolve
  // the publication from a one-time, Staff-session-bound server ticket,
  // and re-authorize it against the live membership on this GET.
  fastify.get("/extensions/:pluginId/views/:viewId/frame", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async (req, reply) => {
      reply.header("Cache-Control", "private, no-store");
      reply.header("Referrer-Policy", "no-referrer");
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Cross-Origin-Resource-Policy", "same-origin");
      // Browser frame GETs must originate from an embedding page in this
      // site's Admin shell, not a direct top-level navigation or cross-site
      // page. Older agents without Fetch Metadata still require a one-use,
      // Staff-bound ticket; frame-ancestors and XFO also block third parties.
      const fetchSite = req.headers["sec-fetch-site"];
      if (fetchSite === "cross-site" || fetchSite === "none") {
        return reject(req, reply, "EXTENSION_UI_NOT_FOUND", 404);
      }
      const params = ExtensionAdminNavigationParamsSchema.safeParse(req.params);
      const query = ExtensionAdminFrameTicketQuerySchema.safeParse(req.query);
      if (!params.success || !query.success) return reject(req, reply, "VALIDATION_ERROR", 400);
      let claim;
      try {
        claim = await adminUiFrameTickets.consume(query.data.ticket);
      } catch {
        return reject(req, reply, "EXTENSION_UNAVAILABLE", 503);
      }
      if (!claim || claim.pluginId !== params.data.pluginId ||
          claim.viewId !== params.data.viewId) {
        return reject(req, reply, "EXTENSION_UI_NOT_FOUND", 404);
      }
      // Sandboxed opaque-origin navigations may not send SameSite=Lax
      // Staff cookies. A one-use ticket proves the earlier authenticated,
      // Origin-checked issuance; server-only session hash lookup verifies
      // that this exact Staff session is STILL active, without serializing
      // cookies or bearer tokens into extension code.
      const cookieToken = req.cookies?.[COOKIE_NAME];
      if (typeof cookieToken === "string" &&
          sessionFingerprint(cookieToken) !== claim.sessionHash) {
        return reject(req, reply, "AUTHENTICATION_REQUIRED", 401);
      }

      try {
        const session = await authService.resolveSessionByTokenHash(claim.sessionHash);
        if (!session || session.user.id !== claim.staffId) {
          return reject(req, reply, "AUTHENTICATION_REQUIRED", 401);
        }
        const context = await workspaceService.resolveStaffPublicationContext(
          session.user.id, claim.publicationId, session.roles,
        );
        if (context.publicationId !== claim.publicationId) {
          return reject(req, reply, "PUBLICATION_ACCESS_DENIED", 403);
        }
        const admitted = await authorizedHtml(
          claim.pluginId, claim.viewId, claim.publicationId,
          session.roles, session.permissions, context.role,
        );
        if ("denied" in admitted) return reject(req, reply, admitted.code, admitted.denied);
        // Prevent showing a stale artifact when a version changed after the
        // ticket was issued (even on a different API replica).
        if (admitted.sha256 !== claim.sha256) {
          return reject(req, reply, "EXTENSION_UI_NOT_FOUND", 404);
        }
        reply.header("Content-Type", "text/html; charset=utf-8");
        reply.header("Content-Security-Policy", FRAME_CSP);
        reply.header("X-Frame-Options", "SAMEORIGIN");
        reply.header("Permissions-Policy",
          "camera=(), microphone=(), geolocation=(), payment=(), clipboard-read=(), clipboard-write=()");
        return reply.code(200).send(admitted.html);
      } catch (error) {
        return reject(req, reply, "EXTENSION_UNAVAILABLE", denyOnPluginTransition(error));
      }
    },
  });
}
