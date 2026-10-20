import { describe, expect, it } from "vitest";
import { validateSvgSafety } from "../domain/file-validator";

describe("SVG active document defense", () => {
  it.each([
    "<svg><foreignObject><body>HTML</body></foreignObject></svg>",
    '<!DOCTYPE svg [ <!ENTITY attack SYSTEM "file:///etc/passwd"> ]><svg/>',
    '<?xml-stylesheet href="https://example.com/x" type="text/xsl"?><svg/>',
    '<svg onload="alert(1)"/>',
    "<svg><script>alert(1)</script></svg>",
  ])("rejects unsafe SVG markup", (markup) => {
    expect(() => validateSvgSafety(Buffer.from(markup))).toThrow();
  });

  it("preserves passive SVG icons already used by themes", () => {
    expect(() =>
      validateSvgSafety(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>')),
    ).not.toThrow();
  });
});
