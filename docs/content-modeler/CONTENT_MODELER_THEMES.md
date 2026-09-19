# Vibress Content Modeler — Themes & Liquid Integration

Content Modeler collections and entries are first-class data sources across all Vibress themes, supporting both external Liquid themes and built-in themes.

---

## 1. Liquid Collection Tag (`{% collection %}`)

The `{% collection %}` tag loads published collection entries into the current Liquid template scope:

```liquid
{% collection "products", limit: 6 as featured_products %}

<section class="featured-grid">
  <h2>Featured Products</h2>
  <div class="grid">
    {% for item in featured_products %}
      <div class="card">
        <h3><a href="{{ item.url }}">{{ item.title }}</a></h3>
        <p class="price">USD {{ item.price }}</p>
        <a href="{{ item.url }}" class="btn">View Details</a>
      </div>
    {% endfor %}
  </div>
</section>
```

---

## 2. Liquid Collection Filters (`collection_url`)

The `collection_url` filter generates canonical, locale-aware URLs for any collection entry:

```liquid
<a href="{{ book | collection_url: 'books' }}">View {{ book.title }}</a>
```

---

## 3. View Models (`CollectionEntryViewModel`)

Themes receive strongly typed view models (`CollectionEntryViewModel`), never raw database rows:
- `id`: Unique entry identifier
- `modelSlug`: The slug of the parent content model
- `title`: The editorial entry title
- `slug`: The unique URL-friendly entry slug
- `url`: Canonical public URL (e.g. `/collections/books/the-great-gatsby`)
- `data`: Resolved and localized custom field values
- Direct property access: Any custom field `key` (e.g. `price`, `author_name`) is exposed directly on the view model object for ergonomic template access (`{{ book.price }}`).

---

## 4. Public Web Collection Routes

Next.js Server Components handle collection routing in `apps/web`:
- **Collection Index**: `/collections/[modelSlug]` (`apps/web/src/app/collections/[modelSlug]/page.tsx`)
- **Collection Entry Detail**: `/collections/[modelSlug]/[entrySlug]` (`apps/web/src/app/collections/[modelSlug]/[entrySlug]/page.tsx`)
- **SEO & Canonical URLs**: Pre-rendered with dynamic OpenGraph tags, JSON-LD structured data, and 404 handling for draft/archived entries.
