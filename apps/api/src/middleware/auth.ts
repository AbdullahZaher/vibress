import { FastifyRequest, FastifyReply } from 'fastify';
import { authService } from '../services';
import { hasPermission } from '@vibress/security';

export const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'vibress_session';

export function extractSessionToken(req: FastifyRequest): string | null {
  if (req.cookies && req.cookies[COOKIE_NAME]) {
    return req.cookies[COOKIE_NAME] as string;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  return null;
}

export async function requireStaffSession(req: FastifyRequest, reply: FastifyReply) {
  const token = extractSessionToken(req);
  if (!token) {
    return reply.status(401).send({
      errors: [
        {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required',
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
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Session is invalid or expired',
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

export function requirePermission(permissionKey: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user || !req.roles || !req.permissions) {
      return reply.status(401).send({
        errors: [
          {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required',
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
            code: 'PERMISSION_DENIED',
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
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return;
  }

  // If request has cookie authentication, check Origin or Referer header
  const tokenInCookie = req.cookies && req.cookies[COOKIE_NAME];
  if (!tokenInCookie) {
    // If bearer auth, skip origin check
    return;
  }

  const origin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : null);
  const allowedOrigins = [
    'http://localhost:7777',
    'http://localhost:7780',
    'http://127.0.0.1:7777',
    'http://127.0.0.1:7780',
    process.env.ADMIN_ORIGIN,
  ].filter(Boolean);

  if (!origin || !allowedOrigins.includes(origin)) {
    return reply.status(403).send({
      errors: [
        {
          code: 'INVALID_ORIGIN',
          message: 'Invalid request origin',
          requestId: req.id,
        },
      ],
    });
  }
}
