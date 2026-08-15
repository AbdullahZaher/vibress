import { describe, it, expect } from "vitest";
import { InlineAIPlugin } from "../plugins/InlineAIPlugin";

describe("Studio Inline AI Plugin — Honest State", () => {
  it("exports InlineAIPlugin as a valid React component", () => {
    expect(typeof InlineAIPlugin).toBe("function");
  });

  it("does not expose hardcoded fake completion text or third-party fake branding", () => {
    const fnSource = InlineAIPlugin.toString();
    expect(fnSource).not.toContain("Notion AI");
    expect(fnSource).not.toContain("Here is the continuation of your thoughts");
  });
});
