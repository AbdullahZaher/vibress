import { describe, it, expect } from "vitest";
import {
  createLiquidThemeEngine,
  buildCollectionEntryViewModel,
  ThemeViewModelContext,
} from "../index";

describe("Theme Core Liquid Custom Collections Integration", () => {
  it("renders collection entries from collections dictionary and collection_url filter", async () => {
    const engine = createLiquidThemeEngine();

    const book1 = buildCollectionEntryViewModel({
      id: "entry_1",
      modelSlug: "books",
      title: "Clean Architecture",
      slug: "clean-architecture",
      data: { author: "Robert C. Martin", pages: 432, price: 39.99 },
      publishedAt: new Date("2026-01-15T00:00:00Z"),
      createdAt: new Date("2026-01-15T00:00:00Z"),
    });

    const book2 = buildCollectionEntryViewModel({
      id: "entry_2",
      modelSlug: "books",
      title: "Refactoring",
      slug: "refactoring",
      data: { author: "Martin Fowler", pages: 448, price: 44.99 },
      publishedAt: new Date("2026-02-20T00:00:00Z"),
      createdAt: new Date("2026-02-20T00:00:00Z"),
    });

    const context: ThemeViewModelContext = {
      site: { title: "Vibress Library", url: "https://example.com" } as any,
      collections: {
        books: [book1, book2],
      },
    };

    const template = `
      <h1>{{ site.title }}</h1>
      <div class="books-list">
        {% for book in collections.books %}
          <div class="book-card">
            <a href="{{ 'books' | collection_url: book.slug }}">{{ book.title }}</a>
            <p>Author: {{ book.author }} | Pages: {{ book.pages }} | Price: USD {{ book.price }}</p>
          </div>
        {% endfor %}
      </div>
    `;

    const rendered = await engine.parseAndRender(template, context);

    expect(rendered).toContain("Clean Architecture");
    expect(rendered).toContain("Refactoring");
    expect(rendered).toContain('href="/collections/books/clean-architecture"');
    expect(rendered).toContain("Author: Robert C. Martin");
    expect(rendered).toContain("Pages: 448");
  });

  it("supports {% collection %} tag with limit and alias scoping", async () => {
    const engine = createLiquidThemeEngine();

    const p1 = buildCollectionEntryViewModel({
      id: "p1",
      modelSlug: "products",
      title: "Laptop Pro",
      slug: "laptop-pro",
      data: { price: 1999 },
    });
    const p2 = buildCollectionEntryViewModel({
      id: "p2",
      modelSlug: "products",
      title: "Wireless Mouse",
      slug: "wireless-mouse",
      data: { price: 49 },
    });
    const p3 = buildCollectionEntryViewModel({
      id: "p3",
      modelSlug: "products",
      title: "Mechanical Keyboard",
      slug: "mech-keyboard",
      data: { price: 129 },
    });

    const context: ThemeViewModelContext = {
      collections: {
        products: [p1, p2, p3],
      },
    };

    const template = `
      {% collection "products", limit: 2 as featured %}
      <ul>
        {% for item in featured %}
          <li>{{ item.title }} - USD {{ item.price }} ({{ 'products' | collection_url: item.slug }})</li>
        {% endfor %}
      </ul>
    `;

    const rendered = await engine.parseAndRender(template, context);

    expect(rendered).toContain("Laptop Pro - USD 1999");
    expect(rendered).toContain("Wireless Mouse - USD 49");
    // Limit: 2 means item 3 should NOT appear
    expect(rendered).not.toContain("Mechanical Keyboard");
    expect(rendered).toContain("/collections/products/laptop-pro");
  });

  it("supports locale-aware collection URLs", async () => {
    const engine = createLiquidThemeEngine();

    const book = buildCollectionEntryViewModel(
      {
        id: "b1",
        modelSlug: "books",
        title: "كتاب البرمجة",
        slug: "programming-book",
        data: {},
      },
      "ar",
    );

    const context: ThemeViewModelContext = {
      locale: "ar",
      collections: {
        books: [book],
      },
    };

    const template = `<a href="{{ 'books' | collection_url: 'programming-book', 'ar' }}">{{ collections.books[0].title }}</a>`;
    const rendered = await engine.parseAndRender(template, context);

    expect(rendered).toContain('href="/ar/collections/books/programming-book"');
    expect(rendered).toContain("كتاب البرمجة");
  });
});
