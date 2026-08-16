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

  it("supports custom filters: asset_url, post_url, excerpt, format_date", async () => {
    const engine = createLiquidThemeEngine({
      themeId: "custom-news",
      themeVersion: "2.1.0",
      files: {
        "templates/post.liquid": `
          <link rel="stylesheet" href="{{ 'css/main.css' | asset_url }}">
          <a href="{{ post.slug | post_url }}">{{ post.title }}</a>
          <span class="date">{{ post.publishedAt | format_date: "medium" }}</span>
          <p>{{ post.html | excerpt: 20 }}</p>
        `,
      },
    });

    const output = await engine.renderFile("templates/post.liquid", {
      post: {
        title: "Hello World",
        slug: "hello-world",
        publishedAt: "2026-08-16T12:00:00Z",
        html: "<p>This is a <strong>very long</strong> article content body with rich text formatting.</p>",
      },
    });

    expect(output).toContain('href="/theme-assets/custom-news/2.1.0/css/main.css"');
    expect(output).toContain('href="/posts/hello-world"');
    expect(output).toContain("Aug 16, 2026");
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
});
