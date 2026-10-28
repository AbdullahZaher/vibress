/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavExtensionViews } from "../NavExtensionViews";
import type { AdminExtensionViewLink } from "../../../../lib/api";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("NavExtensionViews", () => {
  let root: Root;
  let container: HTMLDivElement;

  const lmsItem: AdminExtensionViewLink = {
    pluginId: "vibress-lms-authoring",
    viewId: "courses",
    routeId: "courses",
    permission: "plugins.manage",
    label: { en: "Courses", ar: "الدورات" },
    title: { en: "Course Authoring", ar: "إدارة الدورات" },
  };

  const genericItem: AdminExtensionViewLink = {
    pluginId: "analytics-tool",
    viewId: "reports",
    routeId: "reports",
    permission: "plugins.read",
    label: { en: "Reports", ar: "التقارير" },
    title: { en: "Reports Tool", ar: "أداة التقارير" },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  it("renders LMS navigation items under dedicated LMS section", async () => {
    const onNavigate = vi.fn();
    await act(async () => {
      root.render(
        <NavExtensionViews
          items={[lmsItem, genericItem]}
          currentPath="/admin"
          onNavigate={onNavigate}
        />,
      );
    });

    expect(container.textContent).toContain("LMS");
    expect(container.textContent).toContain("Plugin pages");
    expect(container.textContent).toContain("Courses");
    expect(container.textContent).toContain("Reports");

    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(2);

    // Click Courses button
    await act(async () => {
      buttons[0]?.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("/admin/extensions/vibress-lms-authoring/courses");
  });

  it("renders independently grouped plugins alongside legacy navigation", async () => {
    const onNavigate = vi.fn();
    const item: AdminExtensionViewLink = {
      ...genericItem,
      group: { id: "insights", label: { en: "Insights", ar: "Insights" }, icon: "book-open" },
    };
    await act(async () => {
      root.render(
        <NavExtensionViews items={[item, lmsItem]}
          currentPath="/admin/extensions/analytics-tool/reports" onNavigate={onNavigate} />,
      );
    });
    expect(Array.from(container.querySelectorAll("nav")).map((nav) =>
      nav.getAttribute("aria-label"))).toEqual(["LMS", "Insights"]);
    const button = container.querySelector<HTMLButtonElement>('[aria-current="page"]');
    expect(button?.textContent).toContain("Reports");
    await act(async () => { button?.click(); });
    expect(onNavigate).toHaveBeenCalledWith("/admin/extensions/analytics-tool/reports");
  });

  it("does not merge identically named groups across different plugins", async () => {
    const group = { id: "shared", label: { en: "Insights", ar: "Insights" } };
    const other: AdminExtensionViewLink = {
      ...genericItem, pluginId: "another-plugin", viewId: "events", routeId: "events",
      group: { ...group, label: { en: "Security", ar: "Security" } },
    };
    await act(async () => {
      root.render(<NavExtensionViews items={[{ ...genericItem, group }, other]}
        currentPath="/admin" onNavigate={vi.fn()} />);
    });
    expect(Array.from(container.querySelectorAll("nav")).map((nav) =>
      nav.getAttribute("aria-label"))).toEqual(["Insights", "Security"]);
  });

  it("returns null when items is empty", async () => {
    await act(async () => {
      root.render(
        <NavExtensionViews
          items={[]}
          currentPath="/admin"
          onNavigate={vi.fn()}
        />,
      );
    });
    expect(container.innerHTML).toBe("");
  });
});
