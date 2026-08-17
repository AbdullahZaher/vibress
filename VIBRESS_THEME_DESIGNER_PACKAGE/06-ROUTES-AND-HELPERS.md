# 06 — Routes, URL Resolution & Helpers Guide

Vibress provides built-in routing helpers and Liquid filters so your theme never relies on brittle, hardcoded URL strings.

---

## 🗺️ The Vibress URL Scheme

| Route Type | URL Structure | Helper Filter | Helper Tag |
| :--- | :--- | :--- | :--- |
| **Homepage** | `/` | `{{ '/' }}` | `{% route 'home' %}` |
| **Single Post** | `/posts/{slug}` | `{{ post.slug \| post_url }}` | `{% route 'post', post.slug %}` |
| **Static Page** | `/pages/{slug}` | `{{ page.slug \| page_url }}` | `{% route 'page', page.slug %}` |
| **Tag Archive** | `/tags/{slug}` | `{{ tag.slug \| tag_url }}` | `{% route 'tag', tag.slug %}` |
| **Author Archive**| `/authors/{slug}` | `{{ author.slug \| author_url }}` | `{% route 'author', author.slug %}` |
| **Member Portal** | `/portal/signin`<br>`/portal/signup`<br>`/portal/account` | Direct links | Direct links |
| **Theme Assets** | `/theme-assets/{themeId}/{version}/{path}` | `{{ 'assets/css/theme.css' \| asset_url }}` | `{% asset 'assets/images/icon.svg' %}` |
| **Theme Preview**| `/preview/{token}` | Handled automatically by Vibress middleware | N/A |

---

## 🛠️ Liquid Route Filters in Action

### 1. Linking to Articles
Use `post_url` with the post's `slug`:
```liquid
<a href="{{ post.slug | post_url }}" class="read-more">
  Read Full Story &rarr;
</a>
```
*(Note: `post.url` is also pre-populated with the resolved relative URL).*

### 2. Linking to Tags & Categories
```liquid
<ul class="post-tags">
  {% for tag in post.tags %}
    <li>
      <a href="{{ tag.slug | tag_url }}" class="tag-pill">
        #{{ tag.name }}
      </a>
    </li>
  {% endfor %}
</ul>
```

### 3. Linking to Authors
```liquid
<div class="byline">
  Written by 
  <a href="{{ post.primaryAuthor.slug | author_url }}" class="author-link">
    {{ post.primaryAuthor.name }}
  </a>
</div>
```

### 4. Linking to Static Pages
```liquid
<a href="{{ 'about-us' | page_url }}">About Us</a>
<a href="{{ 'contact' | page_url }}">Contact Us</a>
```

---

## 🖼️ Asset Resolution

### Using `asset_url` Filter
When referencing fonts, stylesheets, or images located in your theme's `assets/` directory:

```liquid
<!-- Load a decorative illustration -->
<img src="{{ 'assets/images/hero-illustration.svg' | asset_url }}" alt="Hero Illustration" />

<!-- Load an additional CSS file if needed -->
<link rel="stylesheet" href="{{ 'assets/css/syntax-highlight.css' | asset_url }}" />
```

### Using `{% asset %}` Tag
```liquid
<img src="{% asset 'assets/images/brand-symbol.svg' %}" alt="Brand Icon" />
```

---

## 📅 Date Formatting Helper (`format_date`)

Vibress includes a smart `format_date` filter:

```liquid
<!-- Default format: "Aug 17, 2026" -->
<time>{{ post.publishedAt | format_date }}</time>

<!-- ISO format: "2026-08-17" -->
<time datetime="{{ post.publishedAt | format_date: 'iso' }}">
  {{ post.publishedAt | format_date }}
</time>

<!-- Year only: "2026" -->
<span>Copyright &copy; {{ post.publishedAt | format_date: 'year' }}</span>
```

---

## ✂️ Text Excerpting Helper (`excerpt`)

The `excerpt` filter strips all HTML tags and truncates text to a specified character count without breaking markup:

```liquid
<p class="summary">
  {{ post.html | excerpt: 160 }}
</p>
```

---

## 🔢 Pagination Helper (`pagination_url`)

```liquid
{% if pagination.pages > 1 %}
  <nav class="pagination-nav" aria-label="Pagination">
    {% if pagination.hasPrevious %}
      <a href="{{ pagination.previous | pagination_url }}" class="btn btn-prev">
        &larr; Newer Posts
      </a>
    {% endif %}

    <span class="pagination-count">
      Page {{ pagination.page }} of {{ pagination.pages }}
    </span>

    {% if pagination.hasNext %}
      <a href="{{ pagination.next | pagination_url }}" class="btn btn-next">
        Older Posts &rarr;
      </a>
    {% endif %}
  </nav>
{% endif %}
```

---

## 🧭 Site Navigation Loop Example

Here is the standard implementation for the primary site navigation in `partials/header.liquid`:

```liquid
<header class="site-header">
  <div class="header-container">
    <div class="site-branding">
      <a href="/" class="brand-link">
        {% if site.logo %}
          <img src="{{ site.logo }}" alt="{{ site.title }}" class="site-logo" />
        {% else %}
          <span class="site-title">{{ site.title }}</span>
        {% endif %}
      </a>
    </div>

    <nav class="primary-nav" aria-label="Main Navigation">
      <ul class="nav-list">
        {% for item in site.navigation.primary %}
          <li class="nav-item">
            <a href="{{ item.url }}" class="nav-link">{{ item.label }}</a>
          </li>
        {% endfor %}
      </ul>
    </nav>
  </div>
</header>
```

---

Next: Read **[`07-THEME-SETTINGS-GUIDE.md`](./07-THEME-SETTINGS-GUIDE.md)** to build customizable admin settings for your theme.
