/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsDashboard } from "../AnalyticsDashboard";
import type { ApiUser } from "../../../lib/api";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const overview = {
  range: { range: "30d", from: "2026-10-01", to: "2026-10-30" },
  summary: { views: 130, visitors: 68, members: 240, paidMembers: 30 },
  comparison: {
    views: { current: 130, previous: 100, percentage: 30, isNew: false },
    visitors: { current: 68, previous: 60, percentage: 13.3, isNew: false },
    members: { current: 12, previous: 8, percentage: 50, isNew: false },
  },
  timeseries: [
    { date: "2026-10-28", views: 30, visitors: 18, members: 4 },
    { date: "2026-10-29", views: 50, visitors: 26, members: 8 },
    { date: "2026-10-30", views: 50, visitors: 24, members: 0 },
  ],
  latestPost: null,
  topPosts: [{ path: "/posts/welcome", title: "Welcome", views: 42 }],
  topContent: [{ path: "/posts/welcome", title: "Welcome", type: "posts", views: 42 }],
  referrers: [],
  newsletter: { sent: 34, openRate: 41.2, clickRate: 12.1 },
  growth: { freeMembers: 210, paidMembers: 30 },
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: overview,
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  }),
}));
vi.mock("../../../lib/admin-locale", () => ({
  useAdminLocale: () => ({
    tr: (value: string) => value,
    locale: "en",
    formatDate: (value: unknown) => String(value).slice(0, 10),
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat("en-US", options).format(value),
  }),
}));

describe("AnalyticsDashboard clarity and accessible chart", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <AnalyticsDashboard
          user={{ id: "owner" } as ApiUser}
          onNavigate={vi.fn()}
          canReadAnalytics
          canReadPosts={false}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("separates new members from all-time member totals", () => {
    const cards = [...container.querySelectorAll("section[aria-labelledby='performance-overview-title'] .grid > div")];
    expect(cards).toHaveLength(4);
    expect(cards[2]?.textContent).toContain("New members");
    expect(cards[2]?.textContent).toContain("12");
    expect(cards[2]?.textContent).toContain("50%");
    expect(cards[3]?.textContent).toContain("Current members");
    expect(cards[3]?.textContent).toContain("240");
    expect(cards[3]?.textContent).toContain("Current total");
    expect(cards[3]?.textContent).not.toContain("50%");
  });

  it("provides one focus stop for chart and accessible daily table", () => {
    const chart = container.querySelector<HTMLDivElement>('[role="group"][tabindex="0"]');
    expect(chart).not.toBeNull();
    expect(container.querySelectorAll("svg circle[tabindex]")).toHaveLength(0);
    act(() => chart?.focus());
    act(() => chart?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(container.textContent).toContain("Oct 28");
    const toggle = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "View data");
    expect(toggle).toBeTruthy();
    act(() => toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.querySelectorAll("table tbody tr")).toHaveLength(3);
  });

  it("links top posts to safe public routes", () => {
    const link = container.querySelector('a[href="/posts/welcome"]');
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("labels membership totals as unfiltered", () => {
    const growthTab = container.querySelector<HTMLButtonElement>('[role="tab"][id$="-tab-growth"]');
    expect(growthTab).not.toBeNull();
    act(() => growthTab?.click());
    expect(container.textContent).toContain("Membership totals are current and not limited by the date filter.");
  });
});
