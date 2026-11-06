import { describe, expect, it } from "vitest";
import { filterSlashMenuOptions } from "../plugins/slash-menu-filter";

const options = [
  { title: "Image", cardType: "image" },
  { title: "Heading 1", actionType: "h1" },
  { title: "Quote", actionType: "quote" },
  { title: "نص عربي", actionType: "arabic-paragraph" },
];

describe("slash menu literal query matching", () => {
  it("returns the original options for an empty query", () => {
    expect(filterSlashMenuOptions(options, null)).toBe(options);
    expect(filterSlashMenuOptions(options, "")).toBe(options);
  });

  it.each(["[", "(", "*", "\\", ".*", "(a+)+$"])(
    "treats special regex input %s as literal text, never as a pattern",
    (query) => {
      expect(() => filterSlashMenuOptions(options, query)).not.toThrow();
      expect(filterSlashMenuOptions(options, query)).toEqual([]);
    },
  );

  it("matches title, card type and action type case insensitively", () => {
    expect(filterSlashMenuOptions(options, "IMAGE")).toEqual([options[0]]);
    expect(filterSlashMenuOptions(options, "h1")).toEqual([options[1]]);
    expect(filterSlashMenuOptions(options, "QUOT")).toEqual([options[2]]);
  });

  it("matches Arabic text without treating it as a regex", () => {
    expect(filterSlashMenuOptions(options, "عربي")).toEqual([options[3]]);
  });

  it("does not return unrelated commands", () => {
    expect(filterSlashMenuOptions(options, "gallery")).toEqual([]);
  });

  describe("relevance ranking", () => {
    const rankingOptions = [
      { title: "Custom Image Preview", cardType: "custom-img", keywords: ["preview"] },
      { title: "Image", cardType: "image", keywords: ["صورة", "photo"] },
      { title: "Gallery", cardType: "gallery", keywords: ["images", "صور"] },
    ];

    it("ranks exact title match above substring match", () => {
      const results = filterSlashMenuOptions(rankingOptions, "image");
      expect(results[0]?.title).toBe("Image");
    });

    it("ranks prefix keyword match above general substring", () => {
      const keywordOptions = [
        { title: "Option Substring", cardType: "sub", keywords: ["ألبوم صور"] },
        { title: "Option Prefix", cardType: "pre", keywords: ["صور جميلة"] },
      ];
      const results = filterSlashMenuOptions(keywordOptions, "صور");
      expect(results[0]?.title).toBe("Option Prefix");
    });

    it("ranks actionType exact match highly", () => {
      const headingOptions = [
        { title: "Heading 2", actionType: "h2", keywords: ["عنوان"] },
        { title: "Heading 1", actionType: "h1", keywords: ["عنوان", "رئيسي"] },
        { title: "Heading 3", actionType: "h3", keywords: ["عنوان"] },
      ];
      const results = filterSlashMenuOptions(headingOptions, "h1");
      expect(results[0]?.title).toBe("Heading 1");
    });

    it("preserves stable array ordering on equal relevance scores", () => {
      const similarOptions = [
        { title: "Block A", cardType: "block-a" },
        { title: "Block B", cardType: "block-b" },
        { title: "Block C", cardType: "block-c" },
      ];
      const results = filterSlashMenuOptions(similarOptions, "Block");
      expect(results.map((r) => r.title)).toEqual(["Block A", "Block B", "Block C"]);
    });
  });
});
