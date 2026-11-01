/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsSaveBar } from "../SettingsSaveBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SettingsSaveBar destructive actions", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.style.overflow = "";
  });

  it("requires confirmation before discarding pending changes", async () => {
    const onDiscard = vi.fn();
    const onSave = vi.fn();
    await act(async () => root.render(
      <SettingsSaveBar
        isDirty
        dirtyCount={2}
        saving={false}
        onSave={onSave}
        onDiscard={onDiscard}
        successMsg={null}
        errorMsg={null}
      />,
    ));

    const discard = Array.from(host.querySelectorAll("button")).find(
      button => button.textContent?.trim() === "Discard",
    );
    expect(discard).toBeTruthy();

    await act(async () => { discard?.click(); });
    expect(onDiscard).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    const cancel = Array.from(dialog.querySelectorAll("button")).find(
      button => button.textContent?.trim() === "Cancel",
    );
    await act(async () => { cancel?.click(); });
    expect(onDiscard).not.toHaveBeenCalled();

    await act(async () => { discard?.click(); });
    const activeDialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const confirm = Array.from(activeDialog.querySelectorAll("button")).find(
      button => button.textContent?.trim() === "Discard changes",
    );
    expect(confirm).toBeTruthy();
    await act(async () => { confirm?.click(); });
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });
  it("blocks in-app navigation and asks before leaving settings", async () => {
    const approvedPaths: string[] = [];
    const onConfirmed = (event: Event) => {
      approvedPaths.push((event as CustomEvent<{path: string}>).detail.path);
    };
    window.addEventListener("vibress:confirmed-settings-navigation", onConfirmed);
    const onDiscard = vi.fn();
    try {
      await act(async () => root.render(
        <SettingsSaveBar isDirty dirtyCount={1} saving={false}
          onSave={vi.fn()} onDiscard={onDiscard}
          successMsg={null} errorMsg={null} />,
      ));
      const request = new CustomEvent("vibress:before-settings-navigation", {
        cancelable: true, detail: { path: "/admin/posts" },
      });
      await act(async () => { window.dispatchEvent(request); });
      expect(request.defaultPrevented).toBe(true);
      const firstDialog = document.querySelector<HTMLElement>(".settings-confirmation-dialog");
      expect(firstDialog?.textContent).toContain("Leave settings without saving changes?");
      const cancel = Array.from(firstDialog?.querySelectorAll("button") ?? []).find(
        x => x.textContent?.trim() === "Cancel",
      );
      await act(async () => { cancel?.click(); });
      expect(approvedPaths).toEqual([]);

      const next = new CustomEvent("vibress:before-settings-navigation", {
        cancelable: true, detail: { path: "/admin/pages" },
      });
      await act(async () => { window.dispatchEvent(next); });
      const secondDialog = document.querySelector<HTMLElement>(".settings-confirmation-dialog");
      const leave = Array.from(secondDialog?.querySelectorAll("button") ?? []).find(
        x => x.textContent?.trim() === "Leave settings",
      );
      expect(leave).toBeDefined();
      await act(async () => { leave?.click(); });
      expect(approvedPaths).toEqual(["/admin/pages"]);
      expect(onDiscard).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("vibress:confirmed-settings-navigation", onConfirmed);
    }
  });

});
