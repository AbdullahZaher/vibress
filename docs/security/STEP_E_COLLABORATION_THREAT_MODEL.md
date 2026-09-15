# Step E — Collaborative Studio Threat Model & Security Controls

**Document Reference:** `docs/security/STEP_E_COLLABORATION_THREAT_MODEL.md`  
**Date:** 2026-09-15  
**Auditor:** Lead Security Architect  
**Subsystem:** Collaborative Studio Editing (Yjs CRDT over WebSocket & HTTP)  

---

## 1. Threat Matrix & Defense-in-Depth Specification

| # | Threat Vector | Attack Description | Security Control | Implementation Location | Verification Test | Result |
|---|---|---|---|---|---|:---:|
| 1 | **IDOR / Unauthorized Post Access** | Client attempts to connect to `/posts/:postId/collaboration/ws` for a post ID they lack rights to view. | Authoritative RBAC check (`posts.read`/`posts.edit`) against document post record during upgrade handshake. | `apps/api/src/routes/collaboration-ws.ts` | `rejects connection if post does not exist or user lacks read permission` | **PASS** |
| 2 | **Cross-Publication Room Access** | Staff user from Publication Alpha connects to Publication Beta's post collaboration room. | Authoritative verification that `post.publicationId === staffPublicationContext.publicationId`. Reject with 4403. | `apps/api/src/routes/collaboration-ws.ts` | `adversarially rejects cross-publication collaboration room access` | **PASS** |
| 3 | **Cross-Document Room Pollution** | Client connected to Post A's room attempts to broadcast updates tagged for Post B. | Socket is bound strictly to `(publicationId, postId)` at handshake. Ingress frames are strictly applied only to the bound room. | `apps/api/src/collaboration/room-manager.ts` | `verifies updates are strictly applied to bound document room only` | **PASS** |
| 4 | **Spoofed Publication Headers** | Attacker injects `X-Publication-Id: pub_beta` on WebSocket upgrade. | Server-side `resolveStaffPublicationContext` overrides client headers and verifies `publication_memberships`. | `apps/api/src/middleware/auth.ts` | `rejects spoofed X-Publication-Id on websocket handshake` | **PASS** |
| 5 | **Session / Token Abuse** | Expired or forged session token passed in query parameter or cookie during WS upgrade. | Session verification via `sessionService.validateSession` using signed HMAC tokens. Reject immediately if invalid. | `apps/api/src/routes/collaboration-ws.ts` | `rejects websocket connection with invalid or expired auth token` | **PASS** |
| 6 | **Replay Attacks** | Attacker records old binary CRDT updates and re-transmits them later to corrupt document state. | Yjs state vectors are commutative, associative, and idempotent. Applying an already-integrated update produces a zero-op. | Yjs CRDT core engine | `replaying old CRDT updates is idempotent and does not corrupt state` | **PASS** |
| 7 | **Malformed CRDT Update** | Attacker transmits garbage binary bytes or corrupted Yjs frames to crash the server parser. | Safe frame decoding wrapped in try/catch; malformed frames are rejected with close code 4400 without crashing process. | `apps/api/src/collaboration/room-manager.ts` | `rejects malformed binary updates without crashing socket or server` | **PASS** |
| 8 | **Oversized Update / Frame Flooding** | Attacker sends huge 50MB payload to exhaust server memory. | Strict binary frame limit enforced at 64 KB (`MAX_CRDT_UPDATE_BYTES = 65536`). Sockets exceeding limit are terminated. | `apps/api/src/routes/collaboration-ws.ts` | `terminates socket if frame exceeds maximum permitted size (64KB)` | **PASS** |
| 9 | **Update Flooding / DoS** | Attacker rapidly bursts 10,000 updates/sec to swamp the server and peers. | Sliding-window token-bucket rate limiter: max 120 updates per minute per user/document. Excess frames dropped. | `apps/api/src/collaboration/crdt-rate-limiter.ts` | `throttles high-frequency update flooding with rate-limit warnings/drop` | **PASS** |
| 10| **Room / Connection Exhaustion** | Attacker opens thousands of concurrent idle WebSocket connections to consume file descriptors. | Max connection limit per room (default 25 active peers) and max rooms per instance; idle sockets pruned after timeout. | `apps/api/src/collaboration/room-manager.ts` | `enforces connection limits and cleans up idle connections` | **PASS** |
| 11| **Memory Exhaustion (Leakage)** | Active rooms retain updates indefinitely in RAM until process runs out of memory. | Incremental update compaction: when updates exceed threshold (100 updates), compile snapshot into Redis/Postgres and flush buffer. | `apps/api/src/collaboration/crdt-persistence.ts` | `bounds memory by compacting incremental updates into snapshots` | **PASS** |
| 12| **Presence Leakage Across Tenants** | Awareness state of users in Publication Beta broadcasted to Publication Alpha. | Awareness channels are strictly partitioned by `(publicationId, postId)`. Peer discovery never crosses room boundaries. | `apps/api/src/collaboration/room-manager.ts` | `presence awareness is strictly isolated to authenticated room peers` | **PASS** |
| 13| **Stale Client Overwrite** | Offline or lagged client reconnects with outdated content and attempts to overwrite newer edits. | CRDT mathematical convergence: Yjs clock vectors preserve concurrent non-conflicting edits without destructive overwrites. | Yjs CRDT + `@lexical/yjs` | `concurrent divergent edits converge without losing content` | **PASS** |
| 14| **Reconnect Storm Mitigation** | Cluster restart triggers thousands of simultaneous client reconnect attempts. | Exponential backoff with random jitter implemented in client `WebSocketCollaborationProvider` (1s to 30s max). | `packages/studio-react/src/collaboration/websocket-collaboration-provider.ts` | `verifies client reconnects with exponential backoff and jitter` | **PASS** |
| 15| **Server Restart Data Loss** | Fastify backend restarts or crashes while authors are collaborating. | Updates are durably written to Redis AOF (`pub:${pubId}:crdt:${postId}:updates`) and periodically synced to PostgreSQL. | `apps/api/src/collaboration/crdt-persistence.ts` | `acknowledged edits survive server restart and process recovery` | **PASS** |
| 16| **Origin / Cross-Site WS Hijacking** | Malicious third-party website initiates WebSocket connection using victim's ambient browser cookies. | Handshake validates `Origin` header against `config.cors.staffAllowedOrigins`. Unauthorized origins rejected. | `apps/api/src/routes/collaboration-ws.ts` | `rejects websocket upgrade if Origin header is unauthorized` | **PASS** |
| 17| **Sensitive Logging / Information Leak** | Binary document contents or session tokens logged to stdout. | Tokens redacted in logs; binary frames logged with byte counts only, never payload dumps. | `apps/api/src/routes/collaboration-ws.ts` | `verifies logs contain only structured metadata with redacted tokens` | **PASS** |

---

## 2. Security Decision Summary

The combination of:
1. Origin header allowlist validation
2. Authoritative token/cookie session verification
3. Document-level RBAC + Step D PublicationContext enforcement
4. Ingress frame size caps (64 KB)
5. Token-bucket rate limiting (120 updates/min)
6. Durable Redis-backed persistence and periodic Postgres compaction

guarantees that Collaborative Studio Editing is fully isolated, resilient against adversarial abuse, and safe for multi-tenant production deployment.
