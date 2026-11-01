/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsModalPortal } from "../SettingsModalPortal";
import { Dialog } from "../../ui/dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SettingsModalPortal accessible dialog", () => {
  let host: HTMLDivElement;
  let opener: HTMLButtonElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    opener = document.createElement("button");
    opener.textContent = "Open";
    document.body.append(host, opener);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    opener.remove();
    document.body.style.overflow = "";
  });

  it("labels the dialog, traps keyboard focus and returns focus to the opener", () => {
    const onClose = vi.fn();
    opener.focus();
    act(() => root.render(
      <SettingsModalPortal isOpen onClose={onClose} title="Navigation menus">
        <div className="fixed inset-0">
          <button type="button">First</button>
          <button type="button">Last</button>
        </div>
      </SettingsModalPortal>,
    ));

    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("aria-label")).toBe("Navigation menus");
    expect(document.activeElement).toBe(dialog);
    const first = dialog.querySelectorAll("button")[0]!;
    const last = dialog.querySelectorAll("button")[1]!;

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(document.activeElement).toBe(first);
    last.focus();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(document.activeElement).toBe(first);
    first.focus();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })));
    expect(document.activeElement).toBe(last);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => root.render(
      <SettingsModalPortal isOpen={false} onClose={onClose} title="Navigation menus">
        <div />
      </SettingsModalPortal>,
    ));
    expect(document.activeElement).toBe(opener);
  });
  it("lets the topmost confirmation own Tab and Escape instead of the underlying drawer", () => {
    const closeDrawer = vi.fn();
    const closeConfirm = vi.fn();
    act(() => root.render(
      <>
        <SettingsModalPortal isOpen title="Navigation menus" onClose={closeDrawer}>
          <button type="button">Underlying control</button>
        </SettingsModalPortal>
        <Dialog isOpen onClose={closeConfirm} title="Confirm settings change" className="settings-confirmation-dialog">
          <button type="button">Cancel</button>
          <button type="button">Continue</button>
        </Dialog>
      </>,
    ));
    const dialog = document.querySelector<HTMLElement>(".settings-confirmation-dialog");
    const nestedButtons = Array.from(dialog?.querySelectorAll("button") ?? []);
    expect(nestedButtons.length).toBeGreaterThanOrEqual(2);
    const last = nestedButtons[nestedButtons.length - 1]!;
    const first = nestedButtons[0]!;
    act(() => { last.focus(); });
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(first);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(closeDrawer).not.toHaveBeenCalled();
    expect(closeConfirm).toHaveBeenCalledOnce();
  });

});
