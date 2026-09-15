# Step E — Architecture Reconnaissance Report
## Collaborative Studio Production Reality & Remediation

**Document Reference:** `docs/audits/STEP_E_ARCHITECTURE_RECON.md`  
**Date:** 2026-09-15  
**Auditor:** Lead Staff Systems & Security Architect  
**Starting Commit SHA:** `8554123d2d638f437ddfee1b8165e44d99b9c62e`  

---

## 1. Executive Summary

A comprehensive repository-wide audit of all collaborative editing components was performed across `packages/studio-react`, `apps/api`, `apps/admin`, `packages/domains/posts`, `infrastructure/nginx`, and database schemas.

The current collaborative studio implementation is classified overall as:
**PROTOTYPE / PARTIAL**

While editorial collaboration metadata (comments, suggestions, assignments) is **REAL** and persisted in PostgreSQL, real-time CRDT document synchronization is only a prototype:
- There is **NO WebSocket server** in `apps/api`.
- The existing HTTP `/crdt` sync endpoint stores binary Yjs updates in an ephemeral in-process JavaScript `Map<string, Uint8Array[]>` that is **wiped on server restart**.
- `PostEditor.tsx` in `apps/admin` renders `VibressStudio` without the `collaboration` prop.
- The client-side `WebSocketCollaborationProvider` in `packages/studio-react` has no live backend endpoint to connect to.

---

## 2. Detailed Component Classification Matrix

| Component | Repository Path | Reality Classification | Findings & Deficiencies |
|---|---|:---:|---|
| **Lexical / Yjs Collaboration Plugin** | `packages/studio-react/src/VibressStudio.tsx` | **PARTIAL** | Lexical `<CollaborationPlugin>` is conditionally mounted if `collaboration` prop is provided. Functional in isolation when passed a provider. |
| **Client WebSocket Provider** | `packages/studio-react/src/collaboration/websocket-collaboration-provider.ts` | **PROTOTYPE** | Implements `@lexical/yjs` `Provider` with binary Yjs frames and JSON awareness frames. Lacks ping/pong keepalive and has no backend to connect to. |
| **Client Memory Provider** | `packages/studio-react/src/collaboration/memory-collaboration-provider.ts` | **MOCK** | In-memory pub-sub provider used for unit testing. Not for production multi-client use. |
| **API WebSocket Server** | `apps/api/src` | **MISSING** | Fastify does not register `@fastify/websocket` or any native WebSocket server. Zero WebSocket upgrade paths exist. |
| **CRDT HTTP Sync Endpoint** | `apps/api/src/routes/collaboration.ts` | **PROTOTYPE** | GET/POST `/posts/:postId/collaboration/crdt` accepts base64 Yjs updates with rate limiting, but routes them to an in-memory Map. |
| **CRDT Persistence Engine** | `packages/domains/posts/src/application/editorial-collaboration-service.ts` | **MISSING** | `docUpdatesMap` is `Map<string, Uint8Array[]>`. Any process restart, crash, or horizontal scaling loses all active document updates. |
| **Editorial Comments & Suggestions** | `apps/api/src/routes/collaboration.ts` | **REAL** | Persisted in PostgreSQL via `editorial_comments`, `editorial_suggestions`, `editorial_assignments`. Step D publication scoped. |
| **Editor Presence System** | `editorial-collaboration-service.ts` | **PROTOTYPE** | Heartbeat endpoint `/posts/:postId/collaboration/presence` stores presence in volatile memory map `presenceMap`. No real-time push. |
| **PostEditor UI Integration** | `apps/admin/src/components/PostEditor.tsx` | **PARTIAL** | `PostEditor` renders `EditorialCollaborationPanel` for comments/status, but mounts `VibressStudio` *without* `collaboration` prop. |
| **Multi-Publication Authorization** | `apps/api/src/routes/collaboration.ts` | **REAL** | Validates staff session and publication context (`req.publicationContext.publicationId`). Cross-publication attacks are rejected. |
| **Gateway / Nginx WebSocket Proxying** | `infrastructure/nginx/nginx.conf` | **PARTIAL** | Web (`/`) and Admin (`/admin/`) have `Upgrade $http_upgrade`, but API (`/api/`) sets `proxy_set_header Connection ""` which drops WebSocket upgrades. |
| **End-to-End Multi-User Browser Tests** | `tests/e2e` | **MISSING** | No Playwright test verifies two independent authenticated browser contexts editing the same document concurrently. |

---

## 3. Gap Analysis for Step E Production Remediation

To elevate Collaborative Studio Editing to **REAL / PRODUCTION-GRADE**, the following remediation steps are required:

1. **Fastify WebSocket Server (`@fastify/websocket`):**
   Register a dedicated, authenticated WebSocket route:
   `GET /api/admin/v1/posts/:postId/collaboration/ws`
2. **Authoritative Handshake & RBAC:**
   Enforce staff session authentication (via cookie or token), `posts.edit` / `posts.read` permission, and strict `PublicationContext` authorization during the WebSocket upgrade handshake. Reject unauthorized cross-tenant requests with immediate socket closure (`4403 Forbidden`).
3. **Durable CRDT Storage (Redis + PostgreSQL):**
   - Store incremental Yjs updates in Redis under publication-scoped keys: `pub:${publicationId}:crdt:${postId}:updates`.
   - Implement periodic snapshotting into PostgreSQL (`posts.content`), ensuring that acknowledged edits survive server restarts and process recycling.
4. **Room Lifecycle & Cross-Instance Broadcast:**
   - Multi-client room manager tracking active connections per `postId`.
   - Redis Pub/Sub channel (`pub:${publicationId}:crdt:${postId}:bus`) to broadcast updates across cluster instances.
5. **Gateway Ingress Configuration:**
   Update `infrastructure/nginx/nginx.conf` so `/api/` passes `Upgrade $http_upgrade` and `Connection $connection_upgrade`.
6. **PostEditor Wiring:**
   Wire `collaboration` prop in `PostEditor.tsx` using `WebSocketCollaborationProvider` connected to the authenticated WS endpoint.
7. **Adversarial & Concurrency Test Suite:**
   Create exhaustive integration tests validating two independent clients, concurrent convergence, server restart recovery, payload limits, rate limiting, and cross-publication rejection.
