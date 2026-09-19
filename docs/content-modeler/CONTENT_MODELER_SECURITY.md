# Vibress Content Modeler — Security & Publication Isolation

Security, data privacy, and multi-tenant publication isolation are foundational principles of the Vibress Content Modeler.

---

## 1. Publication Isolation Strategy

Every content model and entry is bound to a `publication_id`:
- **Database Schema**:
  - `content_models(id, publication_id, slug, ...)` with unique constraint `UNIQUE(publication_id, slug)`
  - `content_entries(id, publication_id, model_id, slug, ...)` with partial unique index `(model_id, slug) WHERE deleted_at IS NULL`
  - Composite Foreign Key: `(model_id, publication_id) -> content_models(id, publication_id)` ensuring an entry can never point to a model owned by a different publication.
- **Application Services**:
  - Every operation (`list`, `get`, `create`, `update`, `delete`, `publish`, `archive`) takes a mandatory `publicationId` derived from the verified user session or verified domain host header.
  - Cross-publication reads and mutations are rejected with strict 404/400 errors.

---

## 2. API Visibility & Public Data Leakage Protection

Fields have a granular `apiVisibility` setting:
- `public`: Exposed on public collection endpoints.
- `authenticated`: Exposed only to authenticated members/users.
- `private`: Strictly internal to staff editors; filtered out before any public serialization.

The centralized `filterEntryDataForVisibility()` pipeline ensures internal metadata, secrets, and private operational data are never leaked to public API callers or Liquid themes.

---

## 3. Adversarial Security Test Suite

The test suite in `apps/api/src/__tests__/content-models-adversarial-publication-isolation.test.ts` executes automated adversarial attacks:
1. Publication A cannot list or read Publication B models.
2. Publication A cannot update (`PUT`/`PATCH`) or delete Publication B models.
3. Publication A cannot read, create, update, or delete Publication B entries.
4. Publication A cannot publish or archive Publication B entries.
5. Cross-publication relations are blocked and safely filtered.
6. Public API callers cannot view private fields or access non-tenant collections.
