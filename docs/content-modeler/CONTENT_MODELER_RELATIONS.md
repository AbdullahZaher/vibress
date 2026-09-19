# Vibress Content Modeler — Relations & Graph Navigation Architecture

The Vibress Content Modeler provides a high-performance, multi-tenant graph relation subsystem. It allows editors to define interconnected content topologies (such as `Author -> Books`, `Course -> Modules -> Lessons`, `Project -> Team Members`) with strict tenant isolation, cycle protection, depth bounding, and deterministic list ordering.

---

## 1. Authoritative Relation Contracts

The Content Modeler supports two first-class relation field types:

### 1.1 Single Relation (`relation`)
- **Cardinality**: `one` (1:1 or N:1).
- **Meaning**: References a single target entry belonging to a configured target model.
- **Storage**: Non-empty String UUID or slug.
  ```json
  {
    "primaryAuthor": "3ced8899-0ea6-4a07-ae60-3069029dcd0c"
  }
  ```
- **Resolved Shape**:
  ```json
  {
    "primaryAuthor": {
      "id": "3ced8899-0ea6-4a07-ae60-3069029dcd0c",
      "slug": "donald-knuth",
      "title": "Donald Knuth",
      "status": "published",
      "data": {
        "name": "Donald Knuth",
        "bio": "Professor Emeritus of the Art of Computer Programming"
      }
    }
  }
  ```
- **Unresolved / Missing / Deleted / Cross-Tenant Target**: Safely resolves to `null`.

### 1.2 Multi-Entry Relation List (`relation_list`)
- **Cardinality**: `many` (1:N or M:N).
- **Meaning**: References an ordered array of target entries belonging to a configured target model.
- **Storage**: String Array of UUIDs.
  ```json
  {
    "coAuthors": [
      "3ced8899-0ea6-4a07-ae60-3069029dcd0c",
      "789769bb-9bb5-42ac-a685-2c11c36b4570"
    ]
  }
  ```
- **Ordering Guarantee**: The exact array sequence specified by the editor is strictly preserved during resolution and delivery.
- **Limit**: Maximum array size is bounded by `MAX_RELATION_LIST_ITEMS = 100` (or field-level `max` configuration).
- **Resolved Shape**:
  ```json
  {
    "coAuthors": [
      {
        "id": "3ced8899-0ea6-4a07-ae60-3069029dcd0c",
        "slug": "donald-knuth",
        "title": "Donald Knuth",
        "status": "published",
        "data": { "name": "Donald Knuth" }
      },
      {
        "id": "789769bb-9bb5-42ac-a685-2c11c36b4570",
        "slug": "leslie-lamport",
        "title": "Leslie Lamport",
        "status": "published",
        "data": { "name": "Leslie Lamport" }
      }
    ]
  }
  ```
- **Unresolved / Missing / Deleted / Cross-Tenant Targets**: Omitted from resolved array while preserving the relative ordering of all remaining valid entries. If all targets are invalid, resolves to `[]`.

---

## 2. Multi-Tenant Publication Isolation & Security

1. **Write-Time Enforcement**:
   - When creating or updating an entry, referenced target IDs are verified to ensure they belong to the current `publicationId` and match the configured `targetModelId`.
   - Cross-publication relation references are rejected at the service layer with a `ValidationError`.
2. **Read-Time Boundary**:
   - `resolveRelationsForEntry` queries the database with mandatory scoping: `where publicationId = currentPublicationId and modelId = targetModelId and deletedAt is null`.
   - Foreign-tenant entities resolve to `null` (for `relation`) or `[]` (for `relation_list`), completely preventing data leakage across publication borders.
3. **Public API & Role Visibility**:
   - For anonymous public queries (`userRole = 'public'`), unresolved draft or archived related entries are stripped to prevent information leaks before publication.
   - Private and authenticated fields within related entity payloads are filtered according to the caller's verified role.

---

## 3. Bounded Recursion Depth & Protection

To protect system memory and API latency:
- **Default Resolution Depth**: `depth = 1` (resolves direct relations).
- **Maximum Resolution Depth**: `MAX_RELATION_EXPANSION_DEPTH = 2` across all service, API, Liquid, and SSR layers.
  - `depth = 1`: `Course -> Modules` (Module relations remain raw IDs).
  - `depth = 2`: `Course -> Modules -> Lessons` (Lesson relations are not expanded further).
- **Batched Loading**: Multi-relation queries batch load target entities via SQL `IN (...)` to eliminate N+1 database queries.
- **Cycle Prevention**: The resolver maintains a `visitedEntryIds: Set<string>` through recursive expansion branches. If a cyclic relationship is encountered (e.g. `Author -> Book -> Author`), traversal halts cleanly, emitting `{ id, cyclic: true }` without stack overflow or infinite recursion.

---

## 4. Localization of Graph Entities

When entries containing relations are queried with a specific `locale`:
- Target entry data payloads recursively apply `resolveLocalizedEntryData(target.data, targetFields, targetLocale, defaultLocale)`.
- If an Arabic translation (`ar`) is requested, related entries with localized dictionary attributes (e.g. `name: { en: '...', ar: '...' }`) resolve to the Arabic string, falling back to English if missing.

---

## 5. Liquid Theme Templates Usage

Theme developers can navigate relations seamlessly via Liquid tags and filters:

```liquid
{% collection "books", limit: 10 as books %}

{% for book in books %}
  <article class="book-entry">
    <h2>{{ book.title }}</h2>

    {% comment %} Single relation direct access {% endcomment %}
    {% if book.primaryAuthor %}
      <p class="lead-author">
        By: <a href="{{ 'authors' | collection_url: book.primaryAuthor.slug }}">{{ book.primaryAuthor.title }}</a>
      </p>
    {% endif %}

    {% comment %} Multi relation_list iteration {% endcomment %}
    {% if book.coAuthors.size > 0 %}
      <div class="co-authors">
        <h4>Co-Authors:</h4>
        <ul>
          {% for author in book.coAuthors %}
            <li>{{ author.title }}</li>
          {% endfor %}
        </ul>
      </div>
    {% endif %}
  </article>
{% endfor %}
```

---

## 6. Admin CMS Experience

- **Model Builder**: Authors configure `relation` (1:1 / N:1) or `relation_list` (1:N / M:N) with target model selection and `max` items bounds.
- **Dynamic Entry Editor**:
  - `relation`: Searchable single select dropdown.
  - `relation_list`: Searchable multi-selection with an ordered list, explicit **Move Up / Move Down** reordering buttons, individual item removal, and live selection counter.
