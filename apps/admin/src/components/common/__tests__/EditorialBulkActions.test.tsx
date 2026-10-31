/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorialBulkActions } from "../EditorialBulkActions";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("EditorialBulkActions — consistent group geometry", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onAction = vi.fn();
  const onClear = vi.fn();
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
  it("uses equal size and corner-radius tokens for all four actions", () => {
    act(() => root.render(
      <EditorialBulkActions selectedCount={6} showPublish showUnpublish showDelete onAction={onAction} onClear={onClear} />,
    ));
    const group = container.querySelector('[role="group"]')!;
    expect(group).not.toBeNull();
    expect(group.getAttribute("aria-label")).toBe("Bulk actions");
    const buttons = [...group.querySelectorAll("button")];
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      expect(button.className).toContain("min-h-11");
      expect(button.className).toContain("rounded-lg");
      expect(button.className).toContain("w-full");
      expect(button.className).toContain("text-sm");
    }
    expect(buttons[2]?.className).toContain("border-destructive/35");
    expect(buttons[2]?.className).not.toContain("bg-destructive text-destructive-foreground");
    expect(group.textContent).toContain("6 selected on this page");
  });
  it("retains publish, unpublish, delete and clear callbacks", () => {
    act(() => root.render(
      <EditorialBulkActions selectedCount={2} showPublish showUnpublish showDelete onAction={onAction} onClear={onClear} />,
    ));
    const buttons = container.querySelectorAll("button");
    act(() => buttons[0]?.click());
    act(() => buttons[1]?.click());
    act(() => buttons[2]?.click());
    act(() => buttons[3]?.click());
    expect(onAction.mock.calls.map((args) => args[0])).toEqual(["publish", "unpublish", "delete"]);
    expect(onClear).toHaveBeenCalledOnce();
  });
  it("respects permission/state visibility and hides for no selection", () => {
    act(() => root.render(<EditorialBulkActions selectedCount={1} showPublish={false} showUnpublish={false} showDelete onAction={onAction} onClear={onClear} />));
    expect(container.querySelectorAll("button")).toHaveLength(2);
    act(() => root.render(<EditorialBulkActions selectedCount={0} showPublish showUnpublish showDelete onAction={onAction} onClear={onClear} />));
    expect(container.querySelector('[role="group"]')).toBeNull();
  });
});
