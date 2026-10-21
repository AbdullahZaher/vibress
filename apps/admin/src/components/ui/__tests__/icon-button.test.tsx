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
  it("does not display tooltips on disabled buttons", () => {
    act(() => root.render(<IconButton label="Delete" disabled><svg aria-hidden="true" /></IconButton>));
    act(() => container.querySelector("button")?.focus());
    expect(document.body.textContent).not.toContain("Delete");
  });
});
