/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, Root } from "react-dom/client";
import { act } from "react";
import { AppSidebarBanner } from "../AppSidebarBanner";
import * as whatsNewApi from "../../../../lib/api/whats-new";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AppSidebarBanner React Component", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders the notification card with title, description, and sparkles badge", async () => {
    vi.spyOn(whatsNewApi, "getWhatsNewApi").mockResolvedValue({
      item: {
        id: "analytics-email-sequences",
        title: "Analytics for email sequences",
        description: "Understand how your automated emails are performing.",
        icon: "sparkles",
        publishedAt: "2026-09-13T00:00:00Z",
      },
      items: [],
      dismissedIds: [],
      version: "1.0.0",
    });

    await act(async () => {
      root.render(<AppSidebarBanner />);
    });

    const banner = container.querySelector('[data-testid="whats-new-banner"]');
    expect(banner).not.toBeNull();
    expect(container.textContent).toContain("WHAT'S NEW?");
    expect(container.textContent).toContain("Analytics for email sequences");
    expect(container.textContent).toContain(
      "Understand how your automated emails are performing.",
    );
  });

  it("renders close button with accessible aria-label", async () => {
    vi.spyOn(whatsNewApi, "getWhatsNewApi").mockResolvedValue({
      item: {
        id: "feature-1",
        title: "New Feature",
        description: "Feature description",
        publishedAt: "2026-09-13T00:00:00Z",
      },
      items: [],
      dismissedIds: [],
      version: "1.0.0",
    });

    await act(async () => {
      root.render(<AppSidebarBanner />);
    });

    const closeBtn = container.querySelector(
      'button[aria-label="Close notification"]',
    );
    expect(closeBtn).not.toBeNull();
    expect(closeBtn?.getAttribute("title")).toBe("Close notification");
  });

  it("clicking close button immediately hides the notification and invokes dismiss API", async () => {
    const dismissSpy = vi
      .spyOn(whatsNewApi, "dismissWhatsNewApi")
      .mockResolvedValue({ success: true, dismissedIds: ["feature-1"] });

    vi.spyOn(whatsNewApi, "getWhatsNewApi").mockResolvedValue({
      item: {
        id: "feature-1",
        title: "New Feature",
        description: "Feature description",
        publishedAt: "2026-09-13T00:00:00Z",
      },
      items: [],
      dismissedIds: [],
      version: "1.0.0",
    });

    await act(async () => {
      root.render(<AppSidebarBanner />);
    });

    expect(container.querySelector('[data-testid="whats-new-banner"]')).not.toBeNull();

    const closeBtn = container.querySelector(
      'button[aria-label="Close notification"]',
    ) as HTMLButtonElement;

    await act(async () => {
      closeBtn.click();
    });

    // Immediately removed from DOM
    expect(container.querySelector('[data-testid="whats-new-banner"]')).toBeNull();
    expect(container.textContent).toBe("");

    // Verify API called
    expect(dismissSpy).toHaveBeenCalledWith("feature-1");
  });

  it("renders null when no eligible item is returned", async () => {
    vi.spyOn(whatsNewApi, "getWhatsNewApi").mockResolvedValue({
      item: null,
      items: [],
      dismissedIds: ["feature-1"],
      version: "1.0.0",
    });

    await act(async () => {
      root.render(<AppSidebarBanner />);
    });

    expect(container.querySelector('[data-testid="whats-new-banner"]')).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("renders null gracefully when API fails with an error", async () => {
    vi.spyOn(whatsNewApi, "getWhatsNewApi").mockRejectedValue(
      new Error("Network Error"),
    );

    await act(async () => {
      root.render(<AppSidebarBanner />);
    });

    expect(container.querySelector('[data-testid="whats-new-banner"]')).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("renders Learn more link when safe URL is provided", async () => {
    const onNavigateMock = vi.fn();

    vi.spyOn(whatsNewApi, "getWhatsNewApi").mockResolvedValue({
      item: {
        id: "feature-with-url",
        title: "Feature with link",
        description: "Description",
        publishedAt: "2026-09-13T00:00:00Z",
        url: "/admin/analytics",
      },
      items: [],
      dismissedIds: [],
      version: "1.0.0",
    });

    await act(async () => {
      root.render(<AppSidebarBanner onNavigate={onNavigateMock} />);
    });

    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain("Learn more");
    expect(link?.getAttribute("href")).toBe("/admin/analytics");

    await act(async () => {
      link?.click();
    });

    expect(onNavigateMock).toHaveBeenCalledWith("/admin/analytics");
  });

  it("does not render link when URL is unsafe", async () => {
    vi.spyOn(whatsNewApi, "getWhatsNewApi").mockResolvedValue({
      item: {
        id: "feature-unsafe",
        title: "Feature with unsafe link",
        description: "Description",
        publishedAt: "2026-09-13T00:00:00Z",
        url: "javascript:evil()",
      },
      items: [],
      dismissedIds: [],
      version: "1.0.0",
    });

    await act(async () => {
      root.render(<AppSidebarBanner />);
    });

    expect(container.querySelector("a")).toBeNull();
  });
});
