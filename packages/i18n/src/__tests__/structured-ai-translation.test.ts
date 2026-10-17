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

  it("rejects injected root keys that could attempt privilege escalation or state modification", () => {
    const segments = collectTranslatableText(original);
    const validSegments = Object.fromEntries(segments.map(s => [s.path, "مترجم"]));
    
    // Injected status
    expect(() => parseStructuredTranslation(JSON.stringify({
      title: "عنوان", excerpt: "وصف", segments: validSegments, status: "published",
    }), segments)).toThrow(/unexpected injected field/i);

    // Injected publicationId
    expect(() => parseStructuredTranslation(JSON.stringify({
      title: "عنوان", excerpt: "وصف", segments: validSegments, publicationId: "pub_hacked",
    }), segments)).toThrow(/unexpected injected field/i);

    // Injected author
    expect(() => parseStructuredTranslation(JSON.stringify({
      title: "عنوان", excerpt: "وصف", segments: validSegments, authorId: "usr_attacker",
    }), segments)).toThrow(/unexpected injected field/i);
  });

  it("rejects dangerous script payloads and HTML execution vectors in title, excerpt, and segments", () => {
    const segments = collectTranslatableText(original);
    const validSegments = Object.fromEntries(segments.map(s => [s.path, "مترجم"]));

    // Script tag in title
    expect(() => parseStructuredTranslation(JSON.stringify({
      title: "<script>alert('xss')</script>", excerpt: "وصف", segments: validSegments,
    }), segments)).toThrow(/unsafe script content/i);

    // javascript: URI in excerpt
    expect(() => parseStructuredTranslation(JSON.stringify({
      title: "عنوان", excerpt: "javascript:evil()", segments: validSegments,
    }), segments)).toThrow(/unsafe script content/i);

    // iframe in segment
    const maliciousSegments = { ...validSegments, [segments[0]!.path]: "<iframe src='evil.com'></iframe>" };
    expect(() => parseStructuredTranslation(JSON.stringify({
      title: "عنوان", excerpt: "وصف", segments: maliciousSegments,
    }), segments)).toThrow(/unsafe script content/i);

    // event handler injection
    const handlerSegments = { ...validSegments, [segments[0]!.path]: "Text with <img src=x onerror=alert(1)>" };
    expect(() => parseStructuredTranslation(JSON.stringify({
      title: "عنوان", excerpt: "وصف", segments: handlerSegments,
    }), segments)).toThrow(/unsafe script content/i);
  });

  it("rejects oversized translated segments exceeding security limits", () => {
    const segments = collectTranslatableText(original);
    const oversizedSegments = {
      ...Object.fromEntries(segments.map(s => [s.path, "مترجم"])),
      [segments[0]!.path]: "a".repeat(50001),
    };
    expect(() => parseStructuredTranslation(JSON.stringify({
      title: "عنوان", excerpt: "وصف", segments: oversizedSegments,
    }), segments)).toThrow(/exceeds maximum length/i);
  });

  it("enforces nesting and text length bounds", () => {
    expect(() => collectTranslatableText({ text: "x".repeat(80001) })).toThrow();
    let nested: Record<string, unknown> = { text: "leaf" };
    for (let i = 0; i < 43; i++) nested = { children: [nested] };
    expect(() => collectTranslatableText(nested)).toThrow();
  });
});
