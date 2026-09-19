# Vibress Content Modeler — REST API Specification

The Content Modeler REST API is organized into two distinct surfaces:
1. **Admin Editorial API** (`/api/admin/v1/content-models`): Requires active staff session authentication (`requireStaffSession`), publication context resolution, and RBAC permissions (`posts.read`, `posts.create`, `posts.edit`, `posts.delete`).
2. **Public Collection API** (`/api/content/v1/collections`): Publicly accessible, tenant-scoped via domain/host header resolution, returning strictly published entries with automated field-level API visibility filtering.

---

## 1. Admin API (`/api/admin/v1/content-models`)

### Model Management

#### `GET /api/admin/v1/content-models`
Lists all content models for the authenticated user's active publication.
- **Permissions**: `posts.read`
- **Response**: `{ data: ContentModel[] }`

#### `GET /api/admin/v1/content-models/:idOrSlug`
Fetches a single model by ID or slug within the active publication.
- **Permissions**: `posts.read`
- **Response**: `{ data: ContentModel }` (404 if not found or belongs to another tenant)

#### `POST /api/admin/v1/content-models`
Creates a new content model.
- **Permissions**: `posts.create`
- **Request Body**:
  ```json
  {
    "name": "Books",
    "slug": "books",
    "description": "Curated library books",
    "fields": [
      { "id": "f1", "name": "ISBN", "key": "isbn", "type": "text", "required": true, "apiVisibility": "public" },
      { "id": "f2", "name": "Price", "key": "price", "type": "number", "required": true, "apiVisibility": "public" },
      { "id": "f3", "name": "Author", "key": "author", "type": "relation", "relationModel": "authors", "apiVisibility": "public" },
      { "id": "f4", "name": "Internal Notes", "key": "notes", "type": "long_text", "apiVisibility": "private" }
    ]
  }
  ```
- **Response**: `201 Created` with `{ data: ContentModel }`

#### `PUT /api/admin/v1/content-models/:id` & `PATCH /api/admin/v1/content-models/:id`
Updates an existing model. Both `PUT` and `PATCH` verbs are fully supported for contract parity.
- **Permissions**: `posts.edit`
- **Response**: `200 OK` with `{ data: ContentModel }`

#### `DELETE /api/admin/v1/content-models/:id`
Deletes a content model within the active publication.
- **Permissions**: `posts.delete`
- **Response**: `204 No Content`

#### `POST /api/admin/v1/content-models/:id/schema-evolution-preview`
Analyzes proposed field changes against existing entries and returns a safe migration diff.
- **Permissions**: `posts.edit`
- **Request Body**: `{ "fields": ContentFieldDefinition[] }`
- **Response**: `200 OK` with `{ data: SchemaEvolutionPlan }`

---

### Entry Management

#### `GET /api/admin/v1/content-models/:modelSlug/entries`
Lists entries for a specific model.
- **Query Params**: `status`, `limit`, `offset`, `search`, `sortBy`, `sortOrder`, `includeRelations`
- **Response**: `{ data: ContentEntry[], meta: { total, limit, offset } }`

#### `GET /api/admin/v1/content-models/:modelSlug/entries/:entryId`
Fetches a single entry with optional relation resolution.
- **Response**: `{ data: ContentEntry }`

#### `POST /api/admin/v1/content-models/:modelSlug/entries`
Creates a new entry.
- **Permissions**: `posts.create`
- **Request Body**:
  ```json
  {
    "title": "The Great Gatsby",
    "slug": "the-great-gatsby",
    "data": {
      "isbn": "978-0743273565",
      "price": 14.99,
      "author": "ent_author_123",
      "notes": "First edition copy in vault"
    },
    "status": "draft"
  }
  ```
- **Response**: `201 Created` with `{ data: ContentEntry }`

#### `PUT` & `PATCH /api/admin/v1/content-models/:modelSlug/entries/:entryId`
Updates entry fields, title, slug, or status. Full PUT/PATCH parity.
- **Permissions**: `posts.edit`
- **Response**: `200 OK` with `{ data: ContentEntry }`

#### `POST /api/admin/v1/content-models/:modelSlug/entries/:entryId/publish`
Publishes an entry (`status: "published"`, sets `publishedAt = now()`).
- **Response**: `200 OK` with `{ data: ContentEntry }`

#### `POST /api/admin/v1/content-models/:modelSlug/entries/:entryId/unpublish`
Reverts an entry to draft (`status: "draft"`).
- **Response**: `200 OK` with `{ data: ContentEntry }`

#### `POST /api/admin/v1/content-models/:modelSlug/entries/:entryId/archive`
Archives an entry (`status: "archived"`).
- **Response**: `200 OK` with `{ data: ContentEntry }`

#### `DELETE /api/admin/v1/content-models/:modelSlug/entries/:entryId`
Soft-deletes an entry (`deletedAt = now()`).
- **Permissions**: `posts.delete`
- **Response**: `204 No Content`

---

## 2. Public Collection API (`/api/content/v1/collections`)

#### `GET /api/content/v1/collections/:modelSlug`
Returns published entries for the tenant resolved from request domain / host header.
- **Query Params**: `limit` (max 100), `offset`, `search`, `sortBy`, `sortOrder`, `locale`
- **Field Visibility**: Automatically removes any fields configured with `apiVisibility: "private"` or `apiVisibility: "authenticated"`.
- **Response**:
  ```json
  {
    "data": [
      {
        "id": "ent_123",
        "modelSlug": "books",
        "title": "The Great Gatsby",
        "slug": "the-great-gatsby",
        "data": {
          "isbn": "978-0743273565",
          "price": 14.99,
          "author": { "id": "ent_auth_1", "title": "F. Scott Fitzgerald", "slug": "f-scott-fitzgerald" }
        },
        "publishedAt": "2026-08-01T12:00:00.000Z",
        "createdAt": "2026-08-01T10:00:00.000Z",
        "updatedAt": "2026-08-01T12:00:00.000Z"
      }
    ],
    "meta": {
      "model": {
        "id": "mod_books",
        "name": "Books",
        "slug": "books",
        "description": "Curated library books"
      },
      "pagination": {
        "limit": 20,
        "offset": 0,
        "count": 1
      }
    }
  }
  ```

#### `GET /api/content/v1/collections/:modelSlug/:entrySlug`
Returns a single published entry with relations expanded.
- **Query Params**: `locale`
- **Response**:
  ```json
  {
    "data": {
      "id": "ent_123",
      "modelSlug": "books",
      "title": "The Great Gatsby",
      "slug": "the-great-gatsby",
      "data": {
        "isbn": "978-0743273565",
        "price": 14.99
      },
      "publishedAt": "2026-08-01T12:00:00.000Z",
      "createdAt": "2026-08-01T10:00:00.000Z",
      "updatedAt": "2026-08-01T12:00:00.000Z"
    }
  }
  ```
