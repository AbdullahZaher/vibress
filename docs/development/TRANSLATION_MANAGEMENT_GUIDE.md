# Vibress Translation Management & Editorial UX — Developer Guide

## 1. Overview

The Vibress Translation Management Subsystem provides a first-class, multi-locale editorial management platform integrated directly into Vibress Studio and Admin. Built on top of Vibress's core localization infrastructure (`LocaleRegistry`, `PublicationLocaleResolver`, `translationGroupId`, `ThemeLocaleContext`, localized routing), it delivers end-to-end translation tracking, automated field-level stale content detection, editorial review gates, AI translation safety workflows with terminology glossaries, and high-performance batched matrix queries.

---

## 2. Architecture & Data Model

### 2.1 Database Schema (`content_translations`)

The translation storage is anchored in the `content_translations` table:

```sql
CREATE TABLE IF NOT EXISTS content_translations (
  id TEXT PRIMARY KEY,
  translation_group_id TEXT,
  content_type TEXT NOT NULL,
  content_id TEXT NOT NULL,
  source_locale TEXT NOT NULL,
  target_locale TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  excerpt TEXT,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  meta_title TEXT,
  meta_description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  translation_provider TEXT DEFAULT 'human',
  assigned_translator_id TEXT,
  translation_due_date TIMESTAMP WITH TIME ZONE,
  source_version_at_translation INTEGER NOT NULL DEFAULT 1,
  source_updated_at_translation TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  translated_at TIMESTAMP WITH TIME ZONE,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  reviewed_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

### 2.2 Canonical Translation Statuses & Lifecycle

Vibress clearly delineates between stored database row statuses and synthetic absence states:

#### Stored Database Row Statuses
Translations with an active database record progress through a strictly validated finite state machine (`ALLOWED_STATUS_TRANSITIONS`):

| Status | Meaning | Valid Next Transitions |
|---|---|---|
| `draft` | Translation in progress by translator/author. | `in_progress`, `needs_review`, `translated`, `stale` |
| `in_progress` | Actively being translated or edited. | `draft`, `needs_review`, `translated`, `stale` |
| `needs_review` | Translation submitted or AI generated, awaiting editorial sign-off. | `approved`, `in_progress`, `draft`, `stale` |
| `approved` | Translation reviewed and verified by editor. | `published`, `needs_review`, `draft`, `stale` |
| `published` | Translation publicly live on localized route `/:locale/...`. | `stale`, `needs_review`, `draft`, `approved` |
| `stale` | Source post/page was updated after translation date. Outdated live content. | `in_progress`, `needs_review`, `approved`, `published`, `draft` |

#### Synthetic Matrix/Queue State (No DB Row)
- `missing` (or `untranslated`): Denotes that content exists in the publication's default locale, but no row currently exists in `content_translations` for the target locale. When translation begins, a record is created transitioning into `draft`.

---

## 3. RBAC & Translation Permissions

The system defines 7 granular permissions seeded across system roles:

```ts
export const SYSTEM_PERMISSIONS = [
  { key: "translations.read", name: "Read Translations", category: "content" },
  { key: "translations.create", name: "Create Translations", category: "content" },
  { key: "translations.edit", name: "Edit Translations", category: "content" },
  { key: "translations.review", name: "Review Translations", category: "content" },
  { key: "translations.approve", name: "Approve Translations", category: "content" },
  { key: "translations.publish", name: "Publish Translations", category: "content" },
  { key: "translations.manage", name: "Manage Translation System", category: "content" },
];
```

### Role Assignment Matrix

| Permission | Owner | Administrator | Editor | Author | Contributor |
|---|:---:|:---:|:---:|:---:|:---:|
| `translations.read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `translations.create` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `translations.edit` | ✅ | ✅ | ✅ | ✅ (Own) | ❌ |
| `translations.review` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `translations.approve` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `translations.publish` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `translations.manage` | ✅ | ✅ | ❌ | ❌ | ❌ |

---

## 4. REST API Endpoints (`/api/admin/v1`) — 12 Fastify Endpoints

All 12 endpoints are registered under `/api/admin/v1`:

| # | Method | Route | Permission Required | Description |
|---|---|---|---|---|
| 1 | `GET` | `/translations/matrix` | `translations.read` | High-performance batched multi-locale matrix grid. |
| 2 | `GET` | `/translations/queue` | `translations.read` | Prioritized editorial queue (stale, needs review, missing). |
| 3 | `GET` | `/translations/health` | `translations.read` | Publication coverage percentages & per-locale metrics. |
| 4 | `GET` | `/translations/:id` | `translations.read` | Translation detail + source content snapshot + field-level diff. |
| 5 | `GET` | `/content/:type/:id/translations` | `translations.read` | All translations for a given post or page. |
| 6 | `POST` | `/content/:type/:id/translations` | `translations.create` | Create a new translation entry. |
| 7 | `PATCH` | `/translations/:id` | `translations.edit` | Update translation fields (title, slug, content, SEO) with optimistic concurrency. |
| 8 | `POST` | `/translations/:id/submit-review` | `translations.edit` | Transition translation to `needs_review`. |
| 9 | `POST` | `/translations/:id/approve` | `translations.approve` | Transition translation to `approved`. |
| 10 | `POST` | `/translations/:id/publish` | `translations.publish` | Transition translation to `published`. |
| 11 | `POST` | `/content/:type/:id/ai-translate` | `translations.create` | AI draft generator with glossary injection (guaranteed `needs_review` status). |
| 12 | `POST` | `/translations/bulk` | Action-specific guards | Hardened bulk operations validating item permissions and status transitions per row. |

---

## 5. Security & Concurrency Hardening

### 5.1 Hardened Bulk Operations
The `POST /translations/bulk` endpoint enforces granular, action-specific permission checks before execution:
- `publish` action requires `translations.publish`.
- `approve` action requires `translations.approve`.
- `delete` action requires `translations.manage`.
- `submit_review` / `mark_stale` actions require `translations.edit` or `translations.review`.

Each translation ID in the batch is individually validated against the database and checked through `validateTranslationStatusTransition()`, returning a structured execution report:
```ts
{
  updatedCount: number;
  succeededIds: string[];
  failed: Array<{ id: string; reason: string }>;
  errors: string[];
}
```

### 5.2 Optimistic Concurrency & Conflict Detection
`updateTranslation` and `upsertTranslation` track `sourceVersionAtTranslation` and `sourceUpdatedAtTranslation`. If the source document changes during an active editing session, the translation is flagged as `stale`, and field-level diffs are computed.

### 5.3 Field-Level Source Diff Semantics
When retrieving translations (`GET /translations/:id`), Vibress calculates field-level differences against the modified source document:
```ts
export interface FieldLevelSourceDiff {
  hasChanges: boolean;
  titleChanged: boolean;
  slugChanged: boolean;
  excerptChanged: boolean;
  contentChanged: boolean;
  metaTitleChanged: boolean;
  metaDescriptionChanged: boolean;
  changedFields: string[]; // e.g. ["title", "body"]
}
```
This enables translators to see exactly which fields require updating without re-translating unchanged sections.

---

## 6. Canonical Localization Health Metrics

Vibress defines 4 exact mathematical formulas for publication translation health:

1. **Translation Coverage:**
   $$\text{Translation Coverage} = \frac{\text{Existing Translations}}{\text{Eligible Non-Default Source Items}} \times 100\%$$
2. **Published Coverage:**
   $$\text{Published Coverage} = \frac{\text{Published Translations}}{\text{Eligible Non-Default Source Items}} \times 100\%$$
3. **Review Coverage:**
   $$\text{Review Coverage} = \frac{\text{Needs Review} + \text{Approved}}{\text{Total Existing Translations}} \times 100\%$$
4. **Stale Rate:**
   $$\text{Stale Rate} = \frac{\text{Stale Translations}}{\text{Published Translations} + \text{Stale Translations}} \times 100\%$$

---

## 7. Translation Intelligence & Publication Glossaries

To enforce brand terminology and professional linguistic consistency, Vibress includes a dedicated **Translation Glossary** engine (`TranslationGlossary` in `@vibress/i18n`):

- **Publication-Level Term Mapping:** Pairs source terms and approved target terms with grammatical notes.
- **AI Prompt Injection:** The `POST /content/:type/:id/ai-translate` endpoint automatically retrieves active glossary terms for the requested language pair and injects mandatory translation rules into the LLM system prompt.
- **Translation Safety Contract:** All AI translations are strictly saved in `needs_review` status with `translationProvider: "ai:<provider>"` and require human editor approval before publishing.
