import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { WebSocket } from "ws";
import crypto from "node:crypto";
import * as Y from "yjs";
import {
  authService,
  workspaceService,
  postsService,
} from "../services";
import { hasPermission } from "@vibress/security";
import { getConfig } from "@vibress/config";
import { COOKIE_NAME, safeExtractOrigin } from "../middleware/auth";
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
  epoch: number;
}

declare module "fastify" {
  interface FastifyRequest {
    wsContext?: ValidatedWsContext;
  }
}

export async function collaborationWsRoutes(fastify: FastifyInstance) {
  fastify.get<{
    Params: { postId: string };
    Querystring: { token?: string; publicationId?: string; epoch?: string };
  }>(
    "/posts/:postId/collaboration/ws",
    {
      websocket: true,
      preValidation: async (req: FastifyRequest, reply: FastifyReply) => {
        // 1. Validate Origin header
        const origin = safeExtractOrigin(req);
        const allowedOrigins = getConfig().cors.staffAllowedOrigins;
        if ((req.headers.referer && !origin) || (origin && !allowedOrigins.includes(origin))) {
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

        const persistedEpoch = await crdtPersistence.getEpoch(publicationId, postId);

        req.wsContext = {
          session,
          publicationId,
          canEdit,
          epoch: persistedEpoch,
        };
      },
    },
    (socket: WebSocket, req: FastifyRequest) => {
      const { postId } = req.params as { postId: string };
      const ctx = req.wsContext!;
      const { session, publicationId, canEdit, epoch: persistedEpoch } = ctx;
      const query = (req.query as Record<string, string>) || {};
      const parsedQueryEpoch = query.epoch ? parseInt(query.epoch, 10) : NaN;

      // 6. Join room with authoritative epoch resolution (synchronously, preserving WS listeners)
      const room = roomManager.getOrCreateRoom(publicationId, postId, persistedEpoch);
      if (room.epoch < persistedEpoch) {
        room.epoch = persistedEpoch;
      }

      const clientEpoch =
        !Number.isNaN(parsedQueryEpoch) && parsedQueryEpoch > 0
          ? parsedQueryEpoch
          : room.epoch;

      const peerId = crypto.randomUUID();
      const peer: CollaborationPeer = {
        id: peerId,
        userId: session.user.id,
        userName: session.user.name,
        socket,
        epoch: clientEpoch,
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

        // Check for JSON control frame (awareness, ack-restore, ack-epoch)
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
            if (parsed && (parsed.type === "ack-restore" || parsed.type === "ack-epoch")) {
              if (typeof parsed.epoch === "number" && parsed.epoch > 0) {
                peer.epoch = parsed.epoch;
              }
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

        // Fencing check: reject updates originating from a stale epoch
        if (peer.epoch < room.epoch) {
          socket.close(
            4409,
            "Conflict: Document was restored to revision. Client must sync to current epoch.",
          );
          room.removePeer(peerId);
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

      // 8. Initial catch-up synchronization with epoch awareness
      if (socket.readyState === 1 /* OPEN */) {
        socket.send(JSON.stringify({ type: "sync-init", epoch: room.epoch }));
      }

      const inMemoryState = room.getCurrentStateUpdate();
      if (inMemoryState) {
        if (socket.readyState === 1 /* OPEN */) {
          socket.send(inMemoryState, { binary: true });
        }
        if (socket.readyState === 1 /* OPEN */) {
          socket.send(JSON.stringify({ type: "sync-done", epoch: room.epoch }));
        }
      } else {
        crdtPersistence
          .getUpdates(publicationId, postId)
          .then((updates) => {
            for (const update of updates) {
              if (socket.readyState === 1 /* OPEN */) {
                socket.send(update, { binary: true });
              }
              try {
                Y.applyUpdate(room.ydoc, update);
              } catch (applyErr) {
                console.warn(`[WS Room ${postId}] Failed to apply catch-up update to in-memory ydoc:`, applyErr);
              }
            }
            if (socket.readyState === 1 /* OPEN */) {
              socket.send(JSON.stringify({ type: "sync-done", epoch: room.epoch }));
            }
          })
          .catch((err) => {
            console.error(`[WS Room ${postId}] Catch-up sync failed:`, err);
            if (socket.readyState === 1 /* OPEN */) {
              socket.send(JSON.stringify({ type: "sync-done", epoch: room.epoch }));
            }
          });
      }
    },
  );
}
