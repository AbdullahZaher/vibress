/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsCardRow } from "../SettingsCardRow";
import { PublicationInfoCard } from "../general/PublicationInfoCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SettingsCardRow disclosure and action rules", () => {
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

  it("uses a whole-row disclosure without Edit/Close button copy", () => {
    const onAction = vi.fn();
    act(() => root.render(
      <>
        <SettingsCardRow
          title="Site timezone & language"
          description="Manage publication language"
          currentValue={<span>English (en) · Asia/Riyadh</span>}
          actionLabel="Edit"
          isExpanded={false}
          panelId="locale-panel"
          onAction={onAction}
        />
        <div id="locale-panel">Panel contents</div>
      </>,
    ));

    const heading = container.querySelector("h3");
    const button = heading?.querySelector("button");
    expect(heading).not.toBeNull();
    expect(button?.className).toContain("w-full");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(button?.getAttribute("aria-controls")).toBe("locale-panel");
    expect(button?.textContent).toContain("Site timezone & language");
    expect(button?.textContent).not.toContain("Close");
    expect(button?.textContent).toContain("Manage publication language");
    expect(container.textContent).not.toContain("English (en)");
    expect(container.textContent).not.toContain("Asia/Riyadh");

    act(() => button?.click());
    expect(onAction).toHaveBeenCalledOnce();
    act(() => button?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    // Native buttons receive keyboard activation in the browser.
    expect(button?.getAttribute("type")).toBe("button");
  });

  it("opens and closes the real inline publication editor from its heading", () => {
    act(() => root.render(
      <PublicationInfoCard
        title="Vibress"
        tagline=""
        description=""
        onChange={vi.fn()}
      />,
    ));
    const toggle = container.querySelector('button[aria-expanded]') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const targetId = toggle.getAttribute("aria-controls");
    expect(targetId).toBeTruthy();
    expect(container.querySelector(`[id="${targetId}"]`)?.hasAttribute("hidden")).toBe(true);

    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(`[id="${targetId}"]`)).not.toBeNull();
    expect(container.querySelector("#card-site-title")).not.toBeNull();

    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(`[id="${targetId}"]`)?.hasAttribute("hidden")).toBe(true);
  });

  it("retains a labeled action button for modal and external-page settings", () => {
    const onAction = vi.fn();
    act(() => root.render(
      <SettingsCardRow
        title="Navigation menus"
        description="Edit header links"
        currentValue={<span>2 links</span>}
        actionLabel="Manage navigation"
        onAction={onAction}
      />,
    ));
    const button = container.querySelector("button")!;
    expect(button.textContent).toContain("Manage navigation");
    expect(button.getAttribute("aria-expanded")).toBeNull();
    expect(container.textContent).not.toContain("2 links");
    act(() => button.click());
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("does not create an empty action column without an action", () => {
    act(() => root.render(
      <SettingsCardRow title="Site metadata" currentValue={<span>Extra status</span>} />,
    ));
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).not.toContain("Extra status");
  });
});
