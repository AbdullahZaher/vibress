# Vibress Theme Developer Guide (Theme API v1)

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

Create the required templates inside `templates/` providing semantic body markup:

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

Place CSS stylesheets, images, and web fonts in the `assets/` directory:

- `assets/css/theme.css`
- `assets/images/`
- `assets/fonts/`

Reference them inside templates using the `{% asset %}` tag or `asset_url` filter:

```liquid
<link rel="stylesheet" href="{% asset 'assets/css/theme.css' %}" />
```

> [!NOTE]
> Theme API v1 enforces a strict No-JS policy for external theme packages to guarantee performance, SEO excellence, and CSP security compliance. Next.js natively manages client interactions, portal modals, and analytics scripts.

---

## 4. Social icons in custom themes

Social profile links are configured by the publication owner under **Settings → Site → Social links** ([owner guide](../administration/SOCIAL_LINKS_GUIDE.md)). They are publication data, not fields in your `settings.json`.

Every Liquid template can access the ordered `site.socialLinks` array of `{ id, platform, label, url, iconUrl }`. An unconfigured site returns `[]`. To render icon links in `partials/footer.liquid`:

```liquid
{% if site.socialLinks.size > 0 %}
  <nav class="social-links" aria-label="Social media links">
    {% for social in site.socialLinks %}
      <a href="{{ social.url | escape }}" aria-label="{{ social.label | escape }}"
         target="_blank" rel="noopener noreferrer">
        <img src="{{ social.iconUrl | escape }}" alt="" width="20" height="20">
      </a>
    {% endfor %}
  </nav>
{% endif %}
```

Style the links with a 44px minimum pointer target, visible keyboard focus, and logical/RTL-friendly spacing. The `iconUrl` property references a local SVG supplied by Vibress; avoid icon CDNs, external scripts, and hardcoded platform homepages. The same partial can be included in a header or sidebar. Third-party theme footers are not modified automatically, and older themes remain valid.

See the [Liquid view-model contract and CSS example](templating.md).

---

## 5. Customizable theme settings

Add `settings.json` alongside `theme.json` in the ZIP. The file declares a `{ "fields": [...] }` schema with a required `key`, `type`, and `default` on each entry. Supported types: `string`, `boolean`, `number`, `color`, and `select`; see the [Theme Settings Guide](../../VIBRESS_THEME_DESIGNER_PACKAGE/07-THEME-SETTINGS-GUIDE.md).

An authorized editor opens **Settings → Site → Themes**, chooses **Settings** on a theme card (before **Delete** on removable themes), adjusts the dynamically generated fields, and selects **Save Settings**. Both active and inactive themes can be customized; saved values are scoped to the publication and retained when changing active themes. The live Liquid renderer exposes active theme values as `settings.accentColor`, etc. A setting only affects the site when the theme's templates/CSS actually use it. Never put secrets or user account settings in theme settings; social URLs belong to `site.socialLinks`.

---

## 6. Packaging Your Theme

Zip the contents of your theme folder:

```bash
cd my-new-theme
zip -r ../my-theme.zip theme.json settings.json preview.webp templates/ partials/ assets/
```

> **Note**: Make sure `theme.json` is at the root of the ZIP file (or inside a single top-level directory).

---

## 7. Installing & Activating in Admin

1. Open your Vibress Admin Panel.
2. Navigate to **Settings &rarr; Site &rarr; Themes**.
3. Click **Upload Theme (.zip)**.
4. Select `my-theme.zip` and click **Install Theme**.
5. Click **Preview** to view your theme live with real content.
6. Click **Settings** to customize the theme's declared presentation fields (optional, available before activation).
7. Click **Activate Theme** to immediately publish it to your live website.
