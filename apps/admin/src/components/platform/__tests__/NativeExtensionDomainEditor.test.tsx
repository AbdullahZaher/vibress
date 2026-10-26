/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { writeExtensionAdminViewApi } from "../../../lib/api";
import { getActivePublicationId } from "../../../lib/api/client";
import { NativeExtensionDomainEditor } from "../NativeExtensionDomainEditor";

vi.mock("../../../lib/api", () => ({ writeExtensionAdminViewApi: vi.fn() }));
vi.mock("../../../lib/api/client", () => ({ getActivePublicationId: vi.fn() }));
vi.mock("../../../lib/admin-locale", () => ({
  useAdminLocale: () => ({ locale: "en", tr: (key: string) => key }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const workflow = {
  schemaVersion: 1 as const, viewId: "overview", routeId: "courses",
  idField: "courseId", versionField: "expectedVersion", operationField: "operation",
  fields: [{ key: "title_en", label: { en: "Title", ar: "العنوان" }, maxLength: 180 }],
  operations: ["create", "save", "publish"] as const,
};
const link = {
  pluginId: "lms-course", viewId: "overview", routeId: "courses",
  label: { en: "Courses", ar: "الدورات" }, title: { en: "Courses", ar: "الدورات" },
  permission: "plugins.manage" as const,
};
describe("NUI-05 Host domain editor", () => {
  let root: Root, element: HTMLDivElement;
  const onSaved = vi.fn(), onClear = vi.fn();
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getActivePublicationId).mockReturnValue("site-a");
    element = document.createElement("div"); document.body.append(element);
    root = createRoot(element);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks(); element.remove();
  });
  async function render(selected: { id: string; version: number;
    fields: Record<string, string | number | boolean | null> } | null = null) {
    await act(async () => {
      root.render(<NativeExtensionDomainEditor workflow={workflow} link={link}
        publicationId="site-a" selected={selected} onSaved={onSaved} onClear={onClear} />);
    });
  }
  it("creates no action on mount; authoring requires explicit opt-in UI action", async () => {
    await render();
    expect(element.querySelector("form")).toBeNull();
    expect(writeExtensionAdminViewApi).not.toHaveBeenCalled();
    await act(async () => { element.querySelector<HTMLButtonElement>("button")?.click(); });
    expect(element.querySelector("form")).not.toBeNull();
    expect(writeExtensionAdminViewApi).not.toHaveBeenCalled();
  });
  it("preserves hostile titles as text and does not edit published courses", async () => {
    const hostile = "<svg onload=alert(1)>";
    await render({ id: "course-one", version: 7, fields: {
      title_en: hostile, status: "published",
    } });
    expect(element.querySelector("svg")).toBeNull();
    expect(element.querySelector("form")).toBeNull();
    expect(element.textContent).toContain("Published items cannot be edited.");
    expect(writeExtensionAdminViewApi).not.toHaveBeenCalled();
  });
  it("delegates publish to the paired domain route with a pinned CAS version", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(writeExtensionAdminViewApi).mockResolvedValue({
      outcome: "published", courseId: "course-one", version: 8, status: "published",
    });
    await render({ id: "course-one", version: 7, fields: {
      title_en: "Existing", status: "draft",
    } });
    const publish = Array.from(element.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Publish");
    await act(async () => { publish?.click(); });
    expect(writeExtensionAdminViewApi).toHaveBeenCalledWith(link, {
      courseId: "course-one", expectedVersion: 7,
      operation: "publish", title_en: "Existing",
    });
    expect(onSaved).toHaveBeenCalledOnce();
  });
  it("treats conflict outcomes as denials even if the HTTP status is 200", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(writeExtensionAdminViewApi).mockResolvedValue({
      outcome: "conflict", courseId: "course-one", version: 8, status: "draft",
    });
    await render({ id: "course-one", version: 7, fields: {
      title_en: "Existing", status: "draft",
    } });
    const publish = Array.from(element.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Publish");
    await act(async () => { publish?.click(); });
    expect(onSaved).not.toHaveBeenCalled();
    expect(element.querySelector('[role="alert"]')?.textContent)
      .toContain("Workflow action rejected.");
  });
  it("hides all workflow controls immediately after publication switching", async () => {
    await render({ id: "course-one", version: 7, fields: { title_en: "Private", status: "draft" } });
    vi.mocked(getActivePublicationId).mockReturnValue("site-b");
    await act(async () => { root.render(<NativeExtensionDomainEditor workflow={workflow}
      link={link} publicationId="site-a" selected={null}
      onSaved={onSaved} onClear={onClear} />); });
    expect(element.textContent).not.toContain("Private");
    expect(element.querySelector("form")).toBeNull();
  });
});
