# Architecture Decisions

## ADR-001: Modular monolith

**Decision:** Build Vibress as a modular monolith.

**Reason:** Lower operational complexity while preserving strong domain boundaries and future extraction paths.

## ADR-002: TypeScript everywhere

**Decision:** Use TypeScript for backend, frontend, workers, SDKs, and Studio.

**Reason:** Shared types, tooling consistency, safer contracts.

## ADR-003: PostgreSQL + Drizzle

**Decision:** PostgreSQL is the primary database and Drizzle is the preferred typed SQL layer.

**Reason:** Strong relational semantics and controlled SQL behavior.

## ADR-004: Vibress Studio is a separate product

**Decision:** Editor packages live in an independent repository.

**Reason:** Prevent core/editor coupling and allow reuse/versioning.

## ADR-005: Structured document is canonical

**Decision:** Store versioned Studio document JSON as canonical editable content.

**Reason:** Supports web/email/Markdown/rendering without tying stored content to one HTML renderer.

## ADR-006: Storage is provider-agnostic

**Decision:** Core uses `StorageProvider`; S3-compatible providers use one adapter plus presets.

**Reason:** Avoid vendor lock-in and duplicated implementations.

## ADR-007: Plugin access only through SDK

**Decision:** Plugins cannot import private Vibress internals.

**Reason:** Upgrade safety and explicit security boundaries.

## ADR-008: Queue heavy work

**Decision:** Long-running and side-effect-heavy tasks run in workers via BullMQ.

**Reason:** Protect API latency and improve retries/idempotency.

## ADR-009: Events decouple side effects

**Decision:** Domain state changes emit events; important async delivery uses an outbox.

**Reason:** Prevent hidden coupling and lost side effects.

## ADR-010: Security platform package

**Decision:** Shared security primitives live in a dedicated package.

**Reason:** Consistent SSRF, CSRF, encryption, rate limiting, token, upload, and sanitization behavior.

## ADR-011: Unified development port

**Decision:** Use `7777` as the canonical Vibress development gateway, with internal application ports allocated sequentially from `7778` to `7782`.

**Reason:** A single predictable development origin simplifies routing, cookies, sessions, OAuth, CORS, and developer workflow.

See `ADR-011-development-ports.md`.

## ADR-012: Database transaction strategy

**Decision:** Use an AsyncLocalStorage-based transaction context in `@vibress/database`; application use cases wrap multi-record workflows in `runInTransaction(work)`, and `getDb()` transparently returns the transaction-scoped executor while active.

**Reason:** Virtually every repository accesses the database through `getDb()`; the ALS approach lets existing repositories join the active transaction automatically without threading Drizzle types through public domain contracts.

See `ADR-012-transaction-strategy.md`.

## ADR-014: Billing provider boundary

**Decision:** Member ID is the subscription identity; billing lives behind a
provider-neutral `BillingProvider` abstraction with Stripe as the first
adapter; provider-hosted checkout; signed webhooks are the authority for
external payment facts with durable deduplication and out-of-order protection.

**Reason:** Keep Vibress subscription truth provider-independent and replaceable.

See `billing-provider-boundary.md`.

## ADR-015: Email provider boundary

**Decision:** Newsletters (content/audience/sends) and Email (delivery/
suppression/webhooks) are separate domains behind a provider-neutral
`EmailProvider` abstraction; SMTP/Mailpit is the first adapter; Studio JSON is
the canonical email content source; suppression policy lives in the Email
domain.

**Reason:** Keep delivery provider-independent and delivery truth Vibress-owned.

See `email-provider-boundary.md`.

## ADR-016: Community boundary

**Decision:** Comments belong to member identity with plain-text sanitized
bodies and bounded threading; notifications are durable and
transport-independent behind a NotificationSink interface; recommendations are
SSRF-hardened managed records with lightweight event attribution.

**Reason:** Keep the engagement layer bounded, identity-safe, and SSRF-safe.

See `community-boundary.md`.

## ADR-017: Plugin trust model

**Decision:** Plugins are trusted bundled code using only the plugin SDK with
validated manifests and explicit capabilities; integrations, API keys,
webhooks, and plugins remain distinct concepts; outbound webhooks use the
SSRF-hardened client with HMAC signing.

**Reason:** Extensibility without arbitrary-code or SSRF risk.

See `plugin-trust-model.md`.

## ADR-018: Analytics, search & automation boundary

**Decision:** Analytics is asynchronous and never a transactional dependency;
PostgreSQL/pg_trgm is the initial search backend behind a swappable boundary
with event-driven indexing and restricted-content verification; automations
are durable, immutable-versioned, declarative-only, and loop-safe with
idempotent runs.

**Reason:** Measurement/discovery/workflow without coupling, leakage, or
arbitrary-code risk.

See `analytics-search-automation-boundary.md`.

## ADR-019: Settings & system tools boundary

**Decision:** Typed namespaced settings with explicit classification and
masked secrets; append-only redacted audit with filters; versioned job-based
import/export with zip-slip/bomb defense and secret exclusion; managed
loop-safe redirects; diagnostics + bounded maintenance with no shell/SQL.

**Reason:** Operability without unrestricted admin capabilities.

See `settings-system-tools-boundary.md`.
