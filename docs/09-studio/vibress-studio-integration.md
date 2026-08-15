# Vibress Studio Integration Architecture

## System Boundaries

- **Vibress Core**: Owns database persistence (`posts`, `pages`, `revisions` tables), optimistic concurrency (`version`), access authorization, scheduled publishing, and revision restoration.
- **Vibress Studio**: Owns structured document representation (`StudioDocument` schema v1), Lexical editor runtime, custom node definitions, card rendering, and framework-independent HTML/Markdown output rendering.
- **Vibress Admin**: Owns persistence orchestration (`PostEditor`, `PageEditor`), debounced autosave, 409 conflict detection, and user notification.

---

## Architecture Flow Diagram

```text
                    Vibress Admin
                         │
                         ▼
               @vibress/studio-react
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
        studio-core            studio-cards
              │                     │
              └──────────┬──────────┘
                         ▼
                  StudioDocument
                         │
            ┌────────────┼─────────────┐
            ▼            ▼             ▼
       Serializer    HTML Renderer   Markdown
                         │
                         ▼
                    Output HTML
```

---

## Data Flow & Concurrency

```text
StudioDocument
      ↓
Vibress Admin API (PUT /posts/:id)
      ↓
Content Core (PostsService / PagesService)
      ↓
PostgreSQL + revisions
```

### 1. Document Format & Storage

- Posts and Pages store content as versioned structured JSON (`schema: 'vibress-studio'`, `version: 1`).
- Legacy string/text content from Batch 2 is automatically migrated into `StudioDocument` v1 upon loading.

### 2. Autosave & Conflict Handling

- Admin editors (`PostEditor`, `PageEditor`) debounce document changes by 1200ms before sending a background `PUT` request with `expectedVersion`.
- If another user modifies the content, Content Core returns `409 CONTENT_CONFLICT`.
- Vibress Studio halts autosave, displays a prominent conflict warning, and preserves the local unsaved document in memory without overwriting server state or losing user work.

### 3. Revisions & Restore

- Saving Studio content updates the post/page version and writes a new revision record in `revisions`.
- Restoring a revision loads the historical content into `<VibressStudio>`, which re-renders the document state.
