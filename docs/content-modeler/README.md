# Vibress Content Modeler — System Documentation

The Vibress **Content Modeler** is a fully integrated, multi-tenant structured content platform that allows publication owners and developers to define custom content models, create custom structured entries, bind relations, manage assets, localize across multiple languages (including full Arabic/RTL support), and render dynamic collections through the Liquid Theme Engine and Public Web routes.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│                   Admin Application                    │
│   (Model Editor, Dynamic Entry Editor, Relations)      │
└───────────────────────────┬────────────────────────────┘
                            │ (Staff Session + RBAC)
                            ▼
┌────────────────────────────────────────────────────────┐
│                   Vibress API Server                   │
│   - /api/admin/v1/content-models                       │
│   - /api/content/v1/collections (Public Visibility)    │
└──────────────┬────────────────────────────┬────────────┘
               │                            │
               ▼                            ▼
┌──────────────────────────────┐ ┌──────────────────────┐
│ Content Modeler Domain       │ │ Theme Engine / Liquid│
│ - Multi-Tenant Isolation     │ │ - {% collection %}   │
│ - Schema Evolution / Diff    │ │ - collection_url     │
│ - Field Registry (18 Types)  │ │ - View Models        │
│ - Relation Graph (Depth <= 2)│ └──────────┬───────────┘
│ - Arabic / i18n Dictionary   │            │
└──────────────┬───────────────┘            ▼
               │                 ┌──────────────────────┐
               ▼                 │   Public Web App     │
┌──────────────────────────────┐ │ - /collections/[m]   │
│ Database (PostgreSQL)        │ │ - /collections/[m]/[e]│
│ - content_models             │ └──────────────────────┘
│ - content_entries            │
│ - Composite FK & Indexes     │
└──────────────────────────────┘
```

---

## Core Capabilities

1. **Publication Isolation**: Strict tenant scoping across all models and entries using composite foreign keys `(model_id, publication_id) -> (id, publication_id)` and publication-scoped unique constraints.
2. **18 Supported Field Types**: `short_text`, `text`, `long_text`, `rich_text`, `studio_doc`, `number`, `boolean`, `date`, `datetime`, `url`, `email`, `select`, `multi_select`, `taxonomy`, `media`, `relation`, `relation_list`, and `json`.
3. **First-Class Relations & Relation Lists**: One-to-one, one-to-many, and many-to-many relation lists (`relation_list`) resolved safely with strict publication boundary validation, deterministic list ordering, cycle protection, and authoritative bounded recursion depth (`MAX_RELATION_EXPANSION_DEPTH = 2`).
4. **Localization & RTL**: Locale dictionary support for all fields, automatic Arabic/RTL direction detection, and fallback resolution.
5. **Entry Lifecycle**: Full editorial lifecycle (`draft`, `published`, `archived`) with audit logging and transactional outbox events.
6. **Schema Evolution**: Non-destructive schema diff preview engine analyzing additions, deprecations, renames, type mutations, and validation changes.
7. **Theme & Liquid Integration**: First-class `{% collection %}` Liquid tags, `collection_url` filters, view models, and server-rendered Next.js collection routes.

---

## Documentation Index

- [Architecture & Design](CONTENT_MODELER_ARCHITECTURE.md)
- [REST API Specification](CONTENT_MODELER_API.md)
- [Field Registry & Editors](CONTENT_MODELER_FIELDS.md)
- [Relations & Graph Navigation](CONTENT_MODELER_RELATIONS.md)
- [Localization & RTL Architecture](CONTENT_MODELER_LOCALIZATION.md)
- [Themes & Liquid Integration](CONTENT_MODELER_THEMES.md)
- [Schema Evolution & Migrations](CONTENT_MODELER_SCHEMA_EVOLUTION.md)
- [Security & Publication Isolation](CONTENT_MODELER_SECURITY.md)
- [Operations, Limits & Observability](CONTENT_MODELER_OPERATIONS.md)
