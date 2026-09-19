# Vibress Content Modeler — Architecture Specification

## 1. Architectural Overview

The Vibress **Content Modeler** provides dynamic, publication-isolated structured content modeling, allowing publications to define custom schemas (e.g. Products, Books, Case Studies, Courses, Events, Portfolios) with strict type validation, field visibility controls, first-class relations, media integration, multi-lingual localization, and native Theme/Liquid rendering.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                           VIBRESS ADMIN UI                                │
│   ContentModelList ──► ContentModelEditor ──► DynamicCollectionEntryEditor│
└─────────────────────────────────────┬─────────────────────────────────────┘
                                      │ HTTP REST (Admin Session + RBAC)
                                      ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                           FASTIFY API ROUTING                             │
│   /api/admin/v1/content-models        /api/content/v1/collections         │
│   (Active Publication Context)        (Host/Pub Scoped + Field Visibility)│
└─────────────────────────────────────┬─────────────────────────────────────┘
                                      │
                                      ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                    @vibress/content-modeler DOMAIN                        │
│   ContentModelerService ──► Field Registry ──► Entry Validation Engine    │
│   Relation Resolver     ──► Visibility Filter ──► Lifecycle FSM          │
└──────────────────┬──────────────────┬──────────────────┬──────────────────┘
                   │                  │                  │
                   ▼                  ▼                  ▼
       ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
       │ PostgreSQL DB    │ │ @vibress/storage │ │ @vibress/theme-  │
       │ Multi-Tenant     │ │ Canonical Media  │ │ core (Liquid     │
       │ Composite PK/FKs │ │ Resolution       │ │ Collections)     │
       └──────────────────┘ └──────────────────┘ └──────────────────┘
```

---

## 2. Multi-Tenant Publication Isolation Model

Content models and entries are strictly scoped to a single publication:
1. **Database Tier**: Every `content_models` and `content_entries` row contains a non-nullable `publication_id` foreign key referencing `publications(id) ON DELETE CASCADE`.
2. **Composite Uniqueness**:
   - `content_models`: `UNIQUE (publication_id, slug)`
   - `content_entries`: `UNIQUE (publication_id, model_id, slug) WHERE deleted_at IS NULL`
   - Composite foreign key: `content_entries(model_id, publication_id)` references `content_models(id, publication_id) ON DELETE CASCADE`.
3. **Application Tier**: `ContentModelerService` methods require a verified `publicationId`. Unscoped queries are architecturally impossible.
4. **API Tier**: The Fastify request lifecycle extracts `activePublicationId` from the authenticated staff session or host header; cross-tenant operations return `404 Not Found`.

---

## 3. Supported Field Types & Registry

| Field Type | Storage Type | Validation Rule | Admin Control | Liquid Representation |
| :--- | :--- | :--- | :--- | :--- |
| `short_text` / `text` | `string` | minLength, maxLength, regex pattern | `<input type="text">` | String |
| `long_text` | `string` | minLength, maxLength | `<textarea>` | String |
| `rich_text` | `string` (HTML/Markdown) | String or serialized AST | Rich Text Editor | HTML String / Safe output |
| `studio_doc` | `jsonb` (Lexical AST) | Lexical root node structure | Studio Mini-Editor | Serialized HTML |
| `number` | `number` | min, max, integer/float bounds | `<input type="number">` | Number / `format_number` |
| `boolean` | `boolean` | Boolean strictly | Checkbox / Toggle | Boolean |
| `date` | `string` (YYYY-MM-DD) | Valid ISO date | `<input type="date">` | Date object / `format_date` |
| `datetime` | `string` (ISO-8601) | Valid ISO timestamp | `<input type="datetime-local">`| Timestamp / `format_date` |
| `url` | `string` | Absolute URL (`http(s)://`) | `<input type="url">` | URL String |
| `email` | `string` | RFC-5322 regex validation | `<input type="email">` | Email String / `mailto:` |
| `select` | `string` \| `number` | Membership in allowed `options` | `<select>` Dropdown | Selected value |
| `multi_select` | `array` | Subset of allowed `options` | Multi-select Tag Pill Input | Array of values |
| `media` | `string` \| `object` | Valid media ID or storage URL | MediaPicker Modal Trigger | Asset URL / Object |
| `taxonomy` | `array<string>` | Array of string tags/topics | Tag Input | Array of strings |
| `relation` | `string` (Entity ID) | Target model entry verification | Searchable Entity Picker | Resolved Object / ID |
| `relation_list` | `array<string>` | Target model entries array | Searchable Multi-Entity Picker| Resolved Array of Objects |
| `json` | `jsonb` (Object/Array) | Valid JSON structure | Syntax-checked Code Editor | JSON Object |

---

## 4. Entry Lifecycle & Revisions

```
   ┌───────────┐        publish()         ┌─────────────┐
   │   DRAFT   │ ───────────────────────► │  PUBLISHED  │
   └─────┬─────┘                          └──────┬──────┘
         │                                       │
         │             archive()                 │
         └───────────────────────────────────────┼──────────┐
                                                 │          │
                                                 ▼          ▼
                                          ┌─────────────┐   │
                                          │  ARCHIVED   │ ◄─┘
                                          └─────────────┘
```

1. **Draft**: Editable, visible only to authenticated staff in Admin UI.
2. **Published**: Visible on public APIs, collections routes, and Liquid theme engine. Sets `publishedAt` timestamp.
3. **Archived**: Soft-hidden from public collections; preserved for historical auditing.
4. **Soft Delete**: Sets `deletedAt = now()`, releasing the `(publicationId, modelId, slug)` unique slot while retaining historical audit logs.

---

## 5. Security & Visibility Enforcement

### Field-Level Visibility
Fields support `apiVisibility: "public" | "authenticated" | "private"`:
- **`public`**: Returned to all public collection requests and Liquid theme contexts.
- **`authenticated`**: Returned only when the request carries an authenticated member or staff session.
- **`private`**: Stripped from all public and member responses; accessible exclusively to staff administrators with `posts.read` permissions.

### Rate Limiting & Pagination Bounds
- Max pagination limit: `100` items per query. Default: `20` (public), `50` (admin).
- Bounded relation expansion: Maximum depth `2` to eliminate cyclic traversal vulnerabilities.

---

## 6. Theme Core & Liquid Engine Integration

1. **View Model Contract**: `CollectionEntryViewModel` standardizes dynamic fields, formatted attributes, canonical URLs, and localized titles.
2. **Global Collections Access**: Themes access published entries via:
   ```liquid
   {% for project in collections.projects %}
     <article class="project-card">
       <h2>{{ project.title }}</h2>
       <p>{{ project.data.client_name }}</p>
       <span class="badge">{{ project.data.price | format_number }}</span>
     </article>
   {% endfor %}
   ```
3. **Dynamic Collection Tag**:
   ```liquid
   {% collection 'books', limit: 6, sort: 'publishedAt:desc' as featured_books %}
     {% for book in featured_books %}
       <p>{{ book.title }} by {{ book.data.author_name }}</p>
     {% endfor %}
   {% endcollection %}
   ```
4. **URL Resolution**: Dedicated Liquid filter `{{ entry.slug | collection_url: 'books' }}`.
