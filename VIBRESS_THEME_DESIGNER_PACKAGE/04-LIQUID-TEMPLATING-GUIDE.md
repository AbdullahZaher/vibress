# 04 — Liquid Templating Guide for Vibress

Vibress uses **LiquidJS**, a fast, safe, and expressive templating engine. This guide covers how to write templates, loop through articles, use conditions, and render modular partials.

---

## 💡 Syntax Basics

Liquid uses two types of delimiters:
* **`{{ ... }}` (Output)**: Evaluates an expression and prints the result into the HTML output.
* **`{% ... %}` (Tags / Control Flow)**: Executes logic, loops, conditionals, or renders partials.

```liquid
<h1>{{ site.title | escape }}</h1>
<p>{{ site.description | escape }}</p>
```

---

## 🔀 Conditionals & Logic

### Basic `if` / `else`
```liquid
{% if post.featured %}
  <span class="badge badge-featured">Featured Story</span>
{% elsif post.tags.size > 0 %}
  <span class="badge">{{ post.tags[0].name | escape }}</span>
{% else %}
  <span class="badge">General</span>
{% endif %}
```

### Checking Boolean & Optional Values
```liquid
{% if settings.showAuthorAvatars and post.primaryAuthor.avatar %}
  <img src="{{ post.primaryAuthor.avatar }}" alt="{{ post.primaryAuthor.name | escape }}" class="avatar" />
{% endif %}

{% if post.featureImage.url %}
  <figure class="post-cover">
    <img src="{{ post.featureImage.url }}" alt="{{ post.featureImage.alt | default: post.title | escape }}" />
    {% if post.featureImage.caption %}
      <figcaption>{{ post.featureImage.caption | escape }}</figcaption>
    {% endif %}
  </figure>
{% endif %}
```

---

## 🔁 Iteration & Loops

### Looping Over Posts
```liquid
<div class="posts-grid">
  {% for item in posts %}
    <article class="post-card {% if item.featured %}featured{% endif %}">
      {% if item.featureImage.url %}
        <a href="{{ item.url }}" class="post-card-thumb">
          <img src="{{ item.featureImage.url }}" alt="{{ item.featureImage.alt | default: item.title | escape }}" loading="lazy" />
        </a>
      {% endif %}

      <div class="post-card-body">
        {% if item.tags.size > 0 %}
          {% assign primaryTag = item.tags[0] %}
          <a href="{{ primaryTag.url }}" class="post-tag">#{{ primaryTag.name | escape }}</a>
        {% endif %}

        <h2 class="post-card-title">
          <a href="{{ item.url }}">{{ item.title | escape }}</a>
        </h2>
        <p class="post-card-excerpt">
          {{ item.excerpt | excerpt: 140 | escape }}
        </p>
        <div class="post-card-meta">
          {% if item.publishedAt %}
            <time datetime="{{ item.publishedAt }}">{{ item.publishedAt | format_date }}</time>
          {% endif %}
          {% if item.readingTimeMinutes %}
            <span>•</span>
            <span>{{ item.readingTimeMinutes }} min read</span>
          {% endif %}
        </div>
      </div>
    </article>
  {% else %}
    <div class="empty-state">
      <h3>No posts published yet</h3>
      <p>Check back soon for new articles!</p>
    </div>
  {% endfor %}
</div>
```

---

## 🧩 Partials & Modular Components

Split your theme into reusable components located in `partials/`:

### Recommended Syntax: `{% render %}`
`{% render %}` runs in an isolated scope. Pass variables explicitly:

```liquid
{% render 'partials/header.liquid', site: site, settings: settings %}

<main class="site-main">
  <!-- Content here -->
</main>

{% render 'partials/footer.liquid', site: site %}
```

### Direct Inclusion: `{% include %}`
`{% include 'header' %}` inherits variables from the parent template scope:

```liquid
{% include 'header' %}
```

---

## 🏷️ Custom Vibress Liquid Filters

Vibress provides custom filters specifically designed for publishing:

| Filter | Usage Example | Output Example |
| :--- | :--- | :--- |
| `asset_url` | `{{ 'assets/css/theme.css' \| asset_url }}` | `/theme-assets/my-theme/1.0.0/assets/css/theme.css` |
| `post_url` | `{{ post.slug \| post_url }}` | `/posts/my-awesome-post` |
| `page_url` | `{{ page.slug \| page_url }}` | `/pages/about-us` |
| `tag_url` | `{{ tag.slug \| tag_url }}` | `/tags/technology` |
| `author_url` | `{{ author.slug \| author_url }}` | `/authors/jane-doe` |
| `format_date` | `{{ post.publishedAt \| format_date }}`<br>`{{ post.publishedAt \| format_date: 'iso' }}`<br>`{{ post.publishedAt \| format_date: 'year' }}` | `Aug 17, 2026`<br>`2026-08-17`<br>`2026` |
| `excerpt` | `{{ post.excerpt \| excerpt: 120 }}` | Truncates text to 120 characters and strips HTML tags cleanly |
| `pagination_url` | `{{ pagination.next \| pagination_url }}` | `/?page=2` (or `/` if page $\le 1$) |

---

## 🏷️ Custom Vibress Liquid Tags

Vibress also provides shortcut tags:

### 1. `{% asset %}` Tag
Resolves theme assets without manual URL concatenation:
```liquid
<img src="{% asset 'assets/images/logo.svg' %}" alt="{{ site.title | escape }}" />
```

### 2. `{% route %}` Tag
Generates platform URLs for resources:
```liquid
<a href="{% route 'post', post.slug %}">Read More</a>
<a href="{% route 'tag', tag.slug %}">View Tag Archive</a>
<a href="{% route 'home' %}">Back to Home</a>
```

---

## 🛡️ HTML Rendering vs Text Escaping Contract

* **Pre-Sanitized Article Content (`{{ post.html }}` / `{{ page.html }}`)**:
  Vibress sanitizes all post and page body HTML on the backend before injecting it into the Liquid context (blocking `<script>`, malicious attributes, and unapproved embeds). Output post body HTML directly:
  ```liquid
  <div class="prose studio-html-content">
    {{ post.html }}
  </div>
  ```
* **Plain Text Properties (Explicit Escaping Required)**:
  Plain text strings from ViewModels (`post.title`, `post.excerpt`, `author.name`, `tag.name`, `site.title`, `site.description`, custom text settings) must always be escaped with `| escape`:
  ```liquid
  <h1>{{ post.title | escape }}</h1>
  <p>{{ site.description | escape }}</p>
  <span>{{ author.name | escape }}</span>
  ```

---

Next: Read **[`05-VIEW-MODELS-REFERENCE.md`](./05-VIEW-MODELS-REFERENCE.md)** to see the full list of fields on `site`, `post`, `page`, `author`, `tag`, and `pagination`.
