# ADR: Step E — Production Collaborative Studio Architecture

**Document Reference:** `docs/adr/STEP_E_COLLABORATION_ARCHITECTURE.md`  
**Status:** ACCEPTED  
**Date:** 2026-09-15  
**Deciders:** Lead Staff Engineer, Security Architect, Production Engineer  

---

## 1. Context & Problem Statement

Vibress Studio uses Lexical for rich document editing and Yjs for CRDT-based concurrent collaboration. However, the existing implementation relied on an ephemeral, in-memory Map (`docUpdatesMap`) attached to a single Fastify process with only HTTP polling.
This had critical deficiencies:
1. Process restart or crash destroyed all un-flushed CRDT updates.
2. Multiple server instances could not synchronize document state.
3. No real-time WebSocket protocol existed on the API server.
4. Client `VibressStudio` in `PostEditor.tsx` was not wired to a collaboration provider.

We must implement a production-grade, multi-tenant collaboration runtime without creating excessive infrastructure or violating the Step D constraint of zero database schema migrations.

---

## 2. Decision: Durable Redis-Backed WebSocket Room Architecture

We choose the following streamlined, robust architecture:

```
┌────────────────────────────────────────────────────────┐
│             Admin Studio Client (Lexical)              │
│       WebSocketCollaborationProvider (Yjs/CRDT)        │
└───────────────────────────┬────────────────────────────┘
                            │ WSS /api/admin/v1/posts/:postId/collaboration/ws
                            ▼
┌────────────────────────────────────────────────────────┐
│            Fastify API WebSocket Gateway               │
│  - Origin & Cookie/Token Handshake Authentication       │
│  - Authoritative PublicationContext & RBAC Check        │
│  - Ingress Size Limit (64 KB) & Rate Limiting (120/min)│
└───────────────────────────┬────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
┌───────────────────────────┐   ┌───────────────────────────┐
│     In-Memory Room        │   │    Durable Persistence    │
│  - Active peer sockets    │   │  - Redis AOF Key:         │
│  - Broadcast binary Yjs   │   │    pub:${pubId}:crdt:     │
│  - Broadcast JSON presence│   │    ${postId}:updates      │
└───────────────────────────┘   │  - Periodic Snapshot:     │
                                │    Compacted Y.Doc state  │
                                │  - DB Autosave:           │
                                │    posts.content (JSON)   │
                                └───────────────────────────┘
```

### Key Technical Decisions:

1. **Transport Protocol:**
   WebSocket via `@fastify/websocket` on path `/api/admin/v1/posts/:postId/collaboration/ws`.
   HTTP fallback endpoint `/api/admin/v1/posts/:postId/collaboration/crdt` is maintained for non-WebSocket environments.

2. **Room & Document Identity:**
   Every room is strictly identified by the tuple `(publicationId, postId)`.
   Room key format: `pub:${publicationId}:doc:${postId}`.
   Under no circumstances can a connection join a room in a different publication.

3. **Handshake & Authentication:**
   - Transport: WSS handshake upgrades over HTTP GET.
   - Authentication: Extracted from signed session cookie (`vibress_staff_token`) or query token (`?token=...`).
   - Authorization: Verified against `users`, `user_roles`, `permissions`, and `publication_memberships`.
   - Rejection: Fails closed immediately with HTTP 403 or WebSocket close code `4403` if unauthorized.

4. **Durable Persistence Strategy (Zero Schema Changes):**
   - **Hot Storage (Redis):** Every valid binary update applied to a document is appended to Redis list `pub:${publicationId}:crdt:${postId}:updates`.
   - **Compaction & Snapshotting:** When updates exceed 100 entries, the server merges updates into a single compact Y.Doc state vector stored in `pub:${publicationId}:crdt:${postId}:snapshot` and trims the update list.
   - **Cold Storage (PostgreSQL):** Upon document save/publish, the authoritative editor state is serialized into `posts.content` (standard Lexical/Studio JSON structure).
   - **Recovery on Restart:** When a room is activated after a server restart, the room loads the Redis snapshot + incremental updates. If Redis was completely flushed, it reconstructs the initial Y.Doc from the PostgreSQL `posts.content`.

5. **Clustering & Cross-Instance Broadcast:**
   Redis Pub/Sub channel `pub:${publicationId}:crdt:${postId}:bus` allows multiple API server instances to distribute updates to all connected peers in that room.

6. **Safety & Abuse Controls:**
   - Max frame payload: 64 KB (`65,536` bytes).
   - Token bucket rate limiter: 120 updates/min per client.
   - Max concurrent peer connections per room: 50.
   - Origin check enforced on upgrade.

---

## 3. Consequences & Invariants

- **Step D Preserved:** Multi-publication isolation is maintained at the Redis namespace layer and WebSocket handshake.
- **Durable:** Server restarts no longer drop document progress.
- **Fail-Closed:** Missing or invalid credentials result in immediate connection termination.
- **No Migration Required:** Utilizes existing Redis infrastructure and existing PostgreSQL `posts` schema.
