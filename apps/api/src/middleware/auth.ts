import { FastifyRequest, FastifyReply } from "fastify";
import { authService, workspaceService } from "../services";
import { hasPermission, PublicationAccessDeniedError } from "@vibress/security";
import { TenantAccessDeniedError } from "@vibress/workspaces";
import { getConfig } from "@vibress/config";

export const COOKIE_NAME = getConfig().cookies.staffSessionName;

export function extractSessionToken(req: FastifyRequest): string | null {
  if (req.cookies && req.cookies[COOKIE_NAME]) {
    return req.cookies[COOKIE_NAME] as string;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7).trim();
  }
  return null;
}

export async function requireStaffSession(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  if (!req.user || !req.permissions) {
    const token = extractSessionToken(req);
    if (!token) {
      return reply.status(401).send({
        errors: [
          {
            code: "AUTHENTICATION_REQUIRED",
            message: "Authentication required",
            requestId: req.id,
          },
        ],
      });
    }

    const sessionContext = await authService.resolveSession(token);
    if (!sessionContext) {
      return reply.status(401).send({
        errors: [
          {
            code: "AUTHENTICATION_REQUIRED",
            message: "Session is invalid or expired",
            requestId: req.id,
          },
        ],
      });
    }

    req.user = sessionContext.user;
    req.roles = sessionContext.roles;
    req.permissions = sessionContext.permissions;
    req.sessionToken = token;
  }

  if (!req.publicationContext) {
    const requestedPubId = (req.headers["x-publication-id"] as string) || undefined;
    try {
      const pubCtx = await workspaceService.resolveStaffPublicationContext(
        req.user.id,
        requestedPubId,
        req.roles,
      );
      req.publicationContext = {
        publicationId: pubCtx.publicationId,
        workspaceId: pubCtx.workspaceId,
        actorId: pubCtx.actorId,
        actorType: pubCtx.actorType,
        role: pubCtx.role,
        isSystemOperation: pubCtx.isSystemOperation,
      };
    } catch (err: any) {
      if (
        err instanceof TenantAccessDeniedError ||
        err instanceof PublicationAccessDeniedError ||
        err?.name === "TenantAccessDeniedError" ||
        err?.name === "PublicationAccessDeniedError"
      ) {
        return reply.status(403).send({
          errors: [
            {
              code: "PUBLICATION_ACCESS_DENIED",
              message: err.message || "Access to requested publication is denied",
              requestId: req.id,
            },
          ],
        });
      }
      throw err;
    }
  }
}

export function requirePermission(permissionKey: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user || !req.roles || !req.permissions) {
      return reply.status(401).send({
        errors: [
          {
            code: "AUTHENTICATION_REQUIRED",
            message: "Authentication required",
            requestId: req.id,
          },
        ],
      });
    }

    const authorized = hasPermission(req.permissions, permissionKey, req.roles);
    if (!authorized) {
      return reply.status(403).send({
        errors: [
          {
            code: "PERMISSION_DENIED",
            message: `Permission denied: ${permissionKey} required`,
            requestId: req.id,
          },
        ],
      });
    }
  };
}

export async function validateOrigin(req: FastifyRequest, reply: FastifyReply) {
  // Only check state-changing HTTP methods
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return;
  }

  // If request has cookie authentication, check Origin or Referer header
  const tokenInCookie = req.cookies && req.cookies[COOKIE_NAME];
  if (!tokenInCookie) {
    // If bearer auth, skip origin check
    return;
  }

  const origin =
    req.headers.origin ||
    (req.headers.referer ? new URL(req.headers.referer).origin : null);
  const allowedOrigins = getConfig().cors.staffAllowedOrigins;

  if (!origin || !allowedOrigins.includes(origin)) {
    return reply.status(403).send({
      errors: [
        {
          code: "INVALID_ORIGIN",
          message: "Invalid request origin",
          requestId: req.id,
        },
      ],
    });
  }
}
