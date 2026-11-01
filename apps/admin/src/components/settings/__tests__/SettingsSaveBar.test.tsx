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
});
