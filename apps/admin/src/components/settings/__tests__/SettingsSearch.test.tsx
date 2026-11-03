/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSettingsSearch } from "../hooks/useSettingsSearch";
import { SETTINGS_REGISTRY } from "../settings.registry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function SearchHarness() {
  const { query, setQuery, matchingCardsCount, filteredPillars } = useSettingsSearch();
  return (
    <>
      <input aria-label="Settings query" value={query} onChange={e => setQuery(e.target.value)} />
      <span data-testid="count">{matchingCardsCount}</span>
      <div data-testid="matches">{filteredPillars.flatMap(p => p.cards).map(c => c.id).join(",")}</div>
    </>
  );
}

describe("settings search", () => {
  let node: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    node = document.createElement("div");
    document.body.appendChild(node);
    root = createRoot(node);
    act(() => root.render(<SearchHarness />));
  });
  afterEach(() => {
    act(() => root.unmount());
    node.remove();
  });
  it("matches Arabic settings keywords without requiring an English UI", () => {
    const input = node.querySelector("input")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "الخصوصية");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // React's controlled input receives the native input event.
    expect(node.querySelector('[data-testid="matches"]')?.textContent).toContain("site-privacy");
  });
  it("indexes site identity without advertising a competing color editor", () => {
    const site = SETTINGS_REGISTRY.find((pillar) => pillar.id === "site");
    const identity = site?.cards.find((card) => card.id === "design-branding");
    expect(identity?.title).toBe("Site Identity");
    expect(identity?.anchor).toBe("site-branding");
    expect(identity?.keywords).toContain("favicon");
    expect(identity?.keywords).not.toContain("accent");
    expect(identity?.keywords).not.toContain("color");
  });

  it("keeps registry counts consistent for an empty query", () => {
    expect(Number(node.querySelector('[data-testid="count"]')?.textContent)).toBeGreaterThan(20);
  });
});
