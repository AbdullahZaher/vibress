import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminLocaleProvider } from "../admin-locale";
import { NavExtensionViews } from "../../components/layout/sidebar/NavExtensionViews";

const entry = {
  pluginId: "trusted-lms", viewId: "courses", routeId: "course-list",
  title: { en: "Courses", ar: "الدورات" },
  label: { en: "<script>alert(1)</script>", ar: "دورات التعلّم" },
  permission: "plugins.read" as const,
};

describe("Host-rendered extension navigation", () => {
  it("renders untrusted plugin titles only as escaped text and marks the current page", () => {
    const html = renderToStaticMarkup(
      <AdminLocaleProvider initialLocale="en">
        <NavExtensionViews
          items={[entry]}
          currentPath="/admin/extensions/trusted-lms/courses"
          onNavigate={vi.fn()}
        />
      </AdminLocaleProvider>,
    );
    expect(html).toContain("aria-current=\"page\"");
    expect(html).toContain('dir="auto"');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('type="button"');
  });

  it("uses the Arabic label under RTL locale and excludes absent entries", () => {
    const html = renderToStaticMarkup(
      <AdminLocaleProvider initialLocale="ar-SA">
        <NavExtensionViews
          items={[entry]}
          currentPath="/admin/extensions/trusted-lms/courses"
          onNavigate={vi.fn()}
        />
      </AdminLocaleProvider>,
    );
    expect(html).toContain("دورات التعلّم");
    expect(html).not.toContain("alert(1)");
    const empty = renderToStaticMarkup(
      <AdminLocaleProvider initialLocale="ar-SA">
        <NavExtensionViews items={[]} currentPath="/admin" onNavigate={vi.fn()} />
      </AdminLocaleProvider>,
    );
    expect(empty).toBe("");
  });
});
