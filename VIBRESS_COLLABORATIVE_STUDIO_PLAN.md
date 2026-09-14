# VIBRESS — COLLABORATIVE STUDIO TARGET PLAN
## Complete Production Real-Time Collaborative Editing Architecture

---

## 1. Current State vs Target Vision

### Current State
As proven in the Runtime Truth Audit:
- `apps/api` has no WebSocket server or transport.
- CRDT updates are sent over two HTTP REST endpoints into an unpersisted in-memory JavaScript `Map` (`docUpdatesMap`).
- `PostEditor.tsx` in `apps/admin` does not pass collaboration props to `<VibressStudio>`.
- Vitest tests only verify in-process memory sharing between two Lexical instances.
- **Production capability**: **Non-existent (0% real-time multi-browser synchronization).**

### Target Vision
A production-grade, Google Docs-style real-time collaborative editing system for Vibress Studio supporting:
- Multiple concurrent editors on the same document across different browsers and devices.
- Low-latency (<50ms) character-by-character synchronization via Yjs CRDTs.
- Real-time cursor presence, user color coding, and text selection awareness.
- Strict authentication, capability authorization, and publication boundary isolation.
- Resilient reconnection, offline buffering, and durable PostgreSQL snapshot storage.
- Horizontal multi-instance scalability powered by Redis Pub/Sub.

---

## 2. Architectural Trade-Off Analysis

| Option | Description | Pros | Cons | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **Option A: Dedicated Collaboration Microservice** | Standalone Node/Rust service exclusively terminating WebSockets and running Yjs hubs. | Clean process isolation; heavy WebSocket loads don't impact REST API. | Extra container to deploy and monitor; duplicates auth logic; increases operational overhead for self-hosters. | Rejected for v1.x; reconsider for enterprise v2. |
| **Option B: WebSocket Embedded in Fastify API (Recommended)** | Embed `@fastify/websocket` directly into `apps/api`, sharing existing session auth, DB connection, and Redis client. | Zero extra containers; reuses Fastify auth middleware and database connection; seamless deployment for self-hosters. | Process handles both HTTP and long-lived WebSocket connections. | **SELECTED (Optimal for Modular Monolith)** |
| **Option C: Dedicated Nginx/Envoy Collaboration Gateway** | Reverse proxy handles socket termination and routes to backend. | Standard edge routing. | Still requires an application-level WebSocket handler behind the proxy. | Complementary to Option B. |
| **Option D: Redis-Backed Yjs Pub/Sub Synchronization** | Instances publish doc updates to Redis channels (`yjs:doc:<id>`); peer instances broadcast to their local sockets. | Enables horizontal scaling across multiple API containers; seamless rolling restarts without dropping user state. | Requires Redis availability (already a production dependency of Vibress). | **MANDATORY FOR SCALING** |
| **Option E: PostgreSQL Snapshot & Compaction Engine** | Store incremental updates in a log table; periodically compact into a single binary snapshot in the document table. | Immune to server crashes; bounded storage; instant document initialization for late joiners. | Requires background compaction worker. | **MANDATORY FOR DURABILITY** |

---

## 3. Database Design

```sql
-- 1. Document CRDT Snapshots (Compacted full document state)
CREATE TABLE post_crdt_snapshots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  snapshot BYTEA NOT NULL, -- Binary encoded Y.Doc state vector (encodeStateAsUpdate)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT post_crdt_snapshots_unique UNIQUE (publication_id, post_id)
);

CREATE INDEX post_crdt_snapshots_post_idx ON post_crdt_snapshots (post_id);

-- 2. Incremental CRDT Update Log (Append-only delta log)
CREATE TABLE post_crdt_updates (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  update_data BYTEA NOT NULL, -- Binary Yjs update delta
  sequence_number BIGSERIAL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX post_crdt_updates_lookup_idx ON post_crdt_updates (post_id, sequence_number ASC);
```

---

## 4. Redis Architecture & Multi-Instance Pub/Sub

To support horizontal scaling where Editor A connects to `api-pod-1` and Editor B connects to `api-pod-2`:

```
┌─────────────────────────────────┐           ┌─────────────────────────────────┐
│        API POD 1 (Fastify)      │           │        API POD 2 (Fastify)      │
│  User A connected via WebSocket │           │  User B connected via WebSocket │
└────────────────┬────────────────┘           └────────────────▲────────────────┘
                 │                                             │
                 │ PUBLISH yjs:doc:<post_id>                   │ SUBSCRIBE yjs:doc:<post_id>
                 ▼                                             │
      ┌────────────────────────────────────────────────────────┴───────┐
      │                         REDIS PUB/SUB                          │
      │   Channel: `vibress:collab:<publicationId>:<postId>:updates`   │
      │   Channel: `vibress:collab:<publicationId>:<postId>:awareness` │
      └────────────────────────────────────────────────────────────────┘
```

### Redis Key Structure
1. `vibress:collab:presence:<postId>`: Redis Hash storing active client IDs, user metadata, and timestamps with a 30-second TTL.
2. `vibress:collab:<publicationId>:<postId>:updates`: Pub/Sub channel for distributing Yjs binary deltas.
3. `vibress:collab:<publicationId>:<postId>:awareness`: Pub/Sub channel for distributing cursor coordinates and selections.

---

## 5. WebSocket Protocol Specification

### Connection URL
```
wss://<host>/api/v1/collaboration/posts/:postId?token=<session_token>
```

### Handshake & Authentication Lifecycle
1. **Client Handshake**: Client initiates WebSocket upgrade passing the staff session token in query parameter `token` or cookie `vibress_session`.
2. **Authentication Gate**: Server resolves session via `authService.resolveSession(token)`. If invalid or expired, socket closes immediately with code `4401 (Unauthorized)`.
3. **Authorization Gate**: Server verifies that `req.user` has `posts.edit` permission and belongs to the publication owning `:postId`. If unauthorized, socket closes with code `4403 (Forbidden)`.
4. **State Vector Exchange (Sync Step 1)**:
   - Server loads latest snapshot + pending updates from PostgreSQL into a temporary `Y.Doc`.
   - Server sends `SyncStep1` containing server's State Vector (`Y.encodeStateVector(doc)`).
   - Client replies with `SyncStep2` (missing client updates).
   - Server sends `SyncStep2` (missing server updates).
   - Document is now synchronized.

### Binary Message Protocol
All WebSocket messages are transmitted as binary ArrayBuffers prefixed by a 1-byte message type header:

| Type Byte | Message Name | Payload Content | Direction |
| :--- | :--- | :--- | :--- |
| `0x00` | `SYNC_STEP_1` | Encoded State Vector | Server ↔ Client |
| `0x01` | `SYNC_STEP_2` | Encoded Missing Updates | Server ↔ Client |
| `0x02` | `SYNC_UPDATE` | Incremental CRDT Update Delta | Server ↔ Client |
| `0x03` | `AWARENESS` | Encoded Yjs Awareness Protocol State (Cursor/Selection) | Server ↔ Client |
| `0x04` | `HEARTBEAT` | Ping/Pong keep-alive timestamp | Client → Server |

---

## 6. Persistence & Compaction Engine

1. **Incremental Log Flush**:
   - Updates received over WebSockets are buffered in memory and flushed in batches to `post_crdt_updates` every **2 seconds** or when the buffer reaches **50 updates**.
2. **Periodic Compaction**:
   - When `post_crdt_updates` for a post exceeds **200 rows**, a BullMQ background job compacts the log:
     ```ts
     const updates = await fetchAllUpdates(postId);
     const doc = new Y.Doc();
     updates.forEach(u => Y.applyUpdate(doc, u));
     const compactedSnapshot = Y.encodeStateAsUpdate(doc);
     await saveSnapshot(postId, compactedSnapshot);
     await deleteUpdatesOlderThan(postId, lastCompactedSeq);
     ```
3. **Autosave Bridge**:
   - Studio's HTML/JSON document (`posts.content`) is periodically reconstructed from the Yjs doc and updated in `posts.content` to keep public read rendering in sync without lag.

---

## 7. Client Integration in Admin Studio

In `apps/admin/src/components/PostEditor.tsx`:
```tsx
const collabConfig = useMemo(() => {
  if (!postId) return undefined;
  return {
    id: postId,
    providerFactory: (id: string, yjsDoc: Y.Doc) => {
      return new WebSocketCollaborationProvider(yjsDoc, {
        url: `${getWsBaseUrl()}/api/v1/collaboration/posts/${id}`,
        docId: id,
        authToken: getSessionToken(),
        user: {
          id: currentUser.id,
          name: currentUser.name,
          color: getUserColor(currentUser.id),
        },
      });
    },
    user: {
      name: currentUser.name,
      color: getUserColor(currentUser.id),
    },
  };
}, [postId, currentUser]);

return (
  <VibressStudio
    value={studioDoc}
    collaboration={collabConfig}
    onChange={handleDocChange}
  />
);
```

---

## 8. Failure Modes & Resilience Plan

| Failure Scenario | Impact | System Response & Recovery |
| :--- | :--- | :--- |
| **Temporary Client Network Drop** | Socket closes abruptly. | Client buffers edits in local Yjs doc; attempts exponential backoff reconnect. On reconnect, SyncStep1/SyncStep2 exchanges missed deltas conflict-free. |
| **API Container Crash / Restart** | All active sockets drop. | Nginx gateway routes reconnects to healthy containers. Document state is rehydrated from `post_crdt_snapshots` + `post_crdt_updates` without data loss. |
| **Redis Outage** | Cross-instance sync pauses. | Local clients connected to the same instance continue editing. Changes persist to PostgreSQL. Cross-pod synchronization resumes immediately upon Redis reconnection. |
| **Simultaneous Conflicting Edits** | Users edit same sentence. | Yjs CRDT mathematically converges to an identical state on all clients deterministically without merge conflicts or data loss. |

---

## 9. End-to-End Test Plan (Playwright Dual-Browser Verification)

A true E2E test verifying real-time synchronization must be implemented in `tests/e2e/collaboration-dual-browser.test.ts`:
1. Launch two independent Playwright browser contexts (`contextA`, `contextB`) representing Editor Alice and Editor Bob.
2. Both editors log in and navigate to the same post edit URL (`/admin/posts/:postId`).
3. Assert Alice sees Bob's avatar badge and cursor presence in the Studio status bar.
4. Alice types `"The swift fox jumps"` in Block 1.
5. Assert Bob's editor renders `"The swift fox jumps"` in Block 1 within **150ms** without reloading the page.
6. Bob types `" over the lazy dog."` at the end of Alice's sentence simultaneously.
7. Assert both browsers converge to `"The swift fox jumps over the lazy dog."`.
8. Simulate a network kill on Alice for 5 seconds while Bob continues typing.
9. Restore Alice's connection and assert full mutual convergence within **1 second**.
