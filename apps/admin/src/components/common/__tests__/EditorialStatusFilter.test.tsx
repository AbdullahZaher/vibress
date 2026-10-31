/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorialStatusFilter } from "../EditorialStatusFilter";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("EditorialStatusFilter", () => {
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

  it("offers every publishing state in one accessible select without overflowing the workspace", () => {
    act(() => root.render(<EditorialStatusFilter label="Filter by status" options={options} value="draft" onChange={onChange} />));
    const selector = container.querySelector<HTMLSelectElement>('select[aria-label="Filter by status"]');
    expect(selector?.value).toBe("draft");
    expect(selector?.options.length).toBe(3);
    expect(selector?.className).toContain("appearance-none");
    expect(selector?.className).toContain("min-h-11");
    expect(container.querySelectorAll("button").length).toBe(0);
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it("dispatches native changes without any custom menu or keyboard trap", () => {
    act(() => root.render(<EditorialStatusFilter label="Filter by status" options={options} value="all" onChange={onChange} />));
    const selector = container.querySelector<HTMLSelectElement>("select")!;
    act(() => {
      selector.value = "published";
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("published");
  });
});
