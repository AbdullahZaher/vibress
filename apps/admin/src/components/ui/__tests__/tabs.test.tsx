/** @vitest-environment jsdom */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../tabs";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function TestTabs() {
  const [active, setActive] = useState("overview");
  return (
    <Tabs value={active} onValueChange={setActive}>
      <TabsList aria-label="Analytics sections">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="growth">Growth</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">Overview content</TabsContent>
      <TabsContent value="growth">Growth content</TabsContent>
    </Tabs>
  );
}
describe("Accessible Tabs", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  it("links tab triggers to exactly one selected panel", () => {
    act(() => root.render(<TestTabs />));
    const selected = container.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    const panel = container.querySelector<HTMLElement>('[role="tabpanel"]');
    expect(selected?.getAttribute("aria-controls")).toBe(panel?.id);
    expect(panel?.getAttribute("aria-labelledby")).toBe(selected?.id);
    expect(container.querySelectorAll('[role="tabpanel"]').length).toBe(1);
    expect(container.querySelectorAll('[role="tab"][tabindex="0"]').length).toBe(1);
  });
  it("supports arrow keys and corrects direction for RTL", () => {
    act(() => root.render(<TestTabs />));
    const list = container.querySelector<HTMLElement>('[role="tablist"]')!;
    const items = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    act(() => items[0]?.focus());
    act(() => list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.activeElement).toBe(items[1]);
    expect(items[1]?.getAttribute("aria-selected")).toBe("true");
    list.style.direction = "rtl";
    act(() => list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.activeElement).toBe(items[0]);
  });
});
