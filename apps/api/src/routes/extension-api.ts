import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { PluginApiAudience, PluginApiRoute, PluginApiScope, PluginModule } from "@vibress/plugin-sdk";
import {
  ExtensionApiRouteParamsSchema,
  ExtensionApiRouteSchema,
  validateExtensionApiObject,
} from "@vibress/api-contracts";
import { hasPermission, SITE_AUTH_COOKIE_NAME, verifySiteAuthToken } from "@vibress/security";
import { getConfig } from "@vibress/config";
import { PluginDomainError } from "@vibress/plugins";
import { requireStaffSession, validateOrigin } from "../middleware/auth";
import { requireMemberSession, validateMemberOrigin } from "../middleware/member-auth";
import { pluginsService, workspaceService, settingsService } from "../services";

/** No arbitrary Fastify registration or tenant selectors from plugin modules. */
const MAX_ROUTES_PER_PLUGIN = 32;
const EXTENSION_ROUTE = "/extensions/:pluginId/v1/:routeId";

function reject(reply: FastifyReply, req: FastifyRequest, code: string, status: number) {
  return reply.status(status).send({
    errors: [{ code, message: code.replaceAll("_", " ").toLowerCase(), requestId: req.id }],
  });
}

function admittedRoutes(routes: readonly PluginApiRoute[] | undefined):
  ReadonlyArray<PluginApiRoute> | null {
  if (!Array.isArray(routes) || routes.length > MAX_ROUTES_PER_PLUGIN) return null;
  const registered = new Set<string>();
  for (const route of routes) {
    if (!route || typeof route.handle !== "function") return null;
    const descriptor = ExtensionApiRouteSchema.safeParse({
      id: route.id,
      audience: route.audience,
      method: route.method,
      permission: route.permission,
      query: route.query,
      body: route.body,
      response: route.response,
    });
    if (!descriptor.success) return null;
    const key = `${route.audience}:${route.method}:${route.id}`;
    if (registered.has(key)) return null;
    registered.add(key);
  }
  return routes;
}

/**
 * Member routes are host-bound to the site selected by Host. A Member cookie
 * from publication B NEVER authorizes routes on publication A. This guard is
 * additional to requireMemberSession, not a replacement for it.
 */
async function bindMemberPublication(req: FastifyRequest, reply: FastifyReply) {
  const host = req.hostname || (req.headers.host ?? null);
  const isDevFallbackAllowed =
    !getConfig().isProduction && req.headers["x-dev-fallback"] !== "false";
  let publicationId: string;
  let workspaceId: string;
  try {
    const context = await workspaceService.resolvePublicPublicationContext({
      host, isDevFallbackAllowed,
    });
    publicationId = context.publicationId;
    workspaceId = context.workspaceId;
  } catch {
    return reject(reply, req, "PUBLICATION_NOT_FOUND", 404);
  }
  if (!req.member || req.member.publicationId !== publicationId) {
    return reject(reply, req, "PUBLICATION_NOT_FOUND", 404);
  }
  // Public API's global privacy hook doesn't cover /api/members/v1.
  if (!getConfig().isTest) {
    let privateSite: boolean;
    try {
      const settings = await settingsService.getPublicSettings(publicationId);
      privateSite = Boolean(settings.security?.isPrivate);
    } catch {
      return reject(reply, req, "PRIVACY_STATE_UNAVAILABLE", 503);
    }
    if (privateSite) {
      const cfg = getConfig();
      const secret = cfg.secrets.encryptionKey ||
        process.env.VIBRESS_ENCRYPTION_KEY || "vibress-site-privacy-secret";
      const token = req.cookies?.[SITE_AUTH_COOKIE_NAME];
      if (!verifySiteAuthToken(token, secret, publicationId)) {
        return reject(reply, req, "PRIVATE_SITE_AUTH_REQUIRED", 403);
      }
    }
  }
  req.publicationContext = {
    publicationId, workspaceId, actorType: "member", isSystemOperation: false,
  };
}

function extensionRoutes(fastify: FastifyInstance, audience: PluginApiAudience) {
  const auth = audience === "admin"
    ? [requireStaffSession, validateOrigin]
    : audience === "member"
      ? [requireMemberSession, validateMemberOrigin, bindMemberPublication]
      : [];

  fastify.route({
    method: audience === "public" ? ["GET"] : ["GET", "POST"],
    url: EXTENSION_ROUTE,
    bodyLimit: 64 * 1024,
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    preHandler: auth,
    handler: async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const params = ExtensionApiRouteParamsSchema.safeParse(req.params);
      if (!params.success) return reject(reply, req, "VALIDATION_ERROR", 400);

      // Public requests use the existing main.ts /api/content/v1 privacy and
      // host-resolution hook. Staff and members use their respective guards.
      const publicationId = req.publicationContext?.publicationId;
      if (!publicationId) return reject(reply, req, "PUBLICATION_NOT_FOUND", 404);
      const capability = audience === "admin" ? "extension.routes.admin"
        : audience === "member" ? "extension.routes.member"
          : "extension.routes.public";
      let module: PluginModule | null;
      try {
        module = await pluginsService.resolveExtensionApiModule(
          params.data.pluginId, publicationId, capability,
        );
      } catch (err) {
        if (err instanceof PluginDomainError &&
            (err.code === "PLUGIN_PUBLICATION_INACTIVE" || err.code === "PLUGIN_INACTIVE")) {
          return reject(reply, req, "EXTENSION_ROUTE_NOT_FOUND", 404);
        }
        return reject(reply, req, "EXTENSION_UNAVAILABLE", 503);
      }
      if (!module) return reject(reply, req, "EXTENSION_ROUTE_NOT_FOUND", 404);

      const routes = admittedRoutes(module.routes);
      if (!routes) return reject(reply, req, "EXTENSION_INVALID_ROUTES", 503);
      const route = routes.find((entry) =>
        entry.audience === audience &&
        entry.method === req.method &&
        entry.id === params.data.routeId);
      if (!route) return reject(reply, req, "EXTENSION_ROUTE_NOT_FOUND", 404);

      if (audience === "admin" &&
          (!route.permission || !req.permissions || !req.roles ||
            !hasPermission(req.permissions, route.permission, req.roles))) {
        return reject(reply, req, "PERMISSION_DENIED", 403);
      }

      const query = validateExtensionApiObject(route.query, req.query);
      const body = validateExtensionApiObject(route.body, req.method === "POST" ? req.body ?? {} : {});
      if (!query || !body) return reject(reply, req, "VALIDATION_ERROR", 400);

      const scope: PluginApiScope = {
        publicationId,
        requestId: req.id,
        principal: audience === "admin"
          ? { kind: "staff", id: req.user!.id }
          : audience === "member"
            ? { kind: "member", id: req.member!.id }
            : { kind: "anonymous" },
      };
      try {
        const output = await route.handle({ query, body }, scope);
        const result = validateExtensionApiObject(route.response, output);
        if (!result) return reject(reply, req, "EXTENSION_INVALID_RESPONSE", 503);
        return reply.status(200).send(result);
      } catch {
        // Trusted code exceptions may embed process state, secrets and paths.
        return reject(reply, req, "EXTENSION_HANDLER_FAILED", 503);
      }
    },
  });
}

export async function adminExtensionApiRoutes(fastify: FastifyInstance) {
  extensionRoutes(fastify, "admin");
}

export async function memberExtensionApiRoutes(fastify: FastifyInstance) {
  extensionRoutes(fastify, "member");
}

export async function publicExtensionApiRoutes(fastify: FastifyInstance) {
  extensionRoutes(fastify, "public");
}
