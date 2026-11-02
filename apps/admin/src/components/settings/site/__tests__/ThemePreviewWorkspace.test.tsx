/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemePreviewWorkspace } from "../ThemePreviewWorkspace";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ThemePreviewWorkspace", () => {
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
  it("renders a scoped sandboxed preview and explicit safe new-tab link", async () => {
    const onBack = vi.fn();
    const onRefresh = vi.fn();
    await act(async () => {
      root.render(<ThemePreviewWorkspace themeName="Retro Creator" url="/preview/token-123"
        onBack={onBack} onRefresh={onRefresh} />);
    });
    const frame = container.querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe("/preview/token-123");
    expect(frame?.getAttribute("sandbox")).not.toContain("allow-scripts");
    expect(container.textContent).toContain("Inline preview is limited");
    expect(frame?.getAttribute("title")).toContain("Retro Creator");
    const link = container.querySelector('a[href="/preview/token-123"]');
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
    const refresh = [...container.querySelectorAll("button")].find(x => x.textContent?.includes("Refresh preview"));
    const back = container.querySelector<HTMLButtonElement>('button[aria-label="Back to themes"]');
    await act(async () => { refresh?.click(); back?.click(); });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
  it("switches to a real 390px mobile preview width without publishing", async () => {
    await act(async () => {
      root.render(<ThemePreviewWorkspace themeName="Minimal" url="/preview/token-456"
        onBack={vi.fn()} onRefresh={vi.fn()} />);
    });
    const frame = container.querySelector("iframe")?.parentElement as HTMLDivElement;
    expect(frame.style.width).toBe("1200px");
    const mobile = [...container.querySelectorAll("button")].find(x => x.textContent?.includes("Mobile"));
    await act(async () => { mobile?.click(); });
    expect(container.querySelector("iframe")?.parentElement?.style.width).toBe("390px");
    expect(mobile?.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("Saved theme settings");
  });
});
