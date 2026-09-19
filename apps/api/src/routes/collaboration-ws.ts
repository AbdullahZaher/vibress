import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { WebSocket } from "ws";
import crypto from "node:crypto";
import {
  authService,
  workspaceService,
  postsService,
} from "../services";
import { hasPermission } from "@vibress/security";
import { getConfig } from "@vibress/config";
import { COOKIE_NAME } from "../middleware/auth";
import {
  roomManager,
  MAX_CRDT_UPDATE_BYTES,
  CollaborationPeer,
} from "../collaboration/room-manager";
import { crdtPersistence } from "../collaboration/crdt-persistence";
import { crdtRateLimiter } from "../collaboration/crdt-rate-limiter";

interface ValidatedWsContext {
  session: {
    user: { id: string; email: string; name: string };
    roles: string[];
    permissions: string[];
  };
  publicationId: string;
  canEdit: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    wsContext?: ValidatedWsContext;
  }
}

export async function collaborationWsRoutes(fastify: FastifyInstance) {
  fastify.get<{
    Params: { postId: string };
    Querystring: { token?: string; publicationId?: string };
  }>(
    "/posts/:postId/collaboration/ws",
    {
      websocket: true,
      preValidation: async (req: FastifyRequest, reply: FastifyReply) => {
        // 1. Validate Origin header
        const origin =
          req.headers.origin ||
          (req.headers.referer ? new URL(req.headers.referer).origin : null);
        const allowedOrigins = getConfig().cors.staffAllowedOrigins;
        if (origin && !allowedOrigins.includes(origin)) {
          return reply.status(403).send({
            errors: [
              {
                code: "FORBIDDEN_ORIGIN",
                message: "Forbidden: Invalid request origin",
                requestId: req.id,
              },
            ],
          });
        }

        // 2. Extract and validate session token
        const query = (req.query as Record<string, string>) || {};
        let token: string | null = null;
        if (req.cookies && req.cookies[COOKIE_NAME]) {
          token = req.cookies[COOKIE_NAME] as string;
        } else if (req.headers.authorization?.startsWith("Bearer ")) {
          token = req.headers.authorization.substring(7).trim();
        } else if (query.token) {
          token = query.token.trim();
        }

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

        const session = await authService.resolveSession(token);
        if (!session) {
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

        // 3. Verify permissions (posts.read or posts.edit)
        const canRead = hasPermission(
          session.permissions,
          "posts.read",
          session.roles,
        );
        const canEdit = hasPermission(
          session.permissions,
          "posts.edit",
          session.roles,
        );

        if (!canRead && !canEdit) {
          return reply.status(403).send({
            errors: [
              {
                code: "PERMISSION_DENIED",
                message: "Forbidden: posts.read or posts.edit permission required",
                requestId: req.id,
              },
            ],
          });
        }

        // 4. Authoritatively resolve publication context
        const requestedPubId =
          (req.headers["x-publication-id"] as string) ||
          query.publicationId ||
          undefined;

        let publicationId: string;
        try {
          const pubCtx = await workspaceService.resolveStaffPublicationContext(
            session.user.id,
            requestedPubId,
            session.roles,
          );
          publicationId = pubCtx.publicationId;
        } catch {
          return reply.status(403).send({
            errors: [
              {
                code: "PUBLICATION_ACCESS_DENIED",
                message: "Forbidden: User does not belong to requested publication",
                requestId: req.id,
              },
            ],
          });
        }

        // 5. Verify post existence and publication ownership
        const { postId } = req.params as { postId: string };
        const post = await postsService.findById(postId, publicationId);
        if (!post) {
          return reply.status(404).send({
            errors: [
              {
                code: "POST_NOT_FOUND",
                message: "Not Found: Post does not exist in publication",
                requestId: req.id,
              },
            ],
          });
        }

        req.wsContext = {
          session,
          publicationId,
          canEdit,
        };
      },
    },
    (socket: WebSocket, req: FastifyRequest) => {
      const { postId } = req.params as { postId: string };
      const ctx = req.wsContext!;
      const { session, publicationId, canEdit } = ctx;

      // 6. Join room
      const room = roomManager.getOrCreateRoom(publicationId, postId);
      const peerId = crypto.randomUUID();
      const peer: CollaborationPeer = {
        id: peerId,
        userId: session.user.id,
        userName: session.user.name,
        socket,
      };

      const added = room.addPeer(peer);
      if (!added) {
        socket.close(4429, "Too Many Requests: Room connection limit reached");
        return;
      }

      // 7. Synchronously register message listeners right upon connection
      socket.on("message", async (data: unknown, isBinary?: boolean) => {
        let buf: Buffer;
        if (Buffer.isBuffer(data)) {
          buf = data;
        } else if (ArrayBuffer.isView(data)) {
          buf = Buffer.from(
            (data as Uint8Array).buffer,
            (data as Uint8Array).byteOffset,
            (data as Uint8Array).byteLength,
          );
        } else if (data instanceof ArrayBuffer) {
          buf = Buffer.from(data);
        } else {
          buf = Buffer.from(String(data));
        }

        if (buf.length > MAX_CRDT_UPDATE_BYTES) {
          socket.close(4413, "Payload Too Large: CRDT update exceeds 64 KB");
          return;
        }

        // Check for awareness control frame
        if (
          isBinary === false ||
          (buf.length > 0 && (buf[0] === 0x7b /* '{' */ || buf[0] === 0x5b /* '[' */))
        ) {
          try {
            const text = buf.toString("utf8");
            const parsed = JSON.parse(text);
            if (parsed && parsed.type === "awareness") {
              room.broadcastString(text, peerId);
              return;
            }
          } catch {
            // Not a valid JSON control frame, treat as binary update below
          }
        }

        if (!canEdit) {
          // Read-only peers cannot broadcast document mutations
          return;
        }

        const rateLimitKey = `${session.user.id}:${peerId}`;
        if (!crdtRateLimiter.isAllowed(rateLimitKey)) {
          // Throttled
          return;
        }

        const updateBytes = new Uint8Array(buf);
        await room.recordUpdate(updateBytes);
        room.broadcastBinary(updateBytes, peerId);
      });

      socket.on("close", () => {
        roomManager.removePeer(publicationId, postId, peerId);
      });

      socket.on("error", () => {
        roomManager.removePeer(publicationId, postId, peerId);
      });

      // 8. Initial catch-up synchronization
      console.log(`[WS Room ${postId}] peerCount=${room.peerCount}, peerId=${peerId}`);
      if (room.peerCount === 1) {
        // First peer in room bootstraps from authoritative PostgreSQL content
        crdtPersistence.clear(publicationId, postId).catch(() => {});
        if (socket.readyState === 1 /* OPEN */) {
          socket.send(JSON.stringify({ type: "sync-done" }));
        }
      } else {
        // Subsequent peers catch up to active room session
        const inMemoryState = room.getCurrentStateUpdate();
        if (inMemoryState) {
          if (socket.readyState === 1 /* OPEN */) {
            socket.send(inMemoryState, { binary: true });
          }
          if (socket.readyState === 1 /* OPEN */) {
            socket.send(JSON.stringify({ type: "sync-done" }));
          }
        } else {
          crdtPersistence
            .getUpdates(publicationId, postId)
            .then((updates) => {
              for (const update of updates) {
                if (socket.readyState === 1 /* OPEN */) {
                  socket.send(update, { binary: true });
                }
              }
              if (socket.readyState === 1 /* OPEN */) {
                socket.send(JSON.stringify({ type: "sync-done" }));
              }
            })
            .catch((err) => {
              console.error(`[WS Room ${postId}] Catch-up sync failed:`, err);
              if (socket.readyState === 1 /* OPEN */) {
                socket.send(JSON.stringify({ type: "sync-done" }));
              }
            });
        }
      }
    },
  );
}
