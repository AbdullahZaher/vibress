import { describe, expect, it } from "vitest";
import {
  applyStructuredTranslation, collectTranslatableText, parseStructuredTranslation,
} from "../structured-ai-translation";

describe("structured AI translations", () => {
  const original = {
    schema: "vibress-studio",
    version: 1,
    root: {
      type: "doc",
      children: [
        { id: "n1", type: "paragraph", children: [{ id: "t1", type: "text", text: "Hello world" }] },
        { type: "image", url: "https://cdn.example.com/photo.jpg", caption: "A sunset" },
      ],
    },
  };

  it("extracts only text leaves while leaving IDs and media out of the prompt", () => {
    const segments = collectTranslatableText(original);
    expect(segments.map((x) => x.text)).toEqual(["Hello world", "A sunset"]);
    expect(JSON.stringify(segments)).not.toContain("cdn.example.com");
    expect(JSON.stringify(segments)).not.toContain("n1");
  });

  it("applies complete translations without modifying the original structured document", () => {
    const segments = collectTranslatableText(original);
    const response = parseStructuredTranslation(JSON.stringify({
      title: "عنوان عربي",
      excerpt: "وصف عربي",
      segments: Object.fromEntries(segments.map((s) =>
        [s.path, s.text === "Hello world" ? "مرحبًا بالعالم" : "غروب الشمس"])),
    }), segments);
    const result = applyStructuredTranslation(original, response);
    expect(result.root).not.toBe(original.root);
    expect(JSON.stringify(result)).toContain("مرحبًا بالعالم");
    expect(JSON.stringify(result)).toContain("cdn.example.com/photo.jpg");
    expect(JSON.stringify(result)).toContain('"id":"t1"');
    expect(JSON.stringify(original)).toContain("Hello world");
  });

  it("rejects omitted or injected fields and malformed provider JSON", () => {
    const segments = collectTranslatableText(original);
    expect(() => parseStructuredTranslation("not-json", segments)).toThrow();
    expect(() => parseStructuredTranslation(JSON.stringify({
      title: "مترجم", excerpt: "", segments: { [segments[0]!.path]: "مرحبا" },
    }), segments)).toThrow();
    expect(() => parseStructuredTranslation(JSON.stringify({
      title: "مترجم", excerpt: "",
      segments: { ...Object.fromEntries(segments.map(s => [s.path, "مرحبا"])), "/root/url": "evil" },
    }), segments)).toThrow();
  });

  it("enforces nesting and text length bounds", () => {
    expect(() => collectTranslatableText({ text: "x".repeat(80001) })).toThrow();
    let nested: Record<string, unknown> = { text: "leaf" };
    for (let i = 0; i < 43; i++) nested = { children: [nested] };
    expect(() => collectTranslatableText(nested)).toThrow();
  });
});
