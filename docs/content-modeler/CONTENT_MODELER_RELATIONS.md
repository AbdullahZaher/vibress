# Vibress Content Modeler — Relations & Graph Navigation

The Content Modeler supports first-class relations between custom content models, enabling rich connected domain topologies (e.g. `Author -> Books`, `Course -> Lessons`, `Category -> Products`).

---

## 1. Supported Relation Types

1. **Single Entry Relation (`relation`)**: References a single entry from a target content model (`many-to-one` or `one-to-one`).
   - Stored as target entry ID string (or entry object `{ id, slug, title }`).
2. **Multi-Entry Relation (`relation_list`)**: References an ordered array of target entry IDs (`one-to-many` or `many-to-many`).
   - Stored as array of target entry ID strings `["ent_1", "ent_2"]`.

---

## 2. Multi-Tenant Publication Isolation

Relations are strictly enforced within publication boundaries:
- A model in Publication A **cannot** target a model in Publication B.
- When resolving relations, target entries are queried strictly where `publicationId = currentPublicationId`.
- If an entry has references to deleted or cross-publication entries, those references are safely omitted from resolved graph results without crashing queries.

---

## 3. Bounded Recursion Depth & Protection

To protect system memory and API response latency, relation resolution is strictly depth-bounded:
- **Default Resolution Depth**: `depth = 1`
- **Maximum Resolution Depth**: `MAX_RELATION_EXPANSION_DEPTH = 2`
- Circular dependencies (e.g. Model A relates to Model B, which relates back to Model A) stop resolving once maximum depth is reached, preventing infinite recursion or denial of service.

---

## 4. Liquid Theme Usage

When rendering relations in Liquid templates:
```liquid
{% collection "books" as books %}
{% for book in books %}
  <div class="book-card">
    <h3>{{ book.title }}</h3>
    <p>Author: {{ book.author.title }}</p>
    <a href="{{ book.author.url }}">View Author Profile</a>
  </div>
{% endfor %}
```
