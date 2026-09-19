import { describe, it, expect } from "vitest";
import { createLiquidThemeEngine } from "../theme-engine";

describe("Theme Core — Liquid Theme Engine", () => {
  it("renders basic template with context variables", async () => {
    const engine = createLiquidThemeEngine({
      files: {
        "templates/home.liquid": "<h1>{{ site.title }}</h1><p>{{ site.description }}</p>",
      },
    });

    const output = await engine.renderFile("templates/home.liquid", {
      site: { title: "Vibress News", description: "The premier publication" },
    });

    expect(output).toBe("<h1>Vibress News</h1><p>The premier publication</p>");
  });

  it("renders partials and includes correctly", async () => {
    const engine = createLiquidThemeEngine({
      files: {
        "partials/header.liquid": "<header><nav>{{ site.title }}</nav></header>",
        "templates/home.liquid": "{% include 'header' %}<main>Content</main>",
      },
    });

    const output = await engine.renderFile("templates/home.liquid", {
      site: { title: "My Site" },
    });

    expect(output).toContain("<header><nav>My Site</nav></header>");
    expect(output).toContain("<main>Content</main>");
  });

  it("supports custom filters: asset_url, post_url, excerpt, format_date, and t filter with named params", async () => {
    const engine = createLiquidThemeEngine({
      themeId: "custom-news",
      themeVersion: "2.1.0",
      files: {
        "locales/en.json": JSON.stringify({
          "meta.min_read": "%{minutes} min read",
        }),
        "templates/post.liquid": `
          <link rel="stylesheet" href="{{ 'css/main.css' | asset_url }}">
          <a href="{{ post.slug | post_url }}">{{ post.title }}</a>
          <span class="date">{{ post.publishedAt | format_date: "medium" }}</span>
          <span class="reading-time">{{ 'meta.min_read' | t: minutes: post.readingTimeMinutes }}</span>
          <p>{{ post.html | excerpt: 20 }}</p>
        `,
      },
    });

    const output = await engine.renderFile("templates/post.liquid", {
      post: {
        title: "Hello World",
        slug: "hello-world",
        publishedAt: "2026-08-16T12:00:00Z",
        readingTimeMinutes: 5,
        html: "<p>This is a <strong>very long</strong> article content body with rich text formatting.</p>",
      },
    });

    expect(output).toContain('href="/theme-assets/custom-news/2.1.0/css/main.css"');
    expect(output).toContain('href="/posts/hello-world"');
    expect(output).toContain("Aug 16, 2026");
    expect(output).toContain('<span class="reading-time">5 min read</span>');
    expect(output).toContain("This is a very long...");
  });

  it("supports custom tags: {% asset %} and {% route %}", async () => {
    const engine = createLiquidThemeEngine({
      themeId: "modern-blog",
      themeVersion: "1.0.0",
      files: {
        "templates/home.liquid": `
          <link rel="stylesheet" href="{% asset 'css/theme.css' %}">
          <a href="{% route 'post', 'first-post' %}">Read First</a>
        `,
      },
    });

    const output = await engine.renderFile("templates/home.liquid", {});

    expect(output).toContain('href="/theme-assets/modern-blog/1.0.0/css/theme.css"');
    expect(output).toContain('href="/posts/first-post"');
  });

  it("loops over post collections and pagination smoothly", async () => {
    const engine = createLiquidThemeEngine({
      files: {
        "templates/home.liquid": `
          <ul>
            {% for post in posts %}
              <li><a href="{{ post.url }}">{{ post.title }}</a></li>
            {% endfor %}
          </ul>
          {% if pagination.hasNext %}
            <a href="{{ pagination.next | pagination_url }}">Next Page</a>
          {% endif %}
        `,
      },
    });

    const output = await engine.renderFile("templates/home.liquid", {
      posts: [
        { title: "Post 1", url: "/posts/post-1" },
        { title: "Post 2", url: "/posts/post-2" },
      ],
      pagination: {
        page: 1,
        next: 2,
        hasNext: true,
      },
    });

    expect(output).toContain('<li><a href="/posts/post-1">Post 1</a></li>');
    expect(output).toContain('<li><a href="/posts/post-2">Post 2</a></li>');
    expect(output).toContain('href="/?page=2"');
  });

  describe("Liquid {% comments %} Tag", () => {
    it("renders semantic comments mount with correct attributes", async () => {
      const engine = createLiquidThemeEngine({
        files: {
          "templates/post.liquid": `
            <article>
              <h1>{{ post.title }}</h1>
              {% comments %}
            </article>
          `,
        },
      });

      const output = await engine.renderFile("templates/post.liquid", {
        post: {
          id: "post_123",
          slug: "test-post",
          title: "Test Post",
          commentCount: 5,
        },
        site: {
          comments: {
            commentAccess: "public",
          },
        },
      });

      expect(output).toContain('class="vb-comments-section"');
      expect(output).toContain('data-post-id="post_123"');
      expect(output).toContain('data-post-slug="test-post"');
      expect(output).toContain('data-comment-count="5"');
      expect(output).toContain('data-access="public"');
      expect(output).toContain('class="vb-comments-noscript"');
    });

    it("renders comments tag with custom post parameter: {% comments post: customPost %}", async () => {
      const engine = createLiquidThemeEngine({
        files: {
          "templates/custom.liquid": `{% comments post: article %}`,
        },
      });

      const output = await engine.renderFile("templates/custom.liquid", {
        article: {
          id: "post_custom_999",
          slug: "custom-article",
          title: "Custom Article",
          commentCount: 12,
        },
        site: {
          commentAccess: "members_only",
        },
      });

      expect(output).toContain('data-post-id="post_custom_999"');
      expect(output).toContain('data-post-slug="custom-article"');
      expect(output).toContain('data-comment-count="12"');
      expect(output).toContain('data-access="members_only"');
    });

    it("does not render comments mount when comments are disabled", async () => {
      const engine = createLiquidThemeEngine({
        files: {
          "templates/post.liquid": `<main>{% comments %}</main>`,
        },
      });

      const outputDisabled1 = await engine.renderFile("templates/post.liquid", {
        post: { id: "post_123", slug: "test-post" },
        site: { commentsEnabled: false },
      });
      expect(outputDisabled1).toBe("<main></main>");

      const outputDisabled2 = await engine.renderFile("templates/post.liquid", {
        post: { id: "post_123", slug: "test-post" },
        site: { comments: { commentAccess: "disabled" } },
      });
      expect(outputDisabled2).toBe("<main></main>");
    });
  });
});

