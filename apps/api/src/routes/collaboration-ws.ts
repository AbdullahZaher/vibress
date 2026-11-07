import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { WebSocket } from "ws";
import crypto from "node:crypto";
import {
  authService,
  workspaceService,
  postsService,
  authorsService,
} from "../services";
import { hasPermission, hasResourcePermission } from "@vibress/security";
import { getConfig } from "@vibress/config";
import { COOKIE_NAME, safeExtractOrigin } from "../middleware/auth";
import {
  roomManager,
  MAX_CRDT_UPDATE_BYTES,
  MAX_AWARENESS_FRAME_BYTES,
  CollaborationPeer,
} from "../collaboration/room-manager";
import {
  crdtPersistence,
  CrdtPersistenceError,
  ReconciledCrdtState,
} from "../collaboration/crdt-persistence";
import { crdtRateLimiter } from "../collaboration/crdt-rate-limiter";

interface ValidatedWsContext {
  session: {
    user: { id: string; email: string; name: string };
    roles: string[];
    permissions: string[];
  };
  publicationId: string;
  canEdit: boolean;
  reconciled: ReconciledCrdtState;
}

declare module "fastify" {
  interface FastifyRequest {
    wsContext?: ValidatedWsContext;
  }
}

export async function collaborationWsRoutes(fastify: FastifyInstance) {
  fastify.get<{
    Params: { postId: string };
    Querystring: {
      token?: string;
      publicationId?: string;
      epoch?: string;
      generationId?: string;
    };
  }>(
    "/posts/:postId/collaboration/ws",
    {
      websocket: true,
      preValidation: async (req: FastifyRequest, reply: FastifyReply) => {
        const query = (req.query as Record<string, string>) || {};

        // 1. Validate Origin header (fail closed for cookie-authenticated browser sessions)
        const origin = safeExtractOrigin(req);
        const allowedOrigins = getConfig().cors.staffAllowedOrigins;
        const usesCookieOnlyAuth = Boolean(
          req.cookies &&
            req.cookies[COOKIE_NAME] &&
            !req.headers.authorization?.startsWith("Bearer ") &&
            !query.token,
        );
        if (
          (req.headers.referer && !origin) ||
          (origin && !allowedOrigins.includes(origin)) ||
          (usesCookieOnlyAuth && (!origin || !allowedOrigins.includes(origin)))
        ) {
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

        // 3. Verify coarse staff permissions (posts.read or posts.edit)
        const canRead = hasPermission(
          session.permissions,
          "posts.read",
          session.roles,
        );
        const coarseCanEdit = hasPermission(
          session.permissions,
          "posts.edit",
          session.roles,
        );
        if (!canRead && !coarseCanEdit) {
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

        // 4. Resolve and verify publication scope
        const requestedPubId =
          (req.headers["x-publication-id"] as string | undefined) ||
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
                message:
                  "Forbidden: User does not belong to requested publication",
                requestId: req.id,
              },
            ],
          });
        }

        // 5. Verify post existence, publication ownership, and resource-level edit authorization
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

        let canEdit = false;
        if (coarseCanEdit) {
          const postAuthors = await authorsService.getPostAuthors(post.id);
          const postAuthorIds = (postAuthors || [])
            .map((a: { id?: string; authorId?: string }) => a?.id || a?.authorId)
            .filter((v): v is string => Boolean(v));
          canEdit = hasResourcePermission("posts.edit", {
            actorId: session.user.id,
            resourceOwnerId: post.primaryAuthorId,
            resourceAuthorIds: postAuthorIds,
            userRoles: session.roles,
            userPermissions: session.permissions,
            publicationId,
            resourcePublicationId: post.publicationId,
          });
        }

        if (!canRead && !canEdit) {
          return reply.status(403).send({
            errors: [
              {
                code: "PERMISSION_DENIED",
                message:
                  "Forbidden: You do not have permission to access this post",
                requestId: req.id,
              },
            ],
          });
        }

        // 6. Reconcile durable CRDT state with PostgreSQL (recovers any crashed/interrupted restore)
        let reconciled: ReconciledCrdtState;
        try {
          reconciled = await crdtPersistence.reconcileWithDatabase(
            publicationId,
            postId,
            { version: post.version, content: post.content },
            {
              skipIfRestoreLocked: roomManager.isRestoreLocked(
                publicationId,
                postId,
              ),
            },
          );
        } catch (err) {
          if (err instanceof CrdtPersistenceError) {
            return reply.status(503).send({
              errors: [
                {
                  code: err.code,
                  message: err.message,
                  requestId: req.id,
                },
              ],
            });
          }
          throw err;
        }

        req.wsContext = {
          session,
          publicationId,
          canEdit,
          reconciled,
        };
      },
    },
    (socket: WebSocket, req: FastifyRequest) => {
      const { postId } = req.params as { postId: string };
      const ctx = req.wsContext!;
      const { session, publicationId, canEdit, reconciled } = ctx;
      const query = (req.query as Record<string, string>) || {};

      // Join & hydrate room synchronously with authoritative server generation
      const room = roomManager.getOrCreateRoom(
        publicationId,
        postId,
        reconciled.epoch,
        reconciled.generationId,
      );
      room.hydrateFromDurableState({
        epoch: reconciled.epoch,
        generationId: reconciled.generationId,
        revokedClientIds: reconciled.revokedClientIds,
        snapshot: reconciled.snapshot,
        updates: reconciled.updates,
        restoredContent: reconciled.restoreState?.restoredContent,
        restoreStatus: reconciled.restoreState?.status,
      });

      const hasEpochQuery =
        query.epoch !== undefined && query.epoch !== "";
      const parsedQueryEpoch = hasEpochQuery ? Number(query.epoch) : NaN;
      const hasGenerationQuery =
        query.generationId !== undefined && query.generationId !== "";

      const epochMismatch =
        hasEpochQuery &&
        (!Number.isInteger(parsedQueryEpoch) ||
          parsedQueryEpoch <= 0 ||
          parsedQueryEpoch !== room.epoch);
      const generationMismatch =
        hasGenerationQuery && query.generationId !== room.generationId;
      const isStaleConnection = epochMismatch || generationMismatch;

      const peerId = crypto.randomUUID();
      const challengeNonce = crypto.randomUUID();
      const peer: CollaborationPeer = {
        id: peerId,
        userId: session.user.id,
        userName: session.user.name,
        socket,
        epoch: isStaleConnection
          ? Number.isInteger(parsedQueryEpoch) && parsedQueryEpoch > 0
            ? parsedQueryEpoch
            : 0
          : room.epoch,
        generationId: isStaleConnection
          ? query.generationId || "stale"
          : room.generationId,
        challengeNonce,
        fenced: isStaleConnection,
        handshakeComplete: false,
        canEdit,
      };

      const added = room.addPeer(peer);
      if (!added) {
        socket.close(4429, "Too Many Requests: Room connection limit reached");
        return;
      }

      // Synchronously register message listeners upon connection
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
          room.removePeer(peerId);
          return;
        }

        // Handle JSON text control frames strictly when frame is text (isBinary === false)
        if (isBinary === false) {
          if (buf.length > MAX_AWARENESS_FRAME_BYTES) {
            socket.close(4413, "Payload Too Large: Control frame exceeds 4 KB");
            room.removePeer(peerId);
            return;
          }
          try {
            const text = buf.toString("utf8");
            const parsed = JSON.parse(text);
            if (parsed && parsed.type === "awareness") {
              if (
                !peer.fenced &&
                !room.restorationBarrierActive &&
                !room.requiresRecovery &&
                peer.epoch === room.epoch &&
                peer.generationId === room.generationId
              ) {
                if (
                  typeof parsed.clientId === "number" &&
                  Number.isFinite(parsed.clientId) &&
                  !room.revokedClientIds.has(parsed.clientId)
                ) {
                  peer.clientId = parsed.clientId;
                }
                room.broadcastString(text, peerId);
              }
              return;
            }

            if (
              parsed &&
              (parsed.type === "ack-restore" || parsed.type === "ack-epoch")
            ) {
              // SECURITY INVARIANT (CR-02): Client-supplied epoch acknowledgments NEVER
              // promote peer.epoch, clear fencing, or grant write access to a new generation.
              return;
            }

            if (parsed && parsed.type === "ack-sync") {
              const validClient =
                parsed.clientId === undefined ||
                (typeof parsed.clientId === "number" &&
                  Number.isFinite(parsed.clientId) &&
                  !room.revokedClientIds.has(parsed.clientId));

              if (
                !peer.fenced &&
                !room.restorationBarrierActive &&
                !room.requiresRecovery &&
                parsed.epoch === room.epoch &&
                typeof parsed.generationId === "string" &&
                parsed.generationId === room.generationId &&
                typeof parsed.challengeNonce === "string" &&
                parsed.challengeNonce === peer.challengeNonce &&
                validClient
              ) {
                if (typeof parsed.clientId === "number") {
                  peer.clientId = parsed.clientId;
                }
                peer.handshakeComplete = true;
              } else {
                peer.fenced = true;
                peer.handshakeComplete = false;
                socket.close(
                  4409,
                  "Conflict: Document was restored to revision. Invalid generation handshake.",
                );
                room.removePeer(peerId);
              }
              return;
            }
          } catch {
            socket.close(4400, "Bad Request: Invalid control frame JSON");
            room.removePeer(peerId);
            return;
          }
          return;
        }

        if (!canEdit) {
          // Read-only peers cannot broadcast document mutations
          return;
        }

        const updateBytes = new Uint8Array(buf);
        const validation = room.validateIncomingUpdate(peer, updateBytes);
        if (!validation.allowed) {
          socket.close(validation.closeCode, validation.reason);
          room.removePeer(peerId);
          return;
        }

        const rateLimitKey = `${publicationId}:${postId}:${session.user.id}`;
        if (!crdtRateLimiter.isAllowed(rateLimitKey)) {
          // Throttled
          return;
        }

        try {
          await room.recordUpdate(updateBytes, {
            epoch: peer.epoch,
            generationId: peer.generationId,
          });
        } catch (err: unknown) {
          const epochConflict =
            err instanceof CrdtPersistenceError && err.code === "CRDT_EPOCH_CONFLICT";
          req.log.error({ err, postId }, "Collaborative update rejected before broadcast");
          socket.close(
            epochConflict ? 4409 : 1013,
            epochConflict
              ? "Conflict: Document generation changed; reconnect."
              : "Service Unavailable: Collaborative update not persisted.",
          );
          room.removePeer(peerId);
          return;
        }
        room.broadcastBinary(updateBytes, peerId);
      });

      const cleanupSocket = () => {
        if (peer.clientId !== undefined) {
          room.broadcastString(
            JSON.stringify({
              type: "awareness",
              clientId: peer.clientId,
              state: null,
            }),
            peerId,
          );
        }
        roomManager.removePeer(publicationId, postId, peerId);
      };

      socket.on("close", cleanupSocket);
      socket.on("error", cleanupSocket);

      // Defer initial catch-up synchronization briefly so the HTTP 101 WebSocket
      // Upgrade flushes over TCP and client `open` listeners attach `message` handlers cleanly.
      const catchUpTimer = setTimeout(() => {
        if (socket.readyState !== 1 /* OPEN */) return;

        socket.send(
          JSON.stringify({
            type: "sync-init",
            epoch: room.epoch,
            generationId: room.generationId,
            canEdit: peer.canEdit,
            ...(room.restoredContent
              ? { restoredContent: room.restoredContent }
              : {}),
          }),
        );

        if (!peer.fenced) {
          const inMemoryState = room.getCurrentStateUpdate();
          if (inMemoryState && socket.readyState === 1 /* OPEN */) {
            socket.send(inMemoryState, { binary: true });
          }
        }

        if (socket.readyState === 1 /* OPEN */) {
          const svBase64 = Buffer.from(room.getStateVector()).toString("base64");
          socket.send(
            JSON.stringify({
              type: "sync-done",
              epoch: room.epoch,
              generationId: room.generationId,
              challengeNonce: peer.challengeNonce,
              stateVector: svBase64,
            }),
          );
        }
      }, 15);
      catchUpTimer.unref?.();

      socket.on("close", () => {
        clearTimeout(catchUpTimer);
      });
      socket.on("error", () => {
        clearTimeout(catchUpTimer);
      });
    },
  );
}
