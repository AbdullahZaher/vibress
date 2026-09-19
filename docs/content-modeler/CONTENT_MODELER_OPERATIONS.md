# Vibress Content Modeler — Operations, Limits & Observability

This document details operational limits, performance boundaries, audit logging, and caching behavior for Content Modeler.

---

## 1. System Limits & Abuse Controls

| Metric | Configured Limit | Enforced Location |
|---|---|---|
| **Max Fields per Model** | `100` fields | `validateModelDefinition` |
| **Max Entry Payload Size** | `1 MB` | `validateEntryData` |
| **Max Relation Depth** | `3` levels | `resolveRelationsForEntry` |
| **Max Public API Page Limit** | `100` items | `GET /api/content/v1/collections/:slug` |
| **Reserved Field Keys** | `id`, `slug`, `title`, `status`, `version`, `createdBy`, `createdAt`, `updatedAt`, `deletedAt`, `data` | `validateModelDefinition` |

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
