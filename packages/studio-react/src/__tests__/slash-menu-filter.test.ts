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
});
