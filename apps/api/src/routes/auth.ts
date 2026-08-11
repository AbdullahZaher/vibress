import { FastifyInstance } from 'fastify';
import { LoginRequestSchema } from '@vibress/api-contracts';
import { authService } from '../services';
import { requireStaffSession, validateOrigin, COOKIE_NAME } from '../middleware/auth';
import { getConfig } from '@vibress/config';
import { AuthDomainError } from '@vibress/auth';

export async function authRoutes(fastify: FastifyInstance) {
  // Login
  fastify.post('/login', {
    config: {
      rateLimit: {
        max: getConfig().isProduction ? 5 : 1000,
        timeWindow: '1 minute',
      },
    },
    preHandler: [validateOrigin],
    handler: async (req, reply) => {
      const parseResult = LoginRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [
            {
              code: 'VALIDATION_ERROR',
              message: parseResult.error.errors[0]?.message || 'Invalid login request payload',
              requestId: req.id,
            },
          ],
        });
      }

      const { email, password } = parseResult.data;
      const ipAddress = req.ip;
      const userAgent = req.headers['user-agent'] || null;

      try {
        const result = await authService.loginStaff(email, password, {
          ipAddress,
          userAgent,
          requestId: req.id,
        });

        const isProduction = getConfig().isProduction;
        reply.setCookie(COOKIE_NAME, result.sessionToken, {
          path: '/',
          httpOnly: true,
          secure: isProduction,
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
        });

        return reply.status(200).send({
          user: {
            id: result.user.id,
            email: result.user.email,
            name: result.user.name,
            slug: result.user.slug ?? null,
            status: result.user.status,
            roles: result.roles,
            permissions: result.permissions,
          },
        });
      } catch (err: unknown) {
        if (err instanceof AuthDomainError && err.code === 'INVALID_CREDENTIALS') {
          return reply.status(401).send({
            errors: [
              {
                code: 'INVALID_CREDENTIALS',
                message: 'Invalid credentials',
                requestId: req.id,
              },
            ],
          });
        }
        throw err;
      }
    },
  });

  // Logout
  fastify.post('/logout', {
    preHandler: [validateOrigin],
    handler: async (req, reply) => {
      const cookieToken = req.cookies[COOKIE_NAME];
      if (cookieToken) {
        await authService.logoutStaff(cookieToken, {
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'] || null,
          requestId: req.id,
        });
      }

      reply.clearCookie(COOKIE_NAME, { path: '/' });
      return reply.status(200).send({ success: true });
    },
  });

  // Get current user details
  fastify.get('/me', {
    preHandler: [requireStaffSession],
    handler: async (req, reply) => {
      return reply.status(200).send({
        user: {
          id: req.user!.id,
          email: req.user!.email,
          name: req.user!.name,
          slug: req.user!.slug ?? null,
          status: req.user!.status,
          roles: req.roles || [],
          permissions: req.permissions || [],
        },
      });
    },
  });
}
