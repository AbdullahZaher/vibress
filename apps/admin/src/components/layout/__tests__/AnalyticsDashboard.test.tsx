/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsDashboard } from "../AnalyticsDashboard";
import type { ApiUser } from "../../../lib/api";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const queryState = { loading: false };
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
  latestPost: null as null | { id: string; slug: string; title: string; publishedAt: string; views: number },
  topPosts: [{ path: "/posts/welcome", title: "Welcome", views: 42 }],
  topContent: [
    { path: "/posts/welcome", title: "Welcome", type: "post", views: 42 },
    { path: "/pages/about", title: "About", type: "page", views: 10 },
  ],
  referrers: [],
  newsletter: { sent: 34, openRate: 41.2, clickRate: 12.1 },
  growth: { freeMembers: 210, paidMembers: 30 },
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: queryState.loading ? undefined : overview,
    isLoading: queryState.loading,
    isError: false,
    isSuccess: !queryState.loading,
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
    queryState.loading = false;
    overview.latestPost = null;
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

  it("displays a new-member growth chart and an all-time paid share separately", () => {
    const growthTab = container.querySelector<HTMLButtonElement>('[role="tab"][id$="-tab-growth"]');
    act(() => growthTab?.click());
    expect(container.textContent).toContain("Daily new members");
    const chart = container.querySelector<HTMLElement>('[role="group"][tabindex="0"]');
    expect(chart?.className).toContain("dark:text-blue-400");
    expect(container.textContent).toContain("12.5%");
    const share = container.querySelector<HTMLElement>('[role="progressbar"]');
    expect(share?.getAttribute("aria-valuenow")).toBe("13");
  });

  it("keeps the tooltip within the chart at both edges and gives the full year", () => {
    const chart = container.querySelector<HTMLElement>('[role="group"][tabindex="0"]');
    act(() => chart?.focus());
    const tooltip = container.querySelector<HTMLElement>('[aria-live="polite"]');
    expect(tooltip?.style.maxWidth).toBe("100%");
    expect(tooltip?.style.transform).toBe("translateX(-100%)");
    act(() => chart?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    const startTooltip = container.querySelector<HTMLElement>('[aria-live="polite"]');
    expect(startTooltip?.style.transform).toBe("translateX(0)");
    expect(startTooltip?.textContent).toContain("2026");
  });

  it("filters pages and posts using the API singular content types", () => {
    act(() => container.querySelector<HTMLButtonElement>('[role="tab"][id$="-tab-web"]')?.click());
    const controls = [...container.querySelectorAll("button")];
    const pages = controls.find((button) => button.textContent === "Pages");
    act(() => pages?.click());
    expect(container.textContent).toContain("About");
    expect(container.querySelector('a[href="/posts/welcome"]')).toBeNull();
  });

  it("shows the admin edit action only to users with edit permission", () => {
    overview.latestPost = {
      id: "post-1", slug: "hello", title: "Latest story", publishedAt: "2026-10-30T12:00:00.000Z", views: 2,
    };
    act(() => root.render(
      <AnalyticsDashboard user={{ id: "owner" } as ApiUser} onNavigate={vi.fn()} canReadAnalytics canReadPosts />
    ));
    expect([...container.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Open published post")).toBe(false);
    act(() => root.render(
      <AnalyticsDashboard user={{ id: "owner" } as ApiUser} onNavigate={vi.fn()} canReadAnalytics canReadPosts canEditPosts />
    ));
    expect([...container.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Open published post")).toBe(true);
  });

  it("uses a four-card and primary-chart skeleton while loading", () => {
    queryState.loading = true;
    act(() => root.render(
      <AnalyticsDashboard user={{ id: "owner" } as ApiUser} onNavigate={vi.fn()} canReadAnalytics canReadPosts={false} />
    ));
    const skeleton = container.querySelector<HTMLElement>('[role="status"][aria-busy="true"]');
    expect(skeleton).not.toBeNull();
    expect(skeleton?.querySelectorAll(".grid > div")).toHaveLength(4);
    expect(skeleton?.querySelector(".h-52")).not.toBeNull();
  });
});
