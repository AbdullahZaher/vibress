/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToggleButton } from "../toggle-button";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("ToggleButton", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  it("uses semantic pressed state for a selected filter", () => {
    const onClick = vi.fn();
    act(() => root.render(<ToggleButton pressed onClick={onClick}>Published</ToggleButton>));
    const button = container.querySelector("button")!;
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.type).toBe("button");
    expect(button.className).toContain("min-h-11");
    act(() => button.click());
    expect(onClick).toHaveBeenCalledOnce();
  });
  it("renders unselected controls as low-emphasis ghost actions", () => {
    act(() => root.render(<ToggleButton pressed={false}>Draft</ToggleButton>));
    expect(container.querySelector("button")?.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector("button")?.className).toContain("hover:bg-accent");
  });
});
