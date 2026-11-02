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
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("renders a scoped sandboxed preview and explicit safe new-tab link", async () => {
    const onBack = vi.fn();
    const onRefresh = vi.fn();
    await act(async () => {
      root.render(
        <ThemePreviewWorkspace
          themeName="Retro Creator"
          url="/preview/token-123"
          onBack={onBack}
          onRefresh={onRefresh}
        />,
      );
    });
    const frame = container.querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe("/preview/token-123");
    expect(frame?.getAttribute("sandbox")).toBe("allow-forms allow-popups");
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(container.textContent).toContain("Inline preview is limited");
    expect(frame?.getAttribute("title")).toContain("Retro Creator");

    const link = container.querySelector('a[href="/preview/token-123"]');
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");

    const refresh = [...container.querySelectorAll("button")].find((x) =>
      x.textContent?.includes("Refresh preview"),
    );
    const back = container.querySelector<HTMLButtonElement>('button[aria-label="Back to themes"]');
    await act(async () => {
      refresh?.click();
      back?.click();
    });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows a responsive mobile canvas capped at 390px without publishing", async () => {
    await act(async () => {
      root.render(
        <ThemePreviewWorkspace
          themeName="Minimal"
          url="/preview/token-456"
          onBack={vi.fn()}
          onRefresh={vi.fn()}
        />,
      );
    });
    const frame = container.querySelector("iframe")?.parentElement as HTMLDivElement;
    expect(frame.style.width).toBe("1200px");
    const mobile = [...container.querySelectorAll("button")].find((x) =>
      x.textContent?.includes("Mobile"),
    );
    await act(async () => {
      mobile?.click();
    });
    expect(container.querySelector("iframe")?.parentElement?.style.width).toBe("100%");
    expect(container.querySelector("iframe")?.parentElement?.style.maxWidth).toBe("390px");
    expect(["0", "0px"]).toContain(container.querySelector("iframe")?.parentElement?.style.minWidth);
    expect(container.textContent).toContain("Up to 390px");
    expect(mobile?.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("Saved theme settings");
  });

  it("renders authentic loading state and clears it upon iframe load", async () => {
    await act(async () => {
      root.render(
        <ThemePreviewWorkspace
          themeName="Vibress Default"
          url="/preview/token-live"
          onBack={vi.fn()}
          onRefresh={vi.fn()}
        />,
      );
    });

    // 1. Initial state must be authentic loading overlay with role="status"
    const statusOverlay = container.querySelector('div[role="status"]');
    expect(statusOverlay).not.toBeNull();
    expect(statusOverlay?.getAttribute("aria-live")).toBe("polite");
    expect(statusOverlay?.textContent).toContain("Loading preview...");

    // 2. Simulate iframe load event
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    await act(async () => {
      iframe?.dispatchEvent(new Event("load"));
    });

    // 3. Status overlay must be detached after load
    expect(container.querySelector('div[role="status"]')).toBeNull();
  });

  it("renders authentic unavailable alert state on iframe error and invokes retry on click", async () => {
    const onRefresh = vi.fn();
    await act(async () => {
      root.render(
        <ThemePreviewWorkspace
          themeName="Vibress Molten"
          url="/preview/token-expired"
          onBack={vi.fn()}
          onRefresh={onRefresh}
        />,
      );
    });

    // Simulate iframe loading error (e.g. 403 or network failure)
    const iframe = container.querySelector("iframe");
    await act(async () => {
      // In JSDOM error events on iframe can be triggered or timed out
      iframe?.dispatchEvent(new Event("error", { bubbles: true }));
      vi.advanceTimersByTime(16000);
    });

    // Role alert must be present with actionable guidance
    const alertOverlay = container.querySelector('div[role="alert"]');
    expect(alertOverlay).not.toBeNull();
    expect(alertOverlay?.textContent).toContain("Inline preview could not be displayed.");
    expect(alertOverlay?.textContent).toContain("Try the full preview in a new tab");

    // Action buttons inside the recovery overlay
    const retryBtn = alertOverlay?.querySelector("button");
    expect(retryBtn?.textContent).toContain("Refresh preview");

    await act(async () => {
      retryBtn?.click();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    const extLink = alertOverlay?.querySelector("a");
    expect(extLink?.getAttribute("href")).toBe("/preview/token-expired");
    expect(extLink?.getAttribute("target")).toBe("_blank");
  });

  it("transitions to unavailable state on timeout when iframe does not respond", async () => {
    await act(async () => {
      root.render(
        <ThemePreviewWorkspace
          themeName="Vibress Minimal"
          url="/preview/token-hung"
          onBack={vi.fn()}
          onRefresh={vi.fn()}
        />,
      );
    });

    expect(container.querySelector('div[role="status"]')).not.toBeNull();
    expect(container.querySelector('div[role="alert"]')).toBeNull();

    // Advance timers past 15 seconds timeout
    await act(async () => {
      vi.advanceTimersByTime(16000);
    });

    expect(container.querySelector('div[role="status"]')).toBeNull();
    expect(container.querySelector('div[role="alert"]')).not.toBeNull();
  });
});
