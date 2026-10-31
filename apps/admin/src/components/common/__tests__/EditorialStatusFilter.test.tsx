/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorialStatusFilter } from "../EditorialStatusFilter";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("EditorialStatusFilter disclosure", () => {
  let root: Root;
  let container: HTMLDivElement;
  const options = [
    { value: "all", label: "All Posts" },
    { value: "draft", label: "Drafts" },
    { value: "published", label: "Published" },
  ];
  const onChange = vi.fn();
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onChange.mockReset();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows a compact filter trigger with options hidden until requested", () => {
    act(() => root.render(<EditorialStatusFilter label="Filter by status" options={options} value="draft" onChange={onChange} />));
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Filter by status"]');
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(container.querySelector("select")).toBeNull();
    act(() => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.querySelectorAll('[role="menuitemradio"]').length).toBe(3);
    expect(document.body.querySelector('[aria-checked="true"]')?.textContent).toContain("Drafts");
  });

  it("supports changing status, keyboard navigation and Escape", () => {
    act(() => root.render(<EditorialStatusFilter label="Filter by status" options={options} value="all" onChange={onChange} />));
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Filter by status"]');
    act(() => trigger?.click());
    const menu = document.body.querySelector<HTMLElement>('[role="menu"]');
    const items = menu?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    act(() => menu?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement).toBe(items?.[1]);
    act(() => items?.[2]?.click());
    expect(onChange).toHaveBeenCalledWith("published");
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    act(() => trigger?.click());
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.activeElement).toBe(trigger);
  });
});
