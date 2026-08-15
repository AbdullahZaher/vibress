import { describe, it, expect } from "vitest";
import { checkEntryDataValidity } from "../domain/validation";
import { ContentFieldDefinition } from "../domain/types";

describe("Content Modeler Schema Evolution & Data Safety", () => {
  it("preserves existing entry data when new optional fields are added to schema", () => {
    const originalFields: ContentFieldDefinition[] = [
      { id: "f1", name: "Title", key: "title", type: "text", required: true },
      { id: "f2", name: "Author", key: "author", type: "text", required: false },
    ];

    const existingEntryData = {
      title: "How to Build with Vibress",
      author: "Abdullah",
    };

    // Valid on original schema
    expect(checkEntryDataValidity(existingEntryData, originalFields).valid).toBe(true);

    // Schema evolution: Add field 'subtitle' and 'publishedDate'
    const evolvedFields: ContentFieldDefinition[] = [
      ...originalFields,
      { id: "f3", name: "Subtitle", key: "subtitle", type: "text", required: false },
      { id: "f4", name: "Published Date", key: "publishedDate", type: "date", required: false },
    ];

    // Existing entry data must remain valid without requiring immediate backfill
    const result = checkEntryDataValidity(existingEntryData, evolvedFields);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it("handles field renaming and migration gracefully", () => {
    const originalFields: ContentFieldDefinition[] = [
      { id: "f1", name: "Summary", key: "summary", type: "text", required: true },
    ];
    const data = { summary: "Brief overview" };
    expect(checkEntryDataValidity(data, originalFields).valid).toBe(true);

    // Rename summary -> excerpt with compatibility alias
    const evolvedFields: ContentFieldDefinition[] = [
      { id: "f1", name: "Excerpt", key: "excerpt", type: "text", required: false },
    ];

    // Excerpt optional allows legacy entries with 'summary' to still validate safely
    expect(checkEntryDataValidity(data, evolvedFields).valid).toBe(true);
  });

  it("safely handles field deprecation and removal", () => {
    const originalFields: ContentFieldDefinition[] = [
      { id: "f1", name: "Title", key: "title", type: "text", required: true },
      { id: "f2", name: "Legacy Rating", key: "legacyRating", type: "number", required: false },
    ];

    const entryData = {
      title: "Advanced TypeScript Patterns",
      legacyRating: 5,
    };

    // Remove legacyRating from active fields
    const updatedFields: ContentFieldDefinition[] = [
      { id: "f1", name: "Title", key: "title", type: "text", required: true },
    ];

    // Extra unknown keys in JSONB payload should not fail validation for published entries
    const result = checkEntryDataValidity(entryData, updatedFields);
    expect(result.valid).toBe(true);
  });

  it("validates stricter constraints on newly saved values while reporting specific errors", () => {
    const fieldsWithLimits: (ContentFieldDefinition & { validation?: { min?: number; max?: number } })[] = [
      {
        id: "f1",
        name: "Priority",
        key: "priorityScore",
        type: "number",
        required: true,
        validation: { min: 1, max: 10 },
      },
    ];

    expect(checkEntryDataValidity({ priorityScore: 7 }, fieldsWithLimits).valid).toBe(true);

    const invalidMax = checkEntryDataValidity({ priorityScore: 15 }, fieldsWithLimits);
    expect(invalidMax.valid).toBe(false);
    expect(invalidMax.errors[0]?.field).toBe("priorityScore");
    expect(invalidMax.errors[0]?.message).toContain("maximum value 10");
  });
});
