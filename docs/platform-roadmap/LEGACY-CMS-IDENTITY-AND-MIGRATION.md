# Legacy CMS → Universal Application Identity Migration

> **Proposed migration design, not an executed schema change.** Current sources: [Content Modeler](../../packages/domains/content-modeler/src/application/content-modeler-service.ts), [content model schema](../../packages/database/src/schema/content-models.ts), [dependency rules](../01-architecture/dependency-rules.md), [Studio readiness](https://github.com/AbdullahZaher/vibress-studio/blob/main/docs/production-readiness.md).

## Identity must not be renamed in place

A `Publication` remains a CMS business concept and is **not** automatically a universal `Application` or `Tenant`. A supported v1 migration may map one existing multi-publication **CMS installation** to one versioned `Application` and its `Installation`, retaining multiple legacy publications and membership rules inside the CMS module. A new independent CRM installation must not import posts/publications/newsletters or accept a `pub_default` fallback.

| Existing surface | Compatibility and data migration rule |
| --- | --- |
| `publication_id` / `pub_default` | Retain only inside a verified CMS compatibility adapter; no implicit substitution for Application/Tenant IDs. |
| Publication memberships/roles/plans | Preserve server-verified authorization, subscription/payment ownership, idempotency, distinct Principal/Tenant scopes. |
| Content model definitions, entries and relations | Preserve IDs, relation graphs, required indexes, locale, draft/publish state and historical schema versions. |
| Lexical Studio, saved JSON, Yjs/offline updates | Preserve document schema/roundtrip and collaborative update compatibility using pinned host+Studio fixtures. |
| Themes, media, storage URLs and slugs | Preserve public routes, signed links, assets, redirects and duplicate-slug behavior unless explicitly approved. |
| Outbox/jobs/webhooks/audit | Preserve event ordering/idempotency and publication ownership of delayed jobs and historic audit context. |
| Existing database migrations/plugin tables | Use additive, reviewed evolution with approved installer roles, checksum validation and restore/forward-fix; never rewrite a released migration. |

## Two executable reference fixtures

**A. Upgrade of existing multi-publication CMS.** Seed at least two real-ish publications plus any `pub_default` fallback cases, overlapping slugs, members, paid plans, localized entries, media, draft content, editor docs and delayed outbox items. Verify new Application metadata does not alter the existing publication graph. Run old/new API and worker compatibility as supported, and verify no cross-publication data exposure, lost media links, payment duplications or Studio document round-trip drift.

**B. Clean independent CRM.** Boot one new Application/Installation with Customers, Deals and Activities, its own database credentials and Redis/storage policy. No publication dependencies or hidden global defaults; tenant security and client/API/admin/custom business action must work using public SDK, without kernel modification.

## Migration algorithm (proposal; requires ADR sign-off)

1. Inventory current IDs, publication ownership, media/storage references, membership and payment invariants, message backlog, schema/checksum and roles.
2. Approve an explicit mapping table / compatibility adapter. Reject ambiguous joins or accidental substitution between `application_id`, `tenant_id`, `publication_id`.
3. Introduce additive application/installation metadata and verify backward-compatible read/write; define whether dual-read/write is needed and its consistency rules.
4. Backfill in bounded idempotent batches with reference integrity, old/new version compatibility and operator-visible progress/abort.
5. Check two-publication fixtures, scoped access, edit/collaboration, URLs, media, billing, queue replay and restoration on actual PostgreSQL role policies.
6. Promote with a compatibility window; remove old implicit defaults only after verified migration and documented rollback/forward-fix. Never promise arbitrary zero-loss downgrade.

## Existing Epics and mandatory gates

- **M00-E04:** pin source SHAs and baseline multi-publication fixtures.
- **M01-E05:** versioned identity mapping and adapters, no CMS imports from kernel.
- **M02-E08/E09:** scoped authorization and policy migration with no cross-publication leakage.
- **M03-E09:** additive schema, backfill checksums, upgrade/restore.
- **M08-E02:** independent compatibility acceptance before GA.

**Status: design only.** No migration, content deletion or publication reassignment is performed by this documentation PR.
