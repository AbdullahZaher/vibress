# VIBRESS — TEST QUALITY & VERIFICATION AUDIT
## Forensic Evaluation of Test Assertions, Mock Fidelities & Required Verification Gates

---

## 1. Executive Summary

A raw count of passing tests (over 1,200 unit and integration tests across 71 packages) creates an illusion of complete verification.  
A deep forensic inspection reveals that **several critical integration surfaces rely on shallow assertions, in-memory mocks, or circular logic that mask missing runtime infrastructure**.

### Principal Audit Findings:
1. **The Collaboration Test Illusion**: Tests claiming to verify "Real-Time CRDT Document Synchronization" only verify in-process memory sharing between two Lexical instances inside the Vitest runner. Real WebSocket communication, network latency, and server persistence are 100% untested.
2. **The Tenant Isolation Test Illusion**: Tests claiming to verify "Tenant Isolation Matrix & Boundary Enforcement" run against an in-memory mock repository (`InMemoryWorkspaceRepository`). They execute zero SQL queries and never test the actual database or API routes.
3. **The Extension Host Test Illusion**: The plugin extension host test asserts that `executeHook()` resolves successfully, but the source code under test simply returns a hardcoded mock object `{ executed: true }` without running any plugin code.
4. **Solid, Trustworthy Test Suites**: In contrast, the authentication lifecycle, theme zip validator, What's New system, and transactional outbox test suites run against real cryptographic operations, real zip archives, and real PostgreSQL database transactions.

---

## 2. Test Quality Reality Matrix

| Feature / Subsystem | Test File Path | What It Claims | What It Actually Proves | Missing Proof / Gap | Required New Test |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Real-Time CRDT Collaboration** | `packages/studio-react/src/__tests__/crdt-collaboration.test.ts` | "Studio Real-Time CRDT Collaboration (Yjs) multi-user simultaneous convergence" | Two Lexical instances in the same Node.js Vitest process can sync via an in-memory JS `Map` (`documentHubs`). | • WebSocket transport<br>• Network disconnect/reconnect<br>• Server-side CRDT persistence<br>• Two independent browser processes | Multi-browser Playwright test with network latency and socket drops (`tests/e2e/collaboration-dual-browser.test.ts`). |
| **Tenant Isolation & Boundaries** | `packages/domains/workspaces/src/__tests__/tenant-isolation.test.ts` | "Tenancy boundary enforcement & publication isolation" | `WorkspaceService` throws `TenantAccessDeniedError` when fed mismatched parameters using an in-memory mock. | • Database query filtering<br>• Foreign key constraints<br>• Cross-publication API IDOR attempts<br>• Search index bleed | Real PostgreSQL cross-tenant attack test suite (`tests/integration/tenant-isolation-boundary.test.ts`). |
| **Plugin Extension Host** | `packages/plugin-core/src/__tests__/extension-host.test.ts` | "Executes plugin hook across isolated host boundary" | Calling a stubbed method returns `{ executed: true }`. | • Worker thread / process spawning<br>• Code execution inside sandbox<br>• Memory quota enforcement<br>• Crash isolation | True worker thread execution test with CPU and memory limits (`tests/integration/plugin-worker-host.test.ts`). |
| **Plugin VM Sandbox** | `packages/plugin-core/src/__tests__/sandbox.test.ts` | "Secure sandboxed execution of plugin code" | Basic arithmetic (`1 + 1`) runs inside Node.js `node:vm`. | • Security boundary resistance<br>• Prototype escape vulnerability | Security exploit test proving `node:vm` prototype breakout (`tests/security/vm-sandbox-exploit.test.ts`). |
| **Search Engine & Ranking** | `packages/domains/search/src/__tests__/search-service.test.ts` | "Full-text search ranking and fuzzy discovery" | Calling the mock repository returns dummy search result items. | • Real PostgreSQL `pg_trgm` GIN index scans<br>• Concurrency under write load<br>• Multi-word ranking accuracy | Real database search benchmark and ranking accuracy test on 10,000 documents. |
| **Staff Invitations & Password Reset** | `apps/api/src/__tests__/auth-lifecycle.test.ts` | "Complete staff auth lifecycle with token hashing & session invalidation" | **REAL PROOF**: Runs against real database, tests Argon2id, verifies token hashing, checks single-use invalidation. | None (High fidelity test). | Maintain current suite; add brute-force rate limit test. |
| **Theme Zip Validation** | `packages/theme-core/src/__tests__/zip-validator.test.ts` | "Theme security, zip slip, and zip bomb prevention" | **REAL PROOF**: Constructs real malformed zip buffers, tests magic bytes, CRC32, path traversal, and decompression bombs. | None (Outstanding test fidelity). | Maintain current suite. |
| **What's New System** | `packages/utils/src/__tests__/whats-new-selector.test.ts` & `tests/e2e/whats-new.test.ts` | "Remote feed parsing, SemVer filtering, single-card display, and DB dismissal" | **REAL PROOF**: Comprehensive unit tests + browser E2E test verifying single-card UX and DB persistence. | None (High fidelity test). | Maintain current suite. |
| **Transactional Outbox** | `packages/events/src/__tests__/outbox-dispatcher.test.ts` | "Reliable transactional outbox claiming, backoff, and stale recovery" | **REAL PROOF**: Verifies `SKIP LOCKED` concurrency, exponential backoff, and 60s stale claim recovery against PostgreSQL. | Multi-worker concurrent race test. | Stress test with 5 concurrent dispatchers competing for 1,000 outbox rows. |
| **Stripe Webhooks & Dedup** | `apps/api/src/__tests__/billing-webhooks.test.ts` | "Stripe signature verification & SHA-256 deduplication" | **REAL PROOF**: Tests raw buffer signature validation, replay rejection, and database state transitions. | None (High fidelity test). | Maintain current suite. |
| **Performance Baseline** | `apps/api/src/__tests__/performance-baseline.test.ts` | "High-throughput API performance benchmark" | Executes 100 sequential HTTP requests against local Fastify instance. | High concurrency (e.g. 50 concurrent connections over 30s); measures latency distribution (P50, P95, P99). | Load test using `autocannon` or `k6` measuring sustained RPS and P99 latency. |

---

## 3. Required Verification Roadmap

### Mandatory New Test Suites
1. **Dual-Browser Real-Time Collaboration Spec**:
   - Must use Playwright to launch two independent browsers.
   - Must verify real-time typing propagation over WebSockets.
2. **Cross-Tenant Attack Spec**:
   - Must verify that User A cannot read, mutate, or search User B's resources across publications.
3. **VM Escape Proof-of-Concept Test**:
   - Must assert that untrusted code cannot be executed via `node:vm` in production.
4. **Soft-Deleted Slug Regression Test**:
   - Must create a post, soft-delete it, and assert that a new post can immediately be created with the same slug.
