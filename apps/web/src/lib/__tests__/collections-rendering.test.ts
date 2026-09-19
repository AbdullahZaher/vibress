import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildPageMetadata } from "../seo-helpers";
import { buildCollectionEntryViewModel, mapPaginationToViewModel } from "@vibress/theme-core";

describe("Web Collections Rendering & SEO", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, SITE_URL: "https://vibress.example.com" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });
  it("builds collection metadata and canonical path properly", () => {
    const meta = buildPageMetadata({
      title: "Books Collection | Vibress Site",
      description: "Browse curated books",
      canonicalPath: "/collections/books",
      ogType: "website",
    });

    expect(meta.title).toBe("Books Collection | Vibress Site");
    expect(meta.description).toBe("Browse curated books");
    expect(meta.alternates?.canonical).toBe("https://vibress.example.com/collections/books");
    expect((meta.openGraph as Record<string, unknown> | undefined)?.type).toBe("website");
  });

  it("builds single collection entry metadata and canonical path properly", () => {
    const meta = buildPageMetadata({
      title: "The Great Gatsby | Vibress Site",
      description: "View The Great Gatsby in books on Vibress Site",
      canonicalPath: "/collections/books/the-great-gatsby",
      ogType: "article",
    });

    expect(meta.title).toBe("The Great Gatsby | Vibress Site");
    expect(meta.alternates?.canonical).toBe("https://vibress.example.com/collections/books/the-great-gatsby");
    expect((meta.openGraph as Record<string, unknown> | undefined)?.type).toBe("article");
  });

  it("maps collection entries to view models correctly with direct field access", () => {
    const rawEntry = {
      id: "entry_book_1",
      modelSlug: "books",
      title: "The Great Gatsby",
      slug: "the-great-gatsby",
      data: {
        author_name: "F. Scott Fitzgerald",
        price: 19.99,
        is_hardcover: true,
        summary: "A novel set in the Jazz Age.",
      },
      publishedAt: new Date("2026-08-01T12:00:00.000Z"),
      createdAt: new Date("2026-08-01T10:00:00.000Z"),
      updatedAt: new Date("2026-08-01T12:00:00.000Z"),
    };

    const vm = buildCollectionEntryViewModel(rawEntry);

    expect(vm.id).toBe("entry_book_1");
    expect(vm.modelSlug).toBe("books");
    expect(vm.title).toBe("The Great Gatsby");
    expect(vm.slug).toBe("the-great-gatsby");
    expect(vm.url).toBe("/collections/books/the-great-gatsby");
    expect(vm.data.price).toBe(19.99);

    // Direct property access on the view model
    expect((vm as any).author_name).toBe("F. Scott Fitzgerald");
    expect((vm as any).price).toBe(19.99);
    expect((vm as any).is_hardcover).toBe(true);
  });

  it("handles pagination mapping for collection views", () => {
    const pagination = mapPaginationToViewModel({
      page: 2,
      limit: 10,
      total: 35,
      pages: 4,
    });

    expect(pagination.page).toBe(2);
    expect(pagination.limit).toBe(10);
    expect(pagination.total).toBe(35);
    expect(pagination.pages).toBe(4);
    expect(pagination.hasPrevious).toBe(true);
    expect(pagination.hasNext).toBe(true);
    expect(pagination.previous).toBe(1);
    expect(pagination.next).toBe(3);
  });
});
