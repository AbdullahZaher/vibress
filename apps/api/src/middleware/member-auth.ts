import { FastifyRequest, FastifyReply } from 'fastify';
import { memberAuthService } from '../services';
import { Member } from '@vibress/members';
import { getConfig } from '@vibress/config';

export const MEMBER_COOKIE_NAME = getConfig().cookies.memberSessionName;

export function extractMemberSessionToken(req: FastifyRequest): string | null {
  if (req.cookies && req.cookies[MEMBER_COOKIE_NAME]) {
    return req.cookies[MEMBER_COOKIE_NAME] as string;
  }
  return null;
}

export async function requireMemberSession(req: FastifyRequest, reply: FastifyReply) {
  const token = extractMemberSessionToken(req);
  if (!token) {
    return reply.status(401).send({
      errors: [
        {
          code: 'MEMBER_AUTH_REQUIRED',
          message: 'Member authentication required',
          requestId: req.id,
        },
      ],
    });
  }

  const member = await memberAuthService.resolveSession(token);
  if (!member) {
    return reply.status(401).send({
      errors: [
        {
          code: 'MEMBER_AUTH_REQUIRED',
          message: 'Member session is invalid or expired',
          requestId: req.id,
        },
      ],
    });
  }

  req.member = member;
  req.memberSessionToken = token;
}

export async function validateMemberOrigin(req: FastifyRequest, reply: FastifyReply) {
  // Only check state-changing methods with cookie auth.
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return;
  }

  const tokenInCookie = req.cookies && req.cookies[MEMBER_COOKIE_NAME];
  if (!tokenInCookie) return;

  const origin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : null);
  const allowedOrigins = getConfig().cors.memberAllowedOrigins;

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
