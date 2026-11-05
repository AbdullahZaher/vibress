import { describe, expect, it } from "vitest";
import { StudioMigrationError } from "@vibress/studio-core";
import { htmlToStudioDocument } from "../index";

describe("host HTML import resource admission", () => {
  it("rejects HTML exceeding source-byte budget before sanitizer parsing", () => {
    const html = "<p>" + "😀".repeat(200) + "</p>";
    expect(() => htmlToStudioDocument(html, { maxSizeBytes: 200 }))
      .toThrow(StudioMigrationError);
  });
  it("rejects imported documents exceeding AST budget without truncation", () => {
    const html = Array.from({ length: 15 }, (_, i) => `<p>paragraph ${i}</p>`).join("");
    expect(() => htmlToStudioDocument(html, { maxNodeCount: 5 }))
      .toThrow(StudioMigrationError);
    expect(htmlToStudioDocument(html).root.children).toHaveLength(15);
  });
});
