# Vibress Theme Developer Guide

This guide walks you through creating, testing, packaging, and installing custom themes for Vibress.

---

## 1. Quick Start with the Starter Theme

The easiest way to build a new Vibress theme is to copy the official starter theme:

```bash
# 1. Copy starter template
cp -r content/theme-starter my-new-theme
cd my-new-theme

# 2. Update theme.json
# Change "id", "name", and "author"
```

---

## 2. Core Template Files

Create the required templates inside `templates/`:

### `templates/home.liquid`
The main landing page displaying the hero banner, category filters, and article feed.

```liquid
{% include 'header' %}
<main class="theme-container">
  <h1>{{ site.title }}</h1>
  {% for post in posts %}
    <article>
      <h2><a href="{{ post.url }}">{{ post.title }}</a></h2>
      <p>{{ post.excerpt }}</p>
    </article>
  {% endfor %}
  {% include 'pagination' %}
</main>
{% include 'footer' %}
```

### `templates/post.liquid`
The single article page displaying post content, author details, reading time, and tags.

```liquid
{% include 'header' %}
<article class="article-single">
  <h1>{{ post.title }}</h1>
  <div class="article-content">
    {{ post.html }}
  </div>
</article>
{% include 'footer' %}
```

### `templates/page.liquid`
The static page template used for pages like "About", "Contact", or "Privacy Policy".

```liquid
{% include 'header' %}
<main class="page-single">
  <h1>{{ page.title }}</h1>
  <div class="page-content">
    {{ page.html }}
  </div>
</main>
{% include 'footer' %}
```

---

## 3. Adding Assets

Place CSS stylesheets, client scripts, images, and web fonts in the `assets/` directory:

- `assets/css/theme.css`
- `assets/js/theme.js`

Reference them inside templates using the `{% asset %}` tag:

```liquid
<link rel="stylesheet" href="{% asset 'assets/css/theme.css' %}" />
<script src="{% asset 'assets/js/theme.js' %}" defer></script>
```

---

## 4. Packaging Your Theme

Zip the root contents of your theme folder:

```bash
zip -r my-theme.zip theme.json settings.json preview.webp templates/ partials/ assets/
```

> **Note**: Make sure `theme.json` is at the root of the ZIP file (or in a single top-level folder).

---

## 5. Installing & Activating in Admin

1. Open your Vibress Admin Panel.
2. Navigate to **Settings &rarr; Themes**.
3. Click **Upload Theme (.zip)**.
4. Drag and drop `my-theme.zip` and click **Install Theme**.
5. Click **Preview** to view your theme live with real content.
6. Click **Activate Theme** to immediately publish it to your live website.
