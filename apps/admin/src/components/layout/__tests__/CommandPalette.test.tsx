/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "../CommandPalette";
vi.mock("../../../lib/admin-locale", () => ({
  useAdminLocale: () => ({ tr: (value: string) => value }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
describe("CommandPalette keyboard navigation", () => {
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
    vi.restoreAllMocks();
  });
  it("connects the results and announces the selected option", async () => {
    await act(async () => root.render(
      <CommandPalette isOpen onClose={vi.fn()} onNavigate={vi.fn()}
        onToggleDarkMode={vi.fn()} darkMode={false} onLogout={vi.fn()}
        canCreatePosts={false} canCreatePages={false}
        canReadAnalytics={false} canReadPosts={false} canReadPages={false}
        canReadTags={false} canReadMedia={false} canReadMembers={false}
        canReadComments={false} />,
    ));
    const input = document.querySelector<HTMLInputElement>('[role="combobox"]');
    const list = document.querySelector('[role="listbox"]');
    expect(input).not.toBeNull();
    expect(input?.getAttribute("aria-controls")).toBe(list?.id);
    const first = input?.getAttribute("aria-activedescendant") ?? "";
    expect(document.getElementById(first)?.getAttribute("aria-selected")).toBe("true");
    await act(async () => input?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    const second = input?.getAttribute("aria-activedescendant") ?? "";
    expect(second).not.toBe(first);
    expect(document.getElementById(second)?.getAttribute("aria-selected")).toBe("true");
  });
});
