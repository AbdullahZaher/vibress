/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsCardRow } from "../SettingsCardRow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SettingsCardRow quiet action layout", () => {
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

  it("does not display legacy metadata beside the action button", () => {
    const onAction = vi.fn();
    act(() => root.render(
      <SettingsCardRow
        title="Site timezone & language"
        description="Edit publication language"
        currentValue={<span>English (en) · Asia/Riyadh</span>}
        actionLabel="Edit"
        onAction={onAction}
        isExpanded={false}
      />,
    ));
    expect(container.textContent).toContain("Site timezone & language");
    expect(container.textContent).toContain("Edit publication language");
    expect(container.textContent).not.toContain("English (en)");
    expect(container.textContent).not.toContain("Asia/Riyadh");

    const button = container.querySelector("button")!;
    expect(button.textContent).toContain("Edit");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    act(() => button.click());
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("does not create an empty action column when there is no action", () => {
    act(() => root.render(
      <SettingsCardRow title="Site metadata" currentValue={<span>Extra status</span>} />,
    ));
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).not.toContain("Extra status");
  });
});
