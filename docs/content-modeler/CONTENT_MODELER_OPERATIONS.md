# Vibress Content Modeler — Operations, Limits & Observability

This document details operational limits, performance boundaries, audit logging, and caching behavior for Content Modeler.

---

## Admin location and safeguards

- Schema configuration: **Settings → Advanced → Content Models**
  (`/admin/settings/advanced/content-models`). Old admin bookmarks redirect.
- Collection entries remain editorial content under `/admin/collections/:modelSlug`.
- All lifecycle transitions need `posts.publish`, regular edits need `posts.edit`,
  and cookie-authenticated mutations require an allowed Origin.
- Deleting a model containing any entries (including soft-deleted) is blocked.
- Schema changes are previewed; unsafe changes on populated models are rejected
  transactionally. No automatic JSONB backfill or key rename exists.
- Collection listings support pagination, search, status filters and sorting.
- Enabled publication locales drive editor tabs; legacy regional keys remain readable.

---

## 1. System Limits & Abuse Controls

| Metric | Configured Limit | Enforced Location |
|---|---|---|
| **Max Fields per Model** | `100` fields | `validateModelDefinition` |
| **Max Entry Payload Size** | `1 MB` | `validateEntryData` |
| **Max Relation Depth** | `2` levels | `resolveRelationsForEntry` |
| **Max Public API Page Limit** | `100` items | `GET /api/content/v1/collections/:slug` |
| **Reserved Field Keys** | `__proto__`, `constructor`, `prototype` | `validateModelDefinition` |

---

## 2. Audit Logging & Event Dispatches

Every content model and entry lifecycle mutation records:
1. **Audit Event** (`audit_events` table):
   - Actions: `content_model.created`, `content_model.updated`, `content_model.deleted`, `content_entry.created`, `content_entry.updated`, `content_entry.deleted`
   - Metadata: `publicationId`, `actorUserId`, target ID, slug, and status.
2. **Transactional Outbox Event** (`outbox_events` table):
   - Events dispatched asynchronously for downstream indexing, cache invalidation, and webhooks.
3. **In-Memory Domain Event** (`domainEvents`):
   - Dispatches `content.entry.created`, `content.entry.updated`, `content.entry.published`, `content.entry.deleted`.

---

## 3. Caching & Invalidation Strategy

- Public collection queries are cached per `[publicationId, modelSlug, locale, page, limit]`.
- Mutations to models or entries emit outbox and domain events that trigger targeted cache purges for the affected collection and publication, preventing cross-tenant cache pollution.
