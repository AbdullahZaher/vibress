import { describe, expect, it } from "vitest";
import { relationKey, relationKeys } from "../RelationEntryPicker";

describe("Collection relation picker compatibility", () => {
  it("recognizes historical IDs, slugs, and structured references", () => {
    expect(relationKey("entry-1")).toBe("entry-1");
    expect(relationKey({ id: "entry-2", slug: "old-slug" })).toBe("entry-2");
    expect(relationKey({ slug: "legacy-slug" })).toBe("legacy-slug");
    expect(relationKey(null)).toBe("");
    expect(relationKeys(["entry-1", { slug: "legacy-slug" }, null])).toEqual([
      "entry-1", "legacy-slug",
    ]);
  });

  it("does not treat unrelated data as a relation", () => {
    expect(relationKey({ title: "Missing identifier" })).toBe("");
    expect(relationKeys({ id: "not-an-array" })).toEqual([]);
  });
});
