# Vibress LiquidJS Templating Guide

Vibress uses **LiquidJS** as its safe, sandboxed declarative template engine for external themes.

---

## 1. Global View Models & Context

Every template receives clean, decoupled View Models populated by Vibress:

### `site` Object
- `site.title` (`string`): Site name/title.
- `site.description` (`string`): Site meta description.
- `site.url` (`string`): Absolute public site URL.
- `site.logo` (`string` | `null`): Site logo image URL.
- `site.icon` (`string` | `null`): Favicon / square icon URL.
- `site.coverImage` (`string` | `null`): Publication cover banner URL.
- `site.tagline` (`string` | `null`): Subtitle / tagline.
- `site.locale` (`string`): Language locale code (e.g. `en`, `ar`, `es`).
- `site.primaryNav` (`Array<{ label: string, url: string }>`): Main header navigation links.
- `site.secondaryNav` (`Array<{ label: string, url: string }>`): Footer / secondary links.

### `settings` Object
Contains all variables defined in `settings.json` and saved in the Admin Settings panel:
```liquid
<body class="font-{{ settings.typographyFamily | default: 'sans' }}">
```

### `post` Object (Single Article)
- `post.id` (`string`): Unique post identifier.
- `post.title` (`string`): Article title.
- `post.slug` (`string`): Article URL slug.
- `post.excerpt` (`string` | `null`): Short summary or excerpt.
- `post.html` (`string`): Rendered HTML article body content.
- `post.publishedAt` (`string`): ISO publication timestamp.
- `post.readingTimeMinutes` (`number`): Estimated reading time in minutes.
- `post.featured` (`boolean`): Whether post is marked as featured.
- `post.url` (`string`): Relative URL path to post (e.g. `/posts/my-story`).
- `post.featureImage.url` (`string`): Featured image source URL.
- `post.featureImage.alt` (`string`): Featured image alt text.
- `post.primaryAuthor.name` (`string`): Main author name.
- `post.primaryAuthor.avatar` (`string`): Main author profile picture URL.
- `post.primaryAuthor.url` (`string`): Author profile page URL.
- `post.tags` (`TagViewModel[]`): List of associated tags.
- `post.primaryTag` (`TagViewModel`): First / primary tag.

### `pagination` Object
- `pagination.page` (`number`): Current page number.
- `pagination.pages` (`number`): Total number of pages.
- `pagination.total` (`number`): Total number of items.
- `pagination.limit` (`number`): Items per page.
- `pagination.prev` (`number` | `null`): Previous page number.
- `pagination.next` (`number` | `null`): Next page number.

---

## 2. Custom Tags

### `{% asset 'path/to/asset' %}`
Generates the correct URL to a file located inside the theme's `assets/` directory:

```liquid
<link rel="stylesheet" href="{% asset 'assets/css/theme.css' %}" />
<script src="{% asset 'assets/js/theme.js' %}"></script>
```

### `{% route 'name', param %}`
Generates centralized, canonical URLs for routes defined by Vibress:

```liquid
<a href="{% route 'home' %}">Home</a>
<a href="{% route 'post', post.slug %}">{{ post.title }}</a>
<a href="{% route 'tag', tag.slug %}">#{{ tag.name }}</a>
<a href="{% route 'author', author.slug %}">{{ author.name }}</a>
```

### `{% include 'partial_name' %}` or `{% render 'partial_name' %}`
Includes a reusable template from the `partials/` or `templates/` folder:

```liquid
{% include 'header' %}
{% include 'pagination' %}
{% include 'footer' %}
```

---

## 3. Custom Filters

| Filter | Example | Result |
| :--- | :--- | :--- |
| `asset_url` | `{{ 'css/theme.css' \| asset_url }}` | `/theme-assets/my-theme/1.0.0/assets/css/theme.css` |
| `post_url` | `{{ post.slug \| post_url }}` | `/posts/my-slug` |
| `tag_url` | `{{ tag.slug \| tag_url }}` | `/tags/tech` |
| `author_url` | `{{ author.slug \| author_url }}` | `/authors/jane` |
| `format_date` | `{{ post.publishedAt \| format_date }}` | `Aug 16, 2026` |
| `format_date: 'year'` | `{{ 'now' \| format_date: 'year' }}` | `2026` |
| `excerpt: 120` | `{{ post.excerpt \| excerpt: 120 }}` | Truncates text cleanly at word boundaries with `...` |
| `pagination_url` | `{{ pagination.next \| pagination_url }}` | `/?page=2` |
