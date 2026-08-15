import crypto from "node:crypto";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getConfig } from "@vibress/config";
import {
  SetupCompleteRequestSchema,
  SETUP_TOKEN_HEADER,
} from "@vibress/api-contracts";
import type {
  SetupCompleteResponse,
  SetupStatusResponse,
} from "@vibress/api-contracts";
import { SetupDomainError, setupTokenMatches } from "@vibress/setup";
import { appLogger } from "../observability";
import { setupService, authService } from "../services";
import { COOKIE_NAME } from "../middleware/auth";

/**
 * Dev-only ephemeral setup token. In production VIBRESS_SETUP_TOKEN is
 * required (config fails closed at boot) and this is never used.
 * The generated token is printed once to stdout, labeled development-only,
 * and is never persisted or re-logged.
 */
let devSetupToken: string | null = null;
let devSetupTokenShown = false;

export function ensureSetupTokenConfigured(): void {
  const config = getConfig();
  if (config.isProduction) return;
  if (config.setup.token) return;
  if (!devSetupToken) {
    devSetupToken = crypto.randomBytes(32).toString("hex");
  }
  if (!devSetupTokenShown) {
    devSetupTokenShown = true;
    console.log(
      "==============================================================",
    );
    console.log(
      "DEVELOPMENT ONLY — First-run setup token (this process only, never persisted):",
    );
    console.log(`  ${devSetupToken}`);
    console.log(
      "In production, set VIBRESS_SETUP_TOKEN in the environment instead.",
    );
    console.log(
      "==============================================================",
    );
  }
}

function getEffectiveSetupToken(): string | null {
  const config = getConfig();
  if (config.setup.token) return config.setup.token;
  return devSetupToken;
}

/** Origin enforcement for the unauthenticated bootstrap surface (always on). */
async function validateSetupOrigin(req: FastifyRequest, reply: FastifyReply) {
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

/**
 * Fast-path state gate: once installed, setup is permanently unavailable and
 * the token is not even evaluated. The authoritative check happens again
 * inside the installation transaction (under the singleton row lock).
 */
async function setupStateGate(req: FastifyRequest, reply: FastifyReply) {
  const { installed } = await setupService.getStatus();
  if (installed) {
    return reply.status(409).send({
      errors: [
        {
          code: "SETUP_ALREADY_COMPLETED",
          message: "Setup has already been completed",
          requestId: req.id,
        },
      ],
    });
  }
}

/** Timing-safe bootstrap authorization via the X-Vibress-Setup-Token header. */
async function requireSetupToken(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers[SETUP_TOKEN_HEADER];
  const configured = getEffectiveSetupToken();
  if (
    typeof header !== "string" ||
    !configured ||
    !setupTokenMatches(header, configured)
  ) {
    appLogger.warn("setup token rejected", {
      requestId: req.id,
      ipAddress: req.ip,
    });
    return reply.status(401).send({
      errors: [
        {
          code: "INVALID_SETUP_TOKEN",
          message: "Invalid setup token",
          requestId: req.id,
        },
      ],
    });
  }
}

export async function setupRoutes(fastify: FastifyInstance) {
  const isProduction = getConfig().isProduction;

  // Public minimal installation state (nothing else — no version, no
  // database/infrastructure details, no owner information).
  fastify.get("/status", {
    handler: async (_req, reply) => {
      const status = await setupService.getStatus();
      const response: SetupStatusResponse = { installed: status.installed };
      return reply.status(200).send(response);
    },
  });

  // Readiness check (bootstrap-protected). Booleans only.
  fastify.get("/preflight", {
    config: {
      rateLimit: {
        max: isProduction ? 10 : 200,
        timeWindow: "1 minute",
      },
    },
    preHandler: [validateSetupOrigin, setupStateGate, requireSetupToken],
    handler: async (_req, reply) => {
      const readiness = await setupService.getReadiness();
      return reply.status(200).send({
        ready: readiness.database && readiness.redis && readiness.configuration,
        ...readiness,
      });
    },
  });

  // Atomic first-run installation. Bootstrap-protected + origin-checked +
  // rate limited. After installation this permanently returns 409 —
  // even with the original valid token.
  fastify.post("/complete", {
    config: {
      rateLimit: {
        max: isProduction ? 5 : 100,
        timeWindow: "1 minute",
      },
    },
    preHandler: [validateSetupOrigin, setupStateGate, requireSetupToken],
    handler: async (req, reply) => {
      const parseResult = SetupCompleteRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                parseResult.error.errors[0]?.message ||
                "Invalid setup request payload",
              requestId: req.id,
            },
          ],
        });
      }

      try {
        await setupService.completeSetup(parseResult.data, {
          applicationVersion: getConfig().system.version,
          requestId: req.id,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"] || null,
        });

        // Auto-login the new owner using the standard staff session path.
        let user: SetupCompleteResponse["user"] = null;
        try {
          const session = await authService.loginStaff(
            parseResult.data.owner.email,
            parseResult.data.owner.password,
            {
              ipAddress: req.ip,
              userAgent: req.headers["user-agent"] || null,
              requestId: req.id,
            },
          );
          const isProd = getConfig().isProduction;
          reply.setCookie(COOKIE_NAME, session.sessionToken, {
            path: "/",
            httpOnly: true,
            secure: isProd,
            sameSite: "lax",
            maxAge: 7 * 24 * 60 * 60,
          });
          user = {
            id: session.user.id,
            email: session.user.email,
            name: session.user.name,
            slug: session.user.slug ?? null,
            roles: session.roles,
            permissions: session.permissions,
          };
        } catch (sessionErr) {
          appLogger.error(
            "setup completed but auto-login failed; owner can sign in manually",
            { requestId: req.id },
            sessionErr as Error,
          );
        }

        return reply.status(200).send({ installed: true, user });
      } catch (err: unknown) {
        if (err instanceof SetupDomainError) {
          const status = err.code === "SETUP_ALREADY_COMPLETED" ? 409 : 400;
          return reply.status(status).send({
            errors: [
              { code: err.code, message: err.message, requestId: req.id },
            ],
          });
        }
        // Domain errors from reused services (e.g. duplicate owner email)
        if (err instanceof Error) {
          const code = (err as Error & { code?: string }).code;
          if (code === "EMAIL_ALREADY_EXISTS") {
            return reply.status(400).send({
              errors: [
                {
                  code: "EMAIL_ALREADY_EXISTS",
                  message: "An account with this email already exists",
                  requestId: req.id,
                },
              ],
            });
          }
        }
        throw err;
      }
    },
  });
}
