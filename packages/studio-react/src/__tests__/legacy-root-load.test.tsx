import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultStudioDocument } from "@vibress/studio-core";
import { VibressStudio } from "../VibressStudio";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => vi.restoreAllMocks());

describe("historical roots in the mounted editor", () => {
  it.each([false, true])("loads the historical root without parse errors (empty=%s)", async empty => {
    const canonical = createDefaultStudioDocument("مسودة English");
    const { type: _type, ...legacyRoot } = canonical.root;
    const original = { version: 1, root: empty ? {} : legacyRoot };
    const onError = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const element = document.createElement("div");
    document.body.appendChild(element);
    const root = createRoot(element);
    try {
      await act(async () => { root.render(<VibressStudio value={original} onError={onError} />); });
      expect(element.querySelector('[contenteditable="true"]')).not.toBeNull();
      if (!empty) expect(element.textContent).toContain("مسودة English");
      expect(onError).not.toHaveBeenCalled();
      expect(consoleError.mock.calls.filter(args => String(args[0]).includes("Failed to sync external editor state"))).toEqual([]);
    } finally {
      await act(async () => root.unmount());
      element.remove();
    }
  });
});
