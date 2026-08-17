# 05 — View Models Reference Guide

This document is the **definitive reference** for all data structures (ViewModels) passed into Vibress Liquid templates.

All fields listed here are verified directly against the production engine (`@vibress/theme-core`).

---

## 🌐 1. `SiteViewModel` (`site`)

Available globally across **all templates** (`home`, `post`, `page`, `tag`, `author`).

```typescript
interface SiteViewModel {
  title: string;
  description: string;
  tagline?: string | null;
  url: string;
  locale: string;
  direction: "ltr" | "rtl";
  timezone: string;
  accentColor: string;
  icon?: string | null;
  logo?: string | null;
  coverImage?: string | null;
  navigation: {
    primary: SiteNavigationItemViewModel[];
    secondary: SiteNavigationItemViewModel[];
  };
  announcement?: {
    enabled: boolean;
    text: string;
    url?: string | null;
  };
}
```

### `site` Fields Table

| Field | Type | Nullable? | Description | Example |
| :--- | :--- | :---: | :--- | :--- |
| `site.title` | `string` | No | Site publication title | `"Tech Horizon"` |
| `site.description` | `string` | No | Short publication summary | `"Insights on software & AI"` |
| `site.tagline` | `string` | Yes | Optional secondary tagline | `"Building the open web"` |
| `site.url` | `string` | No | Base public URL of the website | `"https://vibress.org"` |
| `site.locale` | `string` | No | IETF language tag | `"en"`, `"ar"`, `"fr"` |
| `site.direction` | `string` | No | Writing direction (`"ltr"` or `"rtl"`) | `"ltr"` (or `"rtl"` for Arabic) |
| `site.timezone` | `string` | No | Publication timezone | `"UTC"`, `"Asia/Riyadh"` |
| `site.accentColor` | `string` | No | Brand hex color | `"#6366f1"` |
| `site.icon` | `string` | Yes | Small favicon / site icon URL | `"/media/icon.png"` |
| `site.logo` | `string` | Yes | Primary publication logo URL | `"/media/logo.svg"` |
| `site.coverImage` | `string` | Yes | Large hero publication banner | `"/media/cover.webp"` |
| `site.navigation.primary` | `array` | No | Main navigation menu items | `[{ label: "Home", url: "/" }]` |
| `site.navigation.secondary` | `array` | No | Secondary / footer menu items | `[{ label: "Privacy", url: "/pages/privacy" }]` |
| `site.announcement.enabled` | `boolean` | No | Whether announcement banner is active | `true` or `false` |
| `site.announcement.text` | `string` | No | Announcement text | `"New issue published today!"` |
| `site.announcement.url` | `string` | Yes | Optional link for announcement banner | `"/posts/special-report"` |

---

## 📝 2. `PostViewModel` (`post` or elements of `posts`)

Available in `templates/post.liquid` as `post`, and in `home.liquid`, `tag.liquid`, `author.liquid` inside the `posts` array.

```typescript
interface PostViewModel {
  id: string;
  title: string;
  slug: string;
  excerpt?: string | null;
  html: string;
  publishedAt?: string | null;
  updatedAt?: string | null;
  readingTimeMinutes?: number;
  featured: boolean;
  featureImage?: ImageViewModel | null;
  primaryAuthor?: AuthorViewModel | null;
  authors: AuthorViewModel[];
  tags: TagViewModel[];
  url: string;
  seo: SeoViewModel;
}
```

### `post` Fields Table

| Field | Type | Nullable? | Description | Example |
| :--- | :--- | :---: | :--- | :--- |
| `post.id` | `string` | No | Unique article ID | `"post_981240"` |
| `post.title` | `string` | No | Article headline | `"Architecting Modern Web Themes"` |
| `post.slug` | `string` | No | Clean URL slug | `"architecting-modern-web-themes"` |
| `post.excerpt` | `string` | Yes | Short summary or subtitle | `"A deep dive into zero-rebuild architecture..."` |
| `post.html` | `string` | No | Sanitized full HTML article body | `"<p>Content goes here...</p>"` |
| `post.publishedAt` | `string` | Yes | ISO 8601 publication timestamp | `"2026-08-17T01:30:00.000Z"` |
| `post.updatedAt` | `string` | Yes | ISO 8601 last update timestamp | `"2026-08-17T03:15:00.000Z"` |
| `post.readingTimeMinutes`| `number` | No | Estimated read time in minutes | `4` |
| `post.featured` | `boolean` | No | Highlighted / stickied article flag | `true` or `false` |
| `post.featureImage.url` | `string` | Yes | Cover illustration / photography URL | `"/media/article-cover.webp"` |
| `post.featureImage.alt` | `string` | Yes | Image accessible description | `"Laptop on wooden desk"` |
| `post.featureImage.caption`| `string` | Yes | Image credit or caption | `"Photo by Unsplash"` |
| `post.primaryAuthor` | `object` | Yes | Primary author object (see AuthorViewModel) | `{ name: "Sarah Connor", ... }` |
| `post.authors` | `array` | No | Array of all contributing authors | `[AuthorViewModel, ...]` |
| `post.tags` | `array` | No | Array of assigned tags | `[TagViewModel, ...]` |
| `post.url` | `string` | No | Pre-computed relative link | `"/posts/architecting-modern-web-themes"` |
| `post.seo.title` | `string` | No | SEO meta title | `"Architecting Modern Themes — Tech Horizon"` |
| `post.seo.description` | `string` | No | SEO meta description | `"A deep dive into..."` |

---

## 📄 3. `PageViewModel` (`page`)

Available in `templates/page.liquid`.

```typescript
interface PageViewModel {
  id: string;
  title: string;
  slug: string;
  excerpt?: string | null;
  html: string;
  publishedAt?: string | null;
  updatedAt?: string | null;
  featureImage?: ImageViewModel | null;
  primaryAuthor?: AuthorViewModel | null;
  url: string;
  seo: SeoViewModel;
}
```

### `page` Fields Table

| Field | Type | Nullable? | Description | Example |
| :--- | :--- | :---: | :--- | :--- |
| `page.id` | `string` | No | Unique page ID | `"page_102"` |
| `page.title` | `string` | No | Page title | `"About Us"` |
| `page.slug` | `string` | No | URL slug | `"about-us"` |
| `page.excerpt` | `string` | Yes | Page subtitle | `"Our mission and editorial team"` |
| `page.html` | `string` | No | Sanitized full HTML page body | `"<p>Welcome to our story...</p>"` |
| `page.publishedAt` | `string` | Yes | ISO 8601 publication timestamp | `"2026-01-01T00:00:00.000Z"` |
| `page.featureImage.url`| `string` | Yes | Feature banner image URL | `"/media/about-banner.jpg"` |
| `page.primaryAuthor` | `object` | Yes | Author object (if assigned) | `{ name: "Editor in Chief", ... }` |
| `page.url` | `string` | No | Pre-computed relative link | `"/pages/about-us"` |

---

## 🏷️ 4. `TagViewModel` (`tag` or inside `post.tags`)

Available in `templates/tag.liquid` as `tag`, and inside `post.tags` on any article.

```typescript
interface TagViewModel {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  featureImage?: string | null;
  url: string;
}
```

| Field | Type | Nullable? | Description | Example |
| :--- | :--- | :---: | :--- | :--- |
| `tag.id` | `string` | No | Tag identifier | `"tag_45"` |
| `tag.name` | `string` | No | Human label | `"Artificial Intelligence"` |
| `tag.slug` | `string` | No | URL slug | `"artificial-intelligence"` |
| `tag.description` | `string` | Yes | Optional taxonomy description | `"Articles discussing machine learning and neural networks."` |
| `tag.featureImage` | `string` | Yes | Banner image URL for tag archive | `"/media/ai-banner.webp"` |
| `tag.url` | `string` | No | Relative link to tag archive | `"/tags/artificial-intelligence"` |

---

## 👤 5. `AuthorViewModel` (`author` or inside `post.authors`)

Available in `templates/author.liquid` as `author`, and inside `post.primaryAuthor` / `post.authors`.

```typescript
interface AuthorViewModel {
  id: string;
  name: string;
  slug: string;
  bio?: string | null;
  avatar?: string | null;
  url: string;
}
```

| Field | Type | Nullable? | Description | Example |
| :--- | :--- | :---: | :--- | :--- |
| `author.id` | `string` | No | Author ID | `"usr_7721"` |
| `author.name` | `string` | No | Full display name | `"Sarah Connor"` |
| `author.slug` | `string` | No | URL slug | `"sarah-connor"` |
| `author.bio` | `string` | Yes | Author biography / summary | `"Investigative journalist focusing on tech policy."` |
| `author.avatar` | `string` | Yes | Profile portrait image URL | `"/media/avatars/sarah.jpg"` |
| `author.url` | `string` | No | Link to author archive | `"/authors/sarah-connor"` |

---

## 🔢 6. `PaginationViewModel` (`pagination`)

Available in `home.liquid`, `tag.liquid`, and `author.liquid`.

```typescript
interface PaginationViewModel {
  page: number;
  limit: number;
  total: number;
  pages: number;
  previous: number | null;
  next: number | null;
  hasPrevious: boolean;
  hasNext: boolean;
}
```

| Field | Type | Nullable? | Description | Example |
| :--- | :--- | :---: | :--- | :--- |
| `pagination.page` | `number` | No | Current active page number | `1` |
| `pagination.limit` | `number` | No | Number of posts per page | `10` |
| `pagination.total` | `number` | No | Total count of articles matching query | `42` |
| `pagination.pages` | `number` | No | Total number of pages | `5` |
| `pagination.previous`| `number` | Yes | Previous page number (`null` if on page 1) | `null` (or `1`) |
| `pagination.next` | `number` | Yes | Next page number (`null` if on last page) | `2` (or `null`) |
| `pagination.hasPrevious`| `boolean`| No | Convenience boolean (`page > 1`) | `false` |
| `pagination.hasNext` | `boolean` | No | Convenience boolean (`page < pages`) | `true` |

---

Next: Read **[`06-ROUTES-AND-HELPERS.md`](./06-ROUTES-AND-HELPERS.md)** to learn how to generate URLs and use navigation helpers.
