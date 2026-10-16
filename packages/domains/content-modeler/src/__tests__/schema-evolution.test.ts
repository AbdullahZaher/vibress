import { describe, it, expect } from "vitest";
import { checkEntryDataValidity, analyzeSchemaEvolution, resolveLocalizedEntryData } from "../domain/validation";
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
    const _originalFields: ContentFieldDefinition[] = [
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
  it("blocks increasing field visibility, tightening constraints, and relation retargeting", () => {
    const base: ContentFieldDefinition[] = [
      { id: "a", name: "Private Cost", key: "cost", type: "number", apiVisibility: "private", max: 100 },
      { id: "b", name: "Author", key: "author", type: "relation", relationModel: "writers" },
    ];
    expect(analyzeSchemaEvolution(base, [
      { ...base[0]!, apiVisibility: "public" },
      base[1]!,
    ]).safe).toBe(false);
    expect(analyzeSchemaEvolution(base, [
      { ...base[0]!, max: 10 },
      base[1]!,
    ]).safe).toBe(false);
    expect(analyzeSchemaEvolution(base, [
      base[0]!,
      { ...base[1]!, relationModel: "accounts" },
    ]).safe).toBe(false);
  });

  it("treats tightened legacy nested constraints as unsafe", () => {
    const oldNumber = {
      id: "n", name: "Score", key: "score", type: "number" as const,
      validation: { min: 1, max: 100 },
    };
    expect(analyzeSchemaEvolution([oldNumber], [
      { ...oldNumber, validation: { min: 5, max: 100 } },
    ]).safe).toBe(false);
    expect(analyzeSchemaEvolution([oldNumber], [
      { ...oldNumber, max: 50 },
    ]).safe).toBe(false);

    const oldText = {
      id: "t", name: "Title", key: "title", type: "text" as const,
      validation: { minLength: 2, maxLength: 200, pattern: "^[a-z]+$" },
    };
    for (const updated of [
      { ...oldText, validation: { ...oldText.validation, minLength: 10 } },
      { ...oldText, maxLength: 50 },
      { ...oldText, validation: { ...oldText.validation, pattern: "^[A-Z]+$" } },
    ]) {
      const diff = analyzeSchemaEvolution([oldText], [updated]);
      expect(diff.safe).toBe(false);
      expect(diff.changes[0]?.isSafe).toBe(false);
    }
  });

  it("uses the effective top-level-first constraints and permits relaxation", () => {
    const base = {
      id: "n", name: "Score", key: "score", type: "number" as const,
      min: 4, validation: { min: 1, max: 10 },
    };
    expect(analyzeSchemaEvolution([base], [
      { ...base, validation: { min: 8, max: 20 } },
    ]).safe).toBe(true); // top-level min=4 still takes precedence
    expect(analyzeSchemaEvolution([base], [
      { ...base, min: 2, validation: { min: 1, max: 20 } },
    ]).safe).toBe(true);
    expect(analyzeSchemaEvolution([base], [
      { ...base, min: 5 },
    ]).safe).toBe(false);
  });

  it("blocks new required fields until existing records are migrated, even with defaults", () => {
    const diff = analyzeSchemaEvolution([], [
      { id: "new", key: "mandatory", name: "Required", type: "text", required: true, defaultValue: "x" },
    ]);
    expect(diff.safe).toBe(false);
  });

  it("resolves historical regional locale keys without changing stored dictionaries", () => {
    const fields: ContentFieldDefinition[] = [
      { id: "name", key: "name", name: "Name", type: "text", localizable: true },
    ];
    const persisted = { name: { "ar-SA": "مرحبا", en: "Hello" } };
    const result = resolveLocalizedEntryData(persisted, fields, "ar-SA", "en");
    expect(result.name).toBe("مرحبا");
    expect(persisted.name["ar-SA"]).toBe("مرحبا");
    expect(resolveLocalizedEntryData(persisted, fields, "fr-FR", "en").name).toBe("Hello");
  });

});
