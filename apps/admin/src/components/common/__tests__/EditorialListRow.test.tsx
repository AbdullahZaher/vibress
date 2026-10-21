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

  it("uses compact thumbnails and spacing without shrinking action touch targets", () => {
    act(() => root.render(<EditorialListRow {...base} />));
    const row = container.querySelector<HTMLElement>('[role="listitem"]');
    const thumbnail = row?.querySelector<HTMLElement>("div.rounded-md");
    const editAction = container.querySelector<HTMLButtonElement>('button[aria-label="Edit: Hello there"]');
    const moreAction = container.querySelector<HTMLButtonElement>('button[aria-label^="More actions"]');
    expect(row?.className).toContain("py-2");
    expect(row?.className).toContain("sm:py-2.5");
    expect(thumbnail?.className).toContain("h-12");
    expect(thumbnail?.className).toContain("sm:h-14");
    expect(moreAction?.className).toContain("h-9");
    expect(editAction).not.toBeNull();
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

  it("opens analytics for published content without triggering the row editor", () => {
    const onStatistics = vi.fn();
    act(() => root.render(<EditorialListRow {...base} status="published" onStatistics={onStatistics} />));
    const analytics = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Analytics Dashboard: Hello there"]',
    );
    expect(analytics).not.toBeNull();
    expect(container.querySelector('button[aria-label="Edit: Hello there"]')).not.toBeNull();
    act(() => analytics?.click());
    expect(onStatistics).toHaveBeenCalledOnce();
    expect(base.onEdit).not.toHaveBeenCalled();
  });

  it("does not show analytics without an authorized handler, even when published", () => {
    act(() => root.render(<EditorialListRow {...base} status="published" />));
    expect(container.querySelector('button[aria-label="Analytics Dashboard: Hello there"]')).toBeNull();
  });

  it("preserves publish and delete actions behind an accessible menu", () => {
    const onPublishToggle = vi.fn();
    act(() => root.render(<EditorialListRow {...base} status="published" onPublishToggle={onPublishToggle} />));
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="More actions: Hello there"]');
    act(() => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    const menu = container.querySelector('[role="group"]');
    expect(menu?.textContent).toContain("Unpublish");
    const unpublish = Array.from(menu?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(b => b.textContent?.includes("Unpublish"));
    act(() => unpublish?.click());
    expect(onPublishToggle).toHaveBeenCalledOnce();
    expect(base.onEdit).not.toHaveBeenCalled();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    act(() => trigger?.click());
    const remove = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="group"] button'))
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
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label^="More actions"]');
    act(() => trigger?.click());
    expect(container.querySelector('[role="group"]')?.textContent).not.toContain("Publish");
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
