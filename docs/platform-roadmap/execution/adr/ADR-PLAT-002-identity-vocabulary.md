# ADR-PLAT-002 (PROPOSED) — Application / Tenant / Principal Identity Vocabulary

> **Status: PROPOSED. Not reviewed, not accepted.** Owner: **UNASSIGNED**
> (architecture lead with DB/security co-owner).

## Context

The CMS uses `publication_id` and a `pub_default` fallback as its content identity.
The roadmap requires Project, Application, Environment, Installation, Organization,
Tenant, Principal and Publication to be distinct. Reusing `pub_default` as a general
application identity would let a client-influenced CMS value authorize platform data.

## Proposed decision

1. Application and Tenant identity are **branded, server-owned identifiers**. Client
   input may select a resource, never grant scope.
2. `PublicationId` remains a **separate** type. `pub_default` is accepted only by the
   legacy publication adapter, never by application or tenant parsing.
3. A `VerifiedScope` can only be produced by server-side verification of application,
   tenant, principal and membership; callers cannot construct one from a bare id.
4. Principal kinds (`member`, `staff`, `service`, `system`) are explicit, and the
   execution surface (`http`, `worker`, `cli`, `system`) is recorded in the request
   context.

## Rejected alternatives

| Alternative | Why rejected |
| --- | --- |
| Reuse `publication_id` as tenant id | Couples platform identity to CMS content and preserves `pub_default` as a universal fallback |
| Accept `x-tenant-id` / `x-application-id` headers as authority | Client-controlled selector granting authorization |
| A single untyped `string` id | Allows accidental cross-domain assignment; no compile-time separation |

## Consequences

- New platform code cannot import CMS publication modules for identity.
- The CMS keeps working through an adapter that maps its existing publications.
- Identifier validation is centralized; `pub_default` is explicitly rejected.

## Proof required before acceptance

- Contract tests: client-supplied ids cannot create a scope.
- Boundary test: the kernel package has no CMS/publishing imports.
- CMS compatibility fixture still resolves its publications unchanged.

## Evidence in this branch

- `packages/platform-kernel/src/identity.ts` — branded ids, `pub_default` rejected
  for application/tenant/principal.
- `packages/tenancy/src/scope.ts` — `verifyTenantScope` / `resolveVerifiedScope`
  and `assertVerifiedScope`.
- `tests/architecture/platform-boundaries.test.ts` — kernel and tenancy import
  allow-list.
