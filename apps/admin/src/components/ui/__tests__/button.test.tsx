/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button, buttonVariants } from "../button";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("Button System v2", () => {
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

  it("uses a non-submitting native button by default", () => {
    const onClick = vi.fn();
    act(() => root.render(<Button onClick={onClick}>Create</Button>));
    const node = container.querySelector("button")!;
    expect(node.type).toBe("button");
    expect(node.className).toContain("min-h-11");
    act(() => node.click());
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("requires an explicit submit type inside forms", () => {
    act(() => root.render(<Button type="submit">Confirm</Button>));
    expect(container.querySelector("button")?.type).toBe("submit");
  });

  it("has distinct regular, compact and icon size tokens", () => {
    expect(buttonVariants({ size: "xs" })).toContain("min-h-8");
    expect(buttonVariants({ size: "sm" })).toContain("min-h-10");
    expect(buttonVariants({ size: "default" })).toContain("min-h-11");
    expect(buttonVariants({ size: "lg" })).toContain("min-h-12");
    expect(buttonVariants({ size: "icon" })).toContain("size-11");
    expect(buttonVariants({ size: "icon-sm" })).toContain("size-10");
    for (const size of ["xs", "sm", "default", "lg", "icon", "icon-sm"] as const) {
      const classes = buttonVariants({ size });
      expect(classes).toContain("rounded-lg");
      expect(classes).not.toContain("rounded-md");
    }
  });

  it("keeps label geometry stable and blocks repeated activation while loading", () => {
    const onClick = vi.fn();
    act(() => root.render(<Button onClick={onClick} loading loadingLabel="Saving…">Save changes</Button>));
    const node = container.querySelector("button")!;
    expect(node.disabled).toBe(true);
    expect(node.getAttribute("aria-busy")).toBe("true");
    expect(node.getAttribute("aria-label")).toBeNull();
    expect(node.getAttribute("aria-describedby")).toBeTruthy();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Saving…");
    expect(node.textContent).toContain("Save changes");
    expect(node.querySelector(".opacity-0")).not.toBeNull();
    expect(node.querySelector("svg")).not.toBeNull();
    act(() => node.click());
    expect(onClick).not.toHaveBeenCalled();
  });

  it("preserves its accessible label when no loading message is provided", () => {
    act(() => root.render(<Button loading><span>Save article</span></Button>));
    const node = container.querySelector("button")!;
    expect(node.getAttribute("aria-busy")).toBe("true");
    expect(node.querySelector(".opacity-0")?.textContent).toBe("Save article");
    expect(node.querySelector(".opacity-0")?.getAttribute("aria-hidden")).toBeNull();
    expect(node.getAttribute("aria-describedby")).toBeNull();
  });

  it("keeps the action name stable when a busy description is supplied", () => {
    act(() => root.render(<Button aria-label="Publish article" loading loadingLabel="Publishing…"><svg aria-hidden="true" /></Button>));
    const node = container.querySelector("button")!;
    expect(node.getAttribute("aria-label")).toBe("Publish article");
    expect(node.getAttribute("aria-describedby")).toBeTruthy();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Publishing…");
  });

  it("keeps link-style buttons free of size padding while allowing labels to wrap", () => {
    const style = buttonVariants({ variant: "link", size: null });
    expect(style).not.toContain("min-h-11");
    expect(style).toContain("whitespace-normal");
    act(() => root.render(<Button variant="link">Open details</Button>));
    const element = container.querySelector("button")!;
    expect(element.className).not.toContain("min-h-11");
    expect(element.className).toContain("min-h-0");
  });

  it("preserves destructive, subdued, ghost and focus styles", () => {
    for (const variant of ["default", "destructive", "destructive-outline", "secondary", "subtle", "ghost", "outline", "link"] as const) {
      expect(buttonVariants({ variant })).toContain("focus-visible:outline-2");
    }
    expect(buttonVariants({ variant: "ghost" })).not.toContain("active:scale");
  });
});
