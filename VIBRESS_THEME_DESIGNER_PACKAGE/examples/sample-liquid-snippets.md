# Sample Liquid Snippets for Vibress Themes

A collection of copy-pasteable Liquid template patterns ready for your custom Vibress theme.

---

## 1. 🏠 Responsive Article Card (`partials/card.liquid`)

```liquid
<article class="post-card {% if item.featured %}post-card-featured{% endif %}">
  {% if item.featureImage %}
    <a href="{{ item.url }}" class="post-card-image-link" aria-label="{{ item.title }}">
      <img
        src="{{ item.featureImage.url }}"
        alt="{{ item.featureImage.alt | default: item.title }}"
        class="post-card-image"
        loading="lazy"
      />
    </a>
  {% endif %}

  <div class="post-card-content">
    {% if item.tags.size > 0 %}
      <div class="post-card-tags">
        <a href="{{ item.tags[0].url }}" class="tag-badge">
          {{ item.tags[0].name }}
        </a>
      </div>
    {% endif %}

    <h2 class="post-card-title">
      <a href="{{ item.url }}">{{ item.title }}</a>
    </h2>

    <p class="post-card-excerpt">
      {{ item.excerpt | default: item.html | excerpt: 140 }}
    </p>

    <footer class="post-card-meta">
      {% if settings.showAuthorAvatars and item.primaryAuthor.avatar %}
        <img
          src="{{ item.primaryAuthor.avatar }}"
          alt="{{ item.primaryAuthor.name }}"
          class="author-avatar-small"
        />
      {% endif %}

      <div class="meta-details">
        {% if item.primaryAuthor %}
          <a href="{{ item.primaryAuthor.url }}" class="author-name">
            {{ item.primaryAuthor.name }}
          </a>
        {% endif %}

        <div class="meta-sub">
          <time datetime="{{ item.publishedAt }}">{{ item.publishedAt | format_date }}</time>
          {% if settings.showReadingTime %}
            <span class="meta-divider">•</span>
            <span>{{ item.readingTimeMinutes }} min read</span>
          {% endif %}
        </div>
      </div>
    </footer>
  </div>
</article>
```

---

## 2. 🔝 Site Header & Pure-CSS Mobile Navigation (`partials/header.liquid`)

```liquid
<header class="site-header">
  <div class="header-inner">
    <!-- Brand / Logo -->
    <a href="/" class="brand">
      {% if site.logo %}
        <img src="{{ site.logo }}" alt="{{ site.title }}" class="site-logo" />
      {% else %}
        <span class="site-title">{{ site.title }}</span>
      {% endif %}
    </a>

    <!-- Desktop Navigation -->
    <nav class="desktop-nav" aria-label="Primary Navigation">
      <ul class="nav-menu">
        {% for item in site.navigation.primary %}
          <li><a href="{{ item.url }}">{{ item.label }}</a></li>
        {% endfor %}
      </ul>
    </nav>

    <!-- Pure CSS Mobile Disclosure Nav -->
    <div class="mobile-nav-wrapper">
      <details class="mobile-disclosure">
        <summary class="mobile-toggle-btn" aria-label="Toggle menu">
          <span class="hamburger-icon">☰</span>
        </summary>
        <div class="mobile-dropdown">
          {% for item in site.navigation.primary %}
            <a href="{{ item.url }}" class="mobile-nav-item">{{ item.label }}</a>
          {% endfor %}
        </div>
      </details>
    </div>
  </div>
</header>
```

---

## 3. 📄 Article Layout (`templates/post.liquid`)

```liquid
{% render 'partials/header.liquid', site: site, settings: settings %}

<main class="post-layout container">
  <article class="post-single">
    <header class="post-header">
      {% if post.tags.size > 0 %}
        <div class="post-tags-list">
          {% for tag in post.tags %}
            <a href="{{ tag.url }}" class="post-tag-item">#{{ tag.name }}</a>
          {% endfor %}
        </div>
      {% endif %}

      <h1 class="post-title">{{ post.title }}</h1>

      {% if post.excerpt %}
        <p class="post-lead">{{ post.excerpt }}</p>
      {% endif %}

      <div class="post-byline">
        {% if post.primaryAuthor %}
          {% if settings.showAuthorAvatars and post.primaryAuthor.avatar %}
            <img src="{{ post.primaryAuthor.avatar }}" alt="{{ post.primaryAuthor.name }}" class="author-portrait" />
          {% endif %}
          <div>
            <div class="author-name-lead">{{ post.primaryAuthor.name }}</div>
            <div class="byline-meta">
              <time datetime="{{ post.publishedAt }}">{{ post.publishedAt | format_date }}</time>
              <span>•</span>
              <span>{{ post.readingTimeMinutes }} min read</span>
            </div>
          </div>
        {% endif %}
      </div>
    </header>

    {% if post.featureImage %}
      <figure class="post-feature-image-wrapper">
        <img src="{{ post.featureImage.url }}" alt="{{ post.featureImage.alt | default: post.title }}" />
        {% if post.featureImage.caption %}
          <figcaption>{{ post.featureImage.caption }}</figcaption>
        {% endif %}
      </figure>
    {% endif %}

    <!-- Sanitized Article Body -->
    <div class="post-body-prose">
      {{ post.html }}
    </div>

    <!-- Author Biography Footer -->
    {% if post.primaryAuthor and post.primaryAuthor.bio %}
      <div class="author-bio-card">
        {% if post.primaryAuthor.avatar %}
          <img src="{{ post.primaryAuthor.avatar }}" alt="{{ post.primaryAuthor.name }}" class="bio-avatar" />
        {% endif %}
        <div>
          <h3>About {{ post.primaryAuthor.name }}</h3>
          <p>{{ post.primaryAuthor.bio }}</p>
          <a href="{{ post.primaryAuthor.url }}" class="bio-link">View all stories &rarr;</a>
        </div>
      </div>
    {% endif %}
  </article>
</main>

{% render 'partials/footer.liquid', site: site, settings: settings %}
```

---

## 4. 🧭 Pagination Bar (`partials/pagination.liquid`)

```liquid
{% if pagination.pages > 1 %}
  <nav class="pagination-container" aria-label="Pagination Navigation">
    {% if pagination.hasPrevious %}
      <a href="{{ pagination.previous | pagination_url }}" class="page-link prev-link">
        &larr; Newer Articles
      </a>
    {% else %}
      <span class="page-link disabled">&larr; Newer Articles</span>
    {% endif %}

    <span class="pagination-info">
      Page <strong>{{ pagination.page }}</strong> of <strong>{{ pagination.pages }}</strong>
    </span>

    {% if pagination.hasNext %}
      <a href="{{ pagination.next | pagination_url }}" class="page-link next-link">
        Older Articles &rarr;
      </a>
    {% else %}
      <span class="page-link disabled">Older Articles &rarr;</span>
    {% endif %}
  </nav>
{% endif %}
```

---

## 5. 🏷️ Tag Archive Header (`templates/tag.liquid`)

```liquid
{% render 'partials/header.liquid', site: site, settings: settings %}

<main class="container archive-container">
  <header class="archive-hero">
    <div class="archive-tag-badge">Topic</div>
    <h1 class="archive-title">{{ tag.name }}</h1>
    {% if tag.description %}
      <p class="archive-description">{{ tag.description }}</p>
    {% endif %}
    <div class="archive-count">{{ pagination.total }} published stories</div>
  </header>

  <div class="posts-grid">
    {% for item in posts %}
      {% render 'partials/card.liquid', item: item, settings: settings %}
    {% else %}
      <div class="empty-state">No articles tagged with "{{ tag.name }}" yet.</div>
    {% endfor %}
  </div>

  {% render 'partials/pagination.liquid', pagination: pagination %}
</main>

{% render 'partials/footer.liquid', site: site, settings: settings %}
```
