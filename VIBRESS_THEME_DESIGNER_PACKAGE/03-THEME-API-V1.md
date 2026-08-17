# 03 — Theme API v1 Reference & Boundaries

This document defines the official **Theme API v1** specification, its supported capabilities, and its boundaries.

---

## 🎯 What is Theme API v1?

`themeApi: 1` is the current stable contract between the **Vibress Core Engine** and **External Liquid Themes**. It provides:
1. Deterministic ViewModel objects for pages, articles, authors, tags, and navigation.
2. In-memory Liquid template execution with standard LiquidJS filters and tags.
3. Custom routing and asset resolution filters (`asset_url`, `post_url`, `format_date`, etc.).
4. User-configurable design settings editable through the Vibress Admin UI.

Every `theme.json` must include:
```json
"themeApi": 1
```

---

## ✅ Supported Capabilities in Theme API v1

Theme API v1 supports the following core publishing capabilities:

### 1. Templates & Views
* **Homepage (`templates/home.liquid` or `templates/index.liquid`)**:
  * Receives `site`, `posts` (recent article list), `tags` (site tags), `pagination`, `settings`, `theme`.
* **Single Post / Article (`templates/post.liquid`)**:
  * Receives `site`, `post` (full article data with rendered HTML, author, tags, reading time, publication dates, SEO), `settings`, `theme`.
* **Static Page (`templates/page.liquid`)**:
  * Receives `site`, `page` (title, rendered HTML, primary author, publication dates, SEO), `settings`, `theme`.
* **Tag Taxonomy Archive (`templates/tag.liquid`)**:
  * Receives `site`, `tag` (tag name, slug, description, featureImage), `posts` (posts with this tag), `pagination`, `settings`, `theme`.
* **Author Profile & Archive (`templates/author.liquid`)**:
  * Receives `site`, `author` (name, slug, bio, avatar), `posts` (posts by this author), `pagination`, `settings`, `theme`.

### 2. Partials & Component Reusability
* Partials located in `partials/` can be rendered in any template:
  ```liquid
  {% render 'partials/header.liquid', site: site, settings: settings %}
  {% render 'partials/pagination.liquid', pagination: pagination %}
  ```

### 3. Dynamic Site & Theme Settings
* Access global site settings: `{{ site.title }}`, `{{ site.description }}`, `{{ site.logo }}`, `{{ site.accentColor }}`.
* Access theme-specific custom settings: `{{ settings.heroHeadline }}`, `{{ settings.accentColor }}`, `{{ settings.showAuthorAvatars }}`.

### 4. Route & Asset Resolution
* Generate absolute or clean paths to assets and platform routes using built-in filters (`asset_url`, `post_url`, `tag_url`, `page_url`, `author_url`, `pagination_url`).

---

## 🚫 Explicitly Unsupported in Theme API v1

To prevent unexpected surprises, the following features are **NOT part of Theme API v1** and should not be expected in theme templates:

| Feature / Pattern | Supported in v1? | Explanation & Alternative |
| :--- | :---: | :--- |
| **Theme JavaScript Files** | ❌ **NO** | `.js` / `.ts` files inside theme archives are strictly forbidden. Use modern CSS (Grid, Flexbox, transitions, `@container`, `:has()`) for layout and interactions. |
| **Custom Backend Endpoints** | ❌ **NO** | Themes cannot register API routes. All API communication is handled by Vibress core endpoints. |
| **Direct SQL / DB Queries** | ❌ **NO** | Themes cannot query PostgreSQL directly. All data is passed via pre-computed ViewModels. |
| **Theme-level NPM Packages** | ❌ **NO** | Themes cannot specify `package.json` dependencies. |
| **Dynamic Form Submission Handlers** | ❌ **NO** | Sign-in, sign-up, and member portal actions must link to core routes (`/portal/signin`, `/portal/signup`, `/portal/account`). |
| **Server-Side File System Access** | ❌ **NO** | Liquid templates execute inside an isolated virtual memory filesystem. |

---

## 🔍 Capabilities Array Declaration

In your `theme.json`, you can declare the capabilities your theme supports:

```json
"capabilities": [
  "post",
  "page",
  "tag",
  "author",
  "archive"
]
```

This communicates to the admin UI which views have customized styling in your theme package.

---

Next: Read **[`04-LIQUID-TEMPLATING-GUIDE.md`](./04-LIQUID-TEMPLATING-GUIDE.md)** for syntax, control structures, and code examples.
