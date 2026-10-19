# Extension identity, scoped data and migration contract RFC

**Status:** ACCEPTED AS DESIGN — host principal binding, publication isolation, guarded legacy migration. Not a callable current API; runtime/DB tests pending EXT-202/203. [ADR](../adr/2026-10-19-external-extension-host-vnext.md).

## Principals and authoritative publication binding

1. **Admin:** host validates staff session, `requirePermission`, publication membership/context and `validateOrigin` for mutations **before** extension dispatch. Platform operator functions use separately declared elevated operator permissions.
2. **Member:** `requireMemberSession` returns a Member, but this middleware alone does **not** establish the site's publication match. Resolve the publication from the verified site/route context, verify `member.publicationId === publicationId` **server-side**, and reject on missing/mismatch. Existing `member-auth` resolves a Member session without this assertion; extension dispatcher MUST add it. For mutations also invoke the existing `validateMemberOrigin` semantics with the host's configured allowed origins.
3. **Public:** resolve publication by validated host/site routing and its privacy policy (the current global `/api/content/v1` pre-handler only covers that prefix); extension routes outside it MUST apply equivalent publication/privacy controls. Anonymous public consumers never gain Member permissions through a spoofed header.
4. **Machine/jobs:** derive principal/scope from validated API key or signed, durable, host-created job envelope containing publication, actor type and permission provenance. On replay/dispatch revalidate enabled plugin, current scope and revocation where relevant.
5. **Never** accept `publicationId`, `memberId` or role from route body/query/headers as authentication. Nested references (course, lesson, enrollment) are looked up using host scope in the same SQL predicate or typed repository method; mismatch uses privacy-preserving not-found.
6. **Server-owned caches:** cache keys partition by publication, actor, locale, access policy version and data revision. Protected responses must use private/no-store by default; do not share SSR/edge caches between learners.

### Example *conceptual* context (not SDK code)

```ts
type StaffActor = { kind: "staff"; id: string; publicationId: string; permissions: readonly string[] };
type MemberActor = { kind: "member"; id: string; publicationId: string };
type PublicActor = { kind: "public"; publicationId: string };
type MachineActor = { kind: "machine"; id: string; publicationId?: string; scopes: readonly string[] };
type ExtensionActor = StaffActor | MemberActor | PublicActor | MachineActor;
```

The real API uses opaque/branded scopes where practical. Every service must enforce its permissions in runtime code. Granting `publicationId` in a type is not proof of authorization.

## Typed data access boundary — chosen contract, pending code

**Design choice:** [namespace-bound typed scoped repositories and runtime-schema admission](external-extensions-storage-contract.md). Keep the ABI proposed until implemented/tested. Do not interpret conceptual signatures as SDK exports.

- **Recommended:** host-mediated namespace-bound *typed repository registration* using reviewed table descriptors, operations and query builders, with publication predicate injection and no raw SQL; host runs migrations and owns its privileged DB handle.
- Domain plugins may declare tables, constraints, migrations and named operations; the host exposes only permission-gated scoped methods, e.g. `courses.getById(scope, id)`, `enrollments.createUnique(scope, input)`. Never pass raw Drizzle connection or unrestricted `transaction(callback(tx: unknown))` to an untrusted extension context. A transaction API, if approved, must operate through **scoped typed repositories** within one publication.
- Table namespace owned by immutable plugin ID; table names/migration contents audited as **trusted operator-installed code**. Namespaces do not isolate arbitrary JS execution; Postgres roles, table ACLs and processes require separate architecture for untrusted plugins.
- Member reference validation uses a host-verified service and transaction-safe policy. The current core `members` table has primary key `id` and an index on `publication_id`, but no composite unique constraint on (`publication_id`, `id`): do **not** document a composite FK to this pair as executable without an additive core migration. If FK is needed, review and generate matching core index/constraint; otherwise use host-mediated member existence/ownership plus durable cleanup/reconciliation.
- **Core remains source of truth** for identity, billing and publication; plugin schema must not shadow or overwrite protected core tables.

## Additive DB migration for legacy plugin metadata

Current `plugins`/`plugin_settings` tables are platform-global. Proposed *new* tables:

| Logical store | Contract |
| --- | --- |
| Installed artifact | Immutable package ID/version/digest/protocol, operator admission and install/migration status |
| Publication activation | Compound (plugin, publication) state, explicit enable/disable timestamps and actor audit |
| Publication settings | Compound (plugin, publication, key), runtime schema, encrypted secrets and rotation |
| Migration ledger | Immutable migration ID/checksum, package head, state, error/retry metadata, lock ownership |

- Migration **does not** infer permission to activate all publications from a legacy platform-wide `active` flag. Preserve legacy behavior for existing bundled packages in a compatibility branch; for new per-publication install default **disabled until explicit publication enablement**.
- Keep legacy global settings in their own namespace/adapter; don't distribute secrets or settings to every publication. Migrating a setting requires operator-approved target, decrypt/re-encrypt validation, audit and ability to resume; no blind backfill.
- Transactional and concurrency rules: check plugin installed/verified → lock migration ledger → apply forward-only additive schema → store outcome → enable only after success; versioned, idempotent, resumable backfills and bounded locks.
- Rollback is not always possible. Restore pinned compatible artifact + coherent DB/file/secret snapshot or forward-fix; never delete records on deactivate or ordinary uninstall.
- Assess release-era migrations and mixed fresh/upgrade states, including indexes, NULLs, existing active plugins, unavailable encryption keys and aborted background tasks.

## Host API placement, errors and validation

Preserve `/api/admin/v1`, `/api/members/v1` and `/api/content/v1` route families and their **different** authentication strategies. Host dispatcher owns route descriptor admission, request body/query/params parsing with shared versioned Zod schemas, auth, publication binding, origin, sizes, rate limits, CORS/privacy, stable `errors[]` shape and request ID. Do not expose raw Fastify instance to extension code. Each route advertises whether anonymous, Member, Staff or Machine access is intended.

## Acceptance matrix

| Case | Expected |
| --- | --- |
| Member from publication B calling publication A endpoint | Denied; no A record/data leak |
| Staff without LMS permission / wrong publication | Denied even when Admin nav link forged |
| Member of A refers to enrollment in A for another learner | Denied; owner check |
| Member/Staff spoof `publicationId` or actor in payload | Ignored as identity; authoritative scope used |
| Disabled plugin or missing migration | No new requests/events/jobs; no data purge |
| Installed legacy plugin | Historical global settings/status available through legacy path; per-publication state explicit |
| Migration partial failure | Plugin not enabled, safe resumption or incident recovery; no destructive down migration |
| HTTP request / async event | Same tenant/principal/capability policies, plus dedup and current enabled-state checks |

**Decision owner:** Security, DB/Migration, API + Plugin Host teams.
