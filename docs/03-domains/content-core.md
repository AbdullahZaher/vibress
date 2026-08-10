# Content Core Domain Architecture (Batch 2)

## Overview

The Vibress Content Core manages editorial content independently from any rich-text editor or rendering engine.

## Domains

### 1. Posts (`packages/domains/posts`)
Manages post lifecycle, canonical URLs (slugs), status transitions (`draft`, `scheduled`, `published`), optimistic concurrency locking, publication timestamps, and relationships to tags and authors.

### 2. Pages (`packages/domains/pages`)
Manages page lifecycle, unique slugs, status transitions, optimistic locking, and primary/secondary authorship.

### 3. Tags (`packages/domains/tags`)
Manages taxonomy classification and tag slug uniqueness. Tag deletion cleanly removes post associations without deleting content.

### 4. Authors (`packages/domains/authors`)
Manages staff authorship for posts and pages. Supports one primary author and optional secondary authors. Preserves historical authorship even if a staff user becomes disabled.

### 5. Revisions (`packages/domains/revisions`)
Provides an immutable append-only version history for posts and pages. Every save/update/restore creates a new revision with a monotonic revision number per content item. Restoring a past revision updates the current content draft and creates a new revision recording the restoration.

## Content Status Lifecycle

```text
       ┌──────────────┐
       │    draft     │
       └──────┬───────┘
          │       │
  publish │       │ schedule
          ▼       ▼
┌───────────┐   ┌───────────┐
│ published │   │ scheduled │
└─────┬─────┘   └─────┬─────┘
      │               │ publish (scheduled_at <= now)
      └───────►───────┘
```

- **Draft**: Initial default state for new content.
- **Scheduled**: Content assigned a future `scheduled_at` timestamp. Processed automatically by the Worker reconciliation sweep.
- **Published**: Content published immediately or when scheduled time arrives. Populates `published_at` and `published_by`.
- **Unpublish**: Transition from `published` back to `draft`.
