/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { IconButton } from "../icon-button";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("IconButton", () => {
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
  it("keeps the label accessible but outside the compact button", () => {
    const onClick = vi.fn();
    act(() => root.render(
      <IconButton label="Edit" accessibleLabel="Edit: Article" onClick={onClick}>
        <svg aria-hidden="true" />
      </IconButton>,
    ));
    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("Edit: Article");
    expect(button?.textContent).toBe("");
    act(() => button?.click());
    expect(onClick).toHaveBeenCalledOnce();
  });
  it("shows and dismisses the tooltip with keyboard focus", () => {
    act(() => root.render(<IconButton label="Refresh"><svg aria-hidden="true" /></IconButton>));
    const button = container.querySelector("button");
    act(() => button?.focus());
    expect(document.body.textContent).toContain("Refresh");
    act(() => button?.blur());
    expect(document.body.textContent).not.toContain("Refresh");
  });
  it("hides the tooltip and blocks pointer activation when a busy icon action starts", () => {
    act(() => root.render(<IconButton label="Refresh" loading><svg aria-hidden="true" /></IconButton>));
    const button = container.querySelector("button");
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute("aria-busy")).toBe("true");
    act(() => button?.focus());
    expect(document.body.textContent).not.toContain("Refresh");
  });

  it("positions long tooltips within viewport edges after measuring their width", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (this.tagName === "SPAN") return { width: 200, height: 24, top: 10, left: 0, right: 200, bottom: 34, x: 0, y: 10, toJSON() {} } as DOMRect;
      return { width: 40, height: 40, top: 40, left: 2, right: 42, bottom: 80, x: 2, y: 40, toJSON() {} } as DOMRect;
    };
    try {
      act(() => root.render(<IconButton label="A long descriptive label"><svg aria-hidden="true" /></IconButton>));
      act(() => container.querySelector("button")?.focus());
      const tooltip = document.body.querySelector<HTMLSpanElement>('span[dir="auto"]');
      expect(tooltip).not.toBeNull();
      expect(Number.parseFloat(tooltip!.style.left)).toBeGreaterThanOrEqual(108);
    } finally {
      Element.prototype.getBoundingClientRect = rect;
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  it("does not display tooltips on disabled buttons", () => {
    act(() => root.render(<IconButton label="Delete" disabled><svg aria-hidden="true" /></IconButton>));
    act(() => container.querySelector("button")?.focus());
    expect(document.body.textContent).not.toContain("Delete");
  });
});
