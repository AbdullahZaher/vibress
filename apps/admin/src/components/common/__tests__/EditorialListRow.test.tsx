/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorialListRow } from "../EditorialListRow";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("EditorialListRow", () => {
  let root: Root;
  let container: HTMLDivElement;
  const base = {
    title: "Hello there",
    authorName: "Test Author",
    date: "2026-09-19T12:00:00.000Z",
    status: "draft",
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  };
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders a list row with author, localized date and status; edit works", () => {
    act(() => root.render(<EditorialListRow {...base} />));
    expect(container.querySelector('[role="listitem"]')).not.toBeNull();
    expect(container.textContent).toContain("Test Author");
    expect(container.textContent).toContain("2026");
    expect(container.textContent).toContain("Draft");
    act(() => container.querySelector('button[aria-label="Edit: Hello there"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    ));
    expect(base.onEdit).toHaveBeenCalledOnce();
  });

  it("shows an uncluttered two-line row without a fake thumbnail and keeps accessible actions", () => {
    act(() => root.render(<EditorialListRow {...base} />));
    const row = container.querySelector<HTMLElement>('[role="listitem"]');
    const editAction = container.querySelector<HTMLButtonElement>('button[aria-label="Edit: Hello there"]');
    const moreAction = container.querySelector<HTMLButtonElement>('button[aria-label^="More actions"]');
    expect(row?.className).toContain("min-h-[80px]");
    expect(row?.querySelector("img")).toBeNull();
    expect(row?.querySelector("div[aria-hidden] svg")).not.toBeNull();
    expect(row?.textContent).toContain("Draft");
    expect(moreAction?.className).toContain("size-11");
    expect(editAction).not.toBeNull();
    expect(row?.querySelectorAll('button[aria-label="Edit: Hello there"]').length).toBe(1);
  });

  it("shows a thumbnail only when the post has a working feature image", () => {
    act(() => root.render(<EditorialListRow {...base} imageUrl="https://example.test/post.jpg" />));
    const thumbnail = container.querySelector<HTMLImageElement>('img[src="https://example.test/post.jpg"]');
    expect(thumbnail).not.toBeNull();
    expect(thumbnail?.getAttribute("alt")).toBe("");
  });


  it("keeps page titles aligned without rendering decorative thumbnails", () => {
    act(() => root.render(<EditorialListRow {...base} resource="page" />));
    const row = container.querySelector('[role="listitem"]');
    expect(row?.querySelector("img")).toBeNull();
    expect(row?.querySelector('div[aria-hidden="true"] svg')).toBeNull();
    expect(row?.textContent).toContain("Hello there");
  });

  it("highlights selected rows while keeping a single accessible edit action", () => {
    act(() => root.render(<EditorialListRow {...base} selected />));
    const row = container.querySelector('[role="listitem"]');
    expect(row?.getAttribute("data-selected")).toBe("true");
    expect(row?.querySelectorAll('button[aria-label="Edit: Hello there"]').length).toBe(1);
  });

  it("navigates when the row background is clicked, and exposes a keyboard-accessible row action", () => {
    act(() => root.render(<EditorialListRow {...base} />));
    const rowAction = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit: Hello there"]',
    );
    expect(rowAction?.className).toContain("inset-0");
    act(() => rowAction?.click());
    expect(base.onEdit).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="listitem"] h3')?.textContent).toBe("Hello there");
  });

  it("keeps published rows focused on editing instead of showing a misleading per-item dashboard", () => {
    act(() => root.render(<EditorialListRow {...base} status="published" />));
    expect(container.querySelector('button[aria-label^="Analytics Dashboard"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Edit: Hello there"]')).not.toBeNull();
  });

  it("does not misrepresent an unfamiliar editorial status as Draft", () => {
    act(() => root.render(<EditorialListRow {...base} status="under_legal_review" />));
    expect(container.textContent).toContain("under legal review");
    expect(container.textContent).not.toContain("Draft");
  });

  it("preserves publish and delete actions behind an accessible menu", () => {
    const onPublishToggle = vi.fn();
    act(() => root.render(<EditorialListRow {...base} status="published" onPublishToggle={onPublishToggle} />));
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="More actions: Hello there"]');
    act(() => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    const menu = document.body.querySelector('[role="menu"]');
    expect(menu?.textContent).toContain("Unpublish");
    const unpublish = Array.from(menu?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(b => b.textContent?.includes("Unpublish"));
    act(() => unpublish?.click());
    expect(onPublishToggle).toHaveBeenCalledOnce();
    expect(base.onEdit).not.toHaveBeenCalled();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    act(() => trigger?.click());
    const remove = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menu"] button'))
      .find(b => b.textContent?.includes("Delete"));
    act(() => remove?.click());
    expect(base.onDelete).toHaveBeenCalledOnce();
    expect(base.onEdit).not.toHaveBeenCalled();
  });

  it("hides publication controls without permission and shows a missing image fallback", () => {
    act(() => root.render(<EditorialListRow {...base} title="" imageUrl="https://example.test/photo.jpg" />));
    expect(container.textContent).toContain("(Untitled)");
    const img = container.querySelector("img");
    expect(img?.getAttribute("alt")).toBe("");
    act(() => img?.dispatchEvent(new Event("error")));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label^="More actions"]');
    act(() => trigger?.click());
    expect(document.body.querySelector('[role="menu"]')?.textContent).not.toContain("Publish");
  });

  it("supports ArrowDown and ArrowUp navigation across menu items", () => {
    act(() => root.render(<EditorialListRow {...base} onPublishToggle={vi.fn()} />));
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label^="More actions"]');
    act(() => trigger?.click());
    const menu = document.body.querySelector<HTMLElement>('[role="menu"]');
    const items = menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    expect(trigger?.getAttribute("aria-haspopup")).toBe("menu");
    expect(items?.length).toBe(2);
    expect(document.activeElement).toBe(items?.[0]);
    act(() => menu?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement).toBe(items?.[1]);
    act(() => menu?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    expect(document.activeElement).toBe(items?.[0]);
  });

  it("dismisses the action menu with Escape and returns focus to its trigger", () => {
    act(() => root.render(<EditorialListRow {...base} />));
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label^="More actions"]');
    act(() => trigger?.click());
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });
});
