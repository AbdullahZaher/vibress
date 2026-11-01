/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsModalPortal } from "../SettingsModalPortal";
import { filterSettingsRegistry, normalizeSettingsQuery } from "../hooks/useSettingsSearch";
import { moveNavigationItem } from "../site/NavigationManagerCard";
import type { NavItem } from "../hooks/useSiteSettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Settings discovery and navigation", () => {
  it("finds settings by English keywords across categories", () => {
    const result = filterSettingsRegistry("SMTP");
    expect(result.some((pillar) => pillar.cards.some((card) => card.id === "newsletters-config"))).toBe(true);
  });

  it("matches Arabic search regardless of harakat and alef variants", () => {
    expect(normalizeSettingsQuery("الإِعدادات")).toBe(normalizeSettingsQuery("الاعدادات"));
    const result = filterSettingsRegistry("الشِّعار");
    expect(result.some((pillar) => pillar.cards.some((card) => card.id === "design-branding"))).toBe(true);
  });

  it("returns all categories for an empty query and none for a missing term", () => {
    expect(filterSettingsRegistry("")).toHaveLength(5);
    expect(filterSettingsRegistry("unfindable_setting_999")).toHaveLength(0);
  });

  const items: NavItem[] = [
    { id: "a", label: "First", url: "/first" },
    { id: "b", label: "Second", url: "/second" },
    { id: "c", label: "Third", url: "/third" },
  ];

  it("reorders navigation deterministically without mutating inputs", () => {
    const moved = moveNavigationItem(items, 1, -1);
    expect(moved.map((item) => item.id)).toEqual(["b", "a", "c"]);
    expect(items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(moveNavigationItem(moved, 0, -1)).toBe(moved);
    expect(moveNavigationItem(items, 2, 1)).toBe(items);
  });
});

describe("SettingsModalPortal keyboard behavior", () => {
  let root: Root;
  let mount: HTMLDivElement;

  beforeEach(() => {
    mount = document.createElement("div");
    document.body.appendChild(mount);
    root = createRoot(mount);
  });

  afterEach(() => {
    act(() => root.unmount());
    mount.remove();
    document.body.removeAttribute("inert");
  });

  const modal = (open: boolean, onClose: () => void) => (
    <div>
      <button id="open-settings">Open settings</button>
      <SettingsModalPortal isOpen={open} label="Settings test dialog" onClose={onClose}>
        <div>
          <button id="first-action">First</button>
          <button id="last-action">Last</button>
        </div>
      </SettingsModalPortal>
    </div>
  );

  it("focuses within the modal, wraps keyboard focus and restores the opener", () => {
    const onClose = vi.fn();
    act(() => root.render(modal(false, onClose)));
    const trigger = mount.querySelector<HTMLButtonElement>("#open-settings");
    expect(trigger).not.toBeNull();
    trigger?.focus();

    act(() => root.render(modal(true, onClose)));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
    const first = dialog?.querySelector<HTMLButtonElement>("#first-action");
    const last = dialog?.querySelector<HTMLButtonElement>("#last-action");
    expect(dialog?.getAttribute("aria-label")).toBe("Settings test dialog");
    expect(document.activeElement).toBe(first);
    expect(mount.hasAttribute("inert")).toBe(true);

    act(() => {
      last?.focus();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(first);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(last);

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => root.render(modal(false, onClose)));
    expect(document.activeElement).toBe(trigger);
    expect(mount.hasAttribute("inert")).toBe(false);
  });
});
