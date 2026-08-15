import { describe, it, expect } from "vitest";
import {
  validateEntryData,
  checkEntryDataValidity,
  filterEntryDataForVisibility,
  extractSearchableText,
  extractFilterableAttributes,
  ValidationError,
  ContentFieldDefinition,
} from "../index";

describe("Content Modeler — 16 Field Types & Constraints Suite", () => {
  const schema: ContentFieldDefinition[] = [
    { id: "1", name: "Short Title", key: "shortTitle", type: "short_text", required: true, minLength: 3, maxLength: 50 },
    { id: "2", name: "Article Body", key: "articleBody", type: "rich_text", required: true },
    { id: "3", name: "Price", key: "price", type: "number", required: true, min: 0, max: 10000 },
    { id: "4", name: "Featured", key: "featured", type: "boolean", required: true },
    { id: "5", name: "Event Date", key: "eventDate", type: "date", required: true },
    { id: "6", name: "Starts At", key: "startsAt", type: "datetime" },
    { id: "7", name: "Website", key: "website", type: "url" },
    { id: "8", name: "Contact Email", key: "contactEmail", type: "email" },
    { id: "9", name: "Category", key: "category", type: "select", options: [{ label: "Tech", value: "tech" }, { label: "Art", value: "art" }] },
    { id: "10", name: "Tags", key: "tags", type: "multi_select", options: [{ label: "News", value: "news" }, { label: "Review", value: "review" }] },
    { id: "11", name: "Cover Image", key: "coverImage", type: "media" },
    { id: "12", name: "Topic", key: "topic", type: "taxonomy" },
    { id: "13", name: "Author Relation", key: "authorRef", type: "relation" },
    { id: "14", name: "Related Posts", key: "relatedPosts", type: "relation_list" },
    { id: "15", name: "Extra Metadata", key: "metadata", type: "json" },
    { id: "16", name: "Custom Code", key: "customCode", type: "text", pattern: "^[A-Z]{3}-[0-9]{3}$" },
  ];

  it("passes validation when all 16 field types have conforming data", () => {
    const validData = {
      shortTitle: "Breaking Technology Announcement",
      articleBody: "{\"root\":{\"children\":[]}}",
      price: 299.99,
      featured: true,
      eventDate: "2026-08-15",
      startsAt: "2026-08-15T18:00:00.000Z",
      website: "https://vibress.org",
      contactEmail: "editor@vibress.org",
      category: "tech",
      tags: ["news", "review"],
      coverImage: "media/123/banner.webp",
      topic: ["tech", "ai"],
      authorRef: "user_123",
      relatedPosts: ["post_1", "post_2"],
      metadata: { views: 100, sponsor: true },
      customCode: "VIB-999",
    };

    expect(() => validateEntryData(validData, schema)).not.toThrow();
    const check = checkEntryDataValidity(validData, schema);
    expect(check.valid).toBe(true);
    expect(check.errors).toHaveLength(0);
  });

  it("catches errors across URL, email, regex pattern, and numerical bounds", () => {
    const invalidData = {
      shortTitle: "AB", // too short (minLength: 3)
      articleBody: "Content",
      price: -50, // below min 0
      featured: "yes", // not boolean
      eventDate: "not-a-date",
      website: "ftp-invalid-url",
      contactEmail: "not-an-email",
      category: "sports", // not in allowed options
      tags: ["unknown-tag"], // invalid option
      customCode: "invalid-code", // pattern violation
    };

    expect(() => validateEntryData(invalidData, schema)).toThrow(ValidationError);

    const check = checkEntryDataValidity(invalidData, schema);
    expect(check.valid).toBe(false);
    const errorFields = check.errors.map((e) => e.field);
    expect(errorFields).toContain("shortTitle");
    expect(errorFields).toContain("price");
    expect(errorFields).toContain("featured");
    expect(errorFields).toContain("eventDate");
    expect(errorFields).toContain("website");
    expect(errorFields).toContain("contactEmail");
    expect(errorFields).toContain("category");
    expect(errorFields).toContain("tags");
    expect(errorFields).toContain("customCode");
  });
  it("filters private and authenticated fields based on role visibility", () => {
    const visibilitySchema: ContentFieldDefinition[] = [
      { id: "1", name: "Public Title", key: "title", type: "short_text", apiVisibility: "public" },
      { id: "2", name: "Member Secret", key: "memberSecret", type: "text", apiVisibility: "authenticated" },
      { id: "3", name: "Internal Admin Note", key: "adminNote", type: "text", apiVisibility: "private" },
    ];

    const data = {
      title: "Public Product Announcement",
      memberSecret: "VIP Discount 50%",
      adminNote: "Review complete by staff",
    };

    // Public role sees only public
    const publicData = filterEntryDataForVisibility(data, visibilitySchema, "public");
    expect(publicData).toEqual({ title: "Public Product Announcement" });

    // Authenticated member role sees public + authenticated
    const authData = filterEntryDataForVisibility(data, visibilitySchema, "authenticated");
    expect(authData).toEqual({
      title: "Public Product Announcement",
      memberSecret: "VIP Discount 50%",
    });

    // Staff admin sees all
    const staffData = filterEntryDataForVisibility(data, visibilitySchema, "staff_admin");
    expect(staffData).toEqual(data);
  });

  it("extracts searchable text and filterable attributes correctly", () => {
    const mixedSchema: ContentFieldDefinition[] = [
      { id: "1", name: "Title", key: "title", type: "short_text", searchable: true, filterable: true },
      { id: "2", name: "Tags", key: "tags", type: "multi_select", searchable: true, filterable: true },
      { id: "3", name: "Views", key: "views", type: "number", searchable: false, filterable: true },
      { id: "4", name: "Studio Document", key: "doc", type: "studio_doc", searchable: true },
    ];

    const data = {
      title: "Vibress Engine",
      tags: ["tech", "ai"],
      views: 1200,
      doc: { root: { type: "root", text: "Rich content" } },
    };

    const searchableText = extractSearchableText(data, mixedSchema);
    expect(searchableText).toContain("Vibress Engine");
    expect(searchableText).toContain("tech ai");

    const filterableAttrs = extractFilterableAttributes(data, mixedSchema);
    expect(filterableAttrs).toEqual({
      title: "Vibress Engine",
      tags: ["tech", "ai"],
      views: 1200,
    });
  });
});
