# Versioned extension storage and runtime schema contract — proposed vNext RFC

**Status:** ACCEPTED AS DESIGN DIRECTION, NOT A SHIPPED SDK/API — scoped named-model typed repositories and public runtime-schema adapter; final ABI, SQL and named operations subject to EXT-004/201/203 reviews/tests. [ADR](../adr/2026-10-19-external-extension-host-vnext.md). Current external plugins cannot call the interfaces below.

## Design decision

**Use a host-mediated, namespace-bound, publication-scoped, typed repository service with a scoped unit-of-work.** Plugin code never imports `@vibress/database`, `@vibress/api-contracts` internal implementation, Fastify instances or private domain modules. It never receives a raw SQL connection, unrestricted Drizzle transaction, or writable publication context. This is intended for **trusted operator-installed code**, not a sandbox against malicious Node.js modules.

An independently released plugin registers a **versioned data descriptor** with its trusted package: plugin ID, model IDs, runtime record/create/update validation schemas, bounded indexed lookup operations, read/write capability requirements, migration head and constraints. The operator-reviewed forward-only migrations create plugin-owned namespaced tables and enforce composite publication/course FKs. The host validates descriptor and artifact digest on admission; applies migrations during a dedicated locked upgrade phase, not during normal requests.

## Candidate public SDK interface (illustrative; no callable exports today)

```ts
type RuntimeSchema<T> = { parse(value: unknown): T };
type RecordV1 = { id: string; version: number; status: "draft" | "published" };
type CreateV1 = { id: string; status: "draft" | "published" };
type CursorPage<T> = { items: readonly T[]; nextCursor?: string };

interface ScopedRepository<Create, RecordType> {
  get(id: string): Promise<RecordType | null>;
  list(query: { limit: number; cursor?: string }): Promise<CursorPage<RecordType>>;
  create(data: Create): Promise<RecordType>;
  update(id: string, expectedVersion: number, patch: Partial<Create>): Promise<RecordType>;
}
interface ScopedUnitOfWork<Repositories> {
  run<T>(callback: (repos: Repositories) => Promise<T>): Promise<T>;
}
type RegisteredCourseStore = { courses: ScopedRepository<CreateV1, RecordV1> };
type RegisteredCourseSchemas = {
  create: RuntimeSchema<CreateV1>;
  record: RuntimeSchema<RecordV1>;
};
```

This is an API **contract illustration**, not an executable/general ORM. The final SDK must add **named, pre-registered relational queries**, unique-key operations, idempotency, paginated read filters and typed insert/transaction support for multiple related rows. No `unknown`/raw transaction escape hatches or unvalidated arbitrary SQL. The input `parse(value: unknown)` is deliberately a validation boundary, not an untyped public output.

## Mandatory runtime enforcement

1. **Admission:** host verifies the artifact from an external operator-trusted checksum/signature, plugin ID and schema descriptor versions, declared operations and capabilities, migration head, safe model names, and runtime schema bounds. It rejects duplicate, mismatched or unregistered models.
2. **Scope:** host resolves tenant and principal from authenticated Staff/Member/site context. Every repository/query/transaction injects the authoritative publication predicate; APIs cannot trust caller-supplied publication, Member or role IDs. It validates Member/publication equality separately from Member session authentication.
3. **Authorization:** host checks capability for each actual operation, while LMS domain checks course/lesson/enrollment ownership, status and entitlements. TypeScript signatures are not runtime authorization.
4. **Validation:** plugin route schemas use a **public SDK runtime-schema contract** and are bundled with the immutable plugin artifact. Host registers/adapts them into its existing `@vibress/api-contracts` Zod validation pipeline for params/query/body/responses and stable errors. No private core imports from the plugin repo. Preserve versioned endpoints and request IDs.
5. **Transactions:** the callback only receives registered, scoped typed repositories; no raw database driver or DDL. Enforce bounded time, explicit isolation/deadlock retry policy, idempotent conflicts and transactional outbox for side effects.
6. **References:** reviewed SQL enforces section/lesson/enrollment/progress publication **and course** composite FKs; exposed operations reject invalid references. Core `members` lacks composite UNIQUE(publication_id,id); do not declare an impossible FK without additive core migration, use authoritative Member service and deletion reconciliation.
7. **Upgrade:** immutable forward migrations, registered checksums, locks, nonempty backfills, rollback/restore runbook, fresh-install and legacy-fixture tests. On disable, stop admission and preserve all data.

## Acceptance and owner

- Independent example extension compiles against the **public** SDK only and passes host runtime Zod adapter tests, including malformed input/output and schema mismatch.
- Two-publication and two-course adversarial tests: reject spoofed tenant, cross-course FK, wrong Member, invalid nested filter, unregistered model and unauthorized operation.
- Verify a scoped transaction cannot access another namespace or raw SQL, and is atomic across enrollment/progress/outbox under retry/duplicate events.
- Confirm migration checksum mismatch, restart, partial failure and populated upgrades fail safely; multi-node admission consistent.
- Sign off RFC and publish SDK types with conformance suite before marking EXT-004/203 complete.

**Owners:** Architect, Security Reviewer, DB/Migration Engineer, API Designer, QA. This closes the *documentation design gap*, not implementation readiness.
