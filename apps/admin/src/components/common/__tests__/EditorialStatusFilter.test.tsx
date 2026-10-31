/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorialStatusFilter } from "../EditorialStatusFilter";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("EditorialStatusFilter", () => {
  let root: Root;
  let container: HTMLDivElement;
  const options = [{ value: "all", label: "All" }, { value: "draft", label: "Drafts" }, { value: "published", label: "Published" }];
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

  it("shows every status in a mobile-native selector and marks the desktop active status", () => {
    act(() => root.render(<EditorialStatusFilter label="Filter by status" options={options} value="draft" onChange={onChange} />));
    const selector = container.querySelector<HTMLSelectElement>('select[aria-label="Filter by status"]');
    expect(selector?.className).toContain("md:hidden");
    expect(selector?.value).toBe("draft");
    expect(selector?.options.length).toBe(3);
    const active = container.querySelector('button[aria-pressed="true"]');
    expect(active?.textContent).toBe("Drafts");
    expect(container.querySelectorAll('div[role="group"] button').length).toBe(3);
  });

  it("dispatches both desktop and native mobile changes", () => {
    act(() => root.render(<EditorialStatusFilter label="Filter by status" options={options} value="all" onChange={onChange} />));
    const published = [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Published");
    act(() => published?.click());
    expect(onChange).toHaveBeenCalledWith("published");
    const selector = container.querySelector<HTMLSelectElement>("select")!;
    act(() => {
      selector.value = "draft";
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("draft");
  });
});
