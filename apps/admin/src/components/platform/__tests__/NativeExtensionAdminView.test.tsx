/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readExtensionAdminViewApi, readNativeExtensionAdminPageApi,
  readNativeExtensionDataRegistryApi, readNativeExtensionResourceApi,
  ApiError, type AdminExtensionViewLink,
} from "../../../lib/api";
import { getActivePublicationId } from "../../../lib/api/client";
import { NativeExtensionAdminView } from "../NativeExtensionAdminView";

vi.mock("../../../lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly code: string, message: string, readonly statusCode: number) {
      super(message);
    }
  },
  readExtensionAdminViewApi: vi.fn(),
  readNativeExtensionAdminPageApi: vi.fn(),
  readNativeExtensionDataRegistryApi: vi.fn(),
  executeNativeExtensionActionApi: vi.fn(),
  readNativeExtensionResourceApi: vi.fn(),
}));
vi.mock("../../../lib/api/client", () => ({
  getActivePublicationId: vi.fn(),
}));
vi.mock("../../../lib/admin-locale", () => ({
  useAdminLocale: () => ({ locale: "en", tr: (key: string) => key }),
}));
vi.mock("../PluginAdminView", () => ({
  PluginAdminView: () => <div data-testid="legacy-frame" />,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const link: AdminExtensionViewLink = {
  pluginId: "operator-plugin",
  viewId: "courses",
  routeId: "courses",
  label: { en: "Courses", ar: "Courses" },
  title: { en: "Courses", ar: "Courses" },
  permission: "plugins.read",
  nativeProbeSupported: true,
};
const hostile = "<img src=x onerror=alert(1)>";
const native = {
  mode: "native" as const,
  routeId: "courses",
  page: {
    schemaVersion: 1 as const,
    viewId: "courses",
    title: { en: hostile, ar: hostile },
    components: [{
      type: "field-list" as const,
      id: "values",
      fields: [{
        key: "title",
        label: { en: "Title", ar: "Title" },
      }],
    }],
  },
};

describe("Host-rendered native extension page", () => {
  let root: Root;
  let element: HTMLDivElement;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getActivePublicationId).mockReturnValue("publication-a");
    vi.mocked(readNativeExtensionDataRegistryApi).mockResolvedValue({
      schemaVersion: 1, resources: [], actions: [],
    });
    element = document.createElement("div");
    document.body.append(element);
    root = createRoot(element);
  });
  afterEach(() => {
    act(() => { root.unmount(); });
    element.remove();
  });

  async function render() {
    await act(async () => {
      root.render(<NativeExtensionAdminView link={link} />);
    });
  }

  it("preserves old API/Host compatibility without probing an unknown route", async () => {
    await act(async () => {
      root.render(<NativeExtensionAdminView link={{
        pluginId: link.pluginId, viewId: link.viewId, routeId: link.routeId,
        label: link.label, title: link.title, permission: link.permission,
      }} />);
    });
    expect(element.querySelector('[data-testid="legacy-frame"]')).not.toBeNull();
    expect(readNativeExtensionAdminPageApi).not.toHaveBeenCalled();
  });

  it("preserves explicit Host-selected legacy rendering", async () => {
    vi.mocked(readNativeExtensionAdminPageApi).mockResolvedValue({ mode: "legacy" });
    await render();
    expect(element.querySelector('[data-testid="legacy-frame"]')).not.toBeNull();
    expect(readExtensionAdminViewApi).not.toHaveBeenCalled();
  });

  it("escapes hostile localized text and stored values", async () => {
    vi.mocked(readNativeExtensionAdminPageApi).mockResolvedValue(native);
    vi.mocked(readExtensionAdminViewApi).mockResolvedValue({ title: hostile });
    await render();
    expect(element.textContent).toContain(hostile);
    expect(element.querySelector("img")).toBeNull();
    expect(element.querySelector("iframe")).toBeNull();
    expect(element.querySelector("h1")?.textContent).toBe(hostile);
  });

  it("renders paginated Host data as text, without executing persisted HTML", async () => {
    vi.mocked(readNativeExtensionAdminPageApi).mockResolvedValue(native);
    vi.mocked(readExtensionAdminViewApi).mockResolvedValue({ title: "overview" });
    vi.mocked(readNativeExtensionDataRegistryApi).mockResolvedValue({
      schemaVersion: 1,
      resources: [{
        id: "course-list", viewId: "courses", fields: ["title_en"],
        textFilters: ["title_en"], fieldTypes: { title_en: "text" },
      }],
      actions: [],
    });
    vi.mocked(readNativeExtensionResourceApi).mockResolvedValue({
      schemaVersion: 1,
      items: [{ id: "course-1", version: 1, fields: { title_en: hostile } }],
    });
    await render();
    expect(element.textContent).toContain(hostile);
    expect(element.querySelector("img")).toBeNull();
    expect(element.querySelector("table")).not.toBeNull();
    expect(element.querySelector("button[aria-label='Edit record']")).toBeNull();
    expect(readNativeExtensionResourceApi).toHaveBeenCalledWith(
      "operator-plugin", "course-list", { limit: 20 },
    );
  });

  it("redacts the complete native page when a resource refresh loses authorization", async () => {
    vi.mocked(readNativeExtensionAdminPageApi).mockResolvedValue(native);
    vi.mocked(readExtensionAdminViewApi).mockResolvedValue({ title: "private summary" });
    vi.mocked(readNativeExtensionDataRegistryApi).mockResolvedValue({
      schemaVersion: 1,
      resources: [{ id: "course-list", viewId: "courses", fields: ["title_en"] }],
      actions: [],
    });
    vi.mocked(readNativeExtensionResourceApi)
      .mockResolvedValueOnce({ schemaVersion: 1, items: [
        { id: "course-1", version: 1, fields: { title_en: "private course" } },
      ] })
      .mockRejectedValueOnce(new ApiError("PERMISSION_DENIED", "Denied", 403));
    await render();
    expect(element.textContent).toContain("private summary");
    expect(element.textContent).toContain("private course");
    const refresh = Array.from(element.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Refresh");
    expect(refresh).toBeDefined();
    await act(async () => { refresh?.click(); });
    expect(element.textContent).not.toContain("private summary");
    expect(element.textContent).not.toContain("private course");
    expect(element.querySelector("table")).toBeNull();
    expect(element.querySelector('[data-testid="legacy-frame"]')).toBeNull();
    expect(element.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("redacts scalar data when resource discovery loses Staff authorization", async () => {
    vi.mocked(readNativeExtensionAdminPageApi).mockResolvedValue(native);
    vi.mocked(readExtensionAdminViewApi).mockResolvedValue({ title: "private summary" });
    vi.mocked(readNativeExtensionDataRegistryApi)
      .mockRejectedValue(new ApiError("AUTHENTICATION_REQUIRED", "Expired", 401));
    await render();
    expect(element.textContent).not.toContain("private summary");
    expect(element.querySelector('[role="alert"]')).not.toBeNull();
    expect(element.querySelector('[data-testid="legacy-frame"]')).toBeNull();
  });

  it("preserves a read-only Native page when an older plugin has no data registry", async () => {
    vi.mocked(readNativeExtensionAdminPageApi).mockResolvedValue(native);
    vi.mocked(readExtensionAdminViewApi).mockResolvedValue({ title: "readonly value" });
    vi.mocked(readNativeExtensionDataRegistryApi)
      .mockRejectedValue(new ApiError("EXTENSION_DATA_NOT_FOUND", "Absent", 404));
    await render();
    expect(element.textContent).toContain("readonly value");
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it("does not render cached native data if publication changes before React effects flush", async () => {
    vi.mocked(readNativeExtensionAdminPageApi).mockResolvedValue(native);
    vi.mocked(readExtensionAdminViewApi).mockResolvedValue({ title: hostile });
    await render();
    expect(element.textContent).toContain(hostile);
    vi.mocked(getActivePublicationId).mockReturnValue("publication-b");
    await act(async () => {
      root.render(<NativeExtensionAdminView link={link} />);
    });
    expect(element.textContent).not.toContain(hostile);
  });

  it("fails closed on a native endpoint denial rather than showing a frame", async () => {
    vi.mocked(readNativeExtensionAdminPageApi).mockRejectedValue(new Error("Permission denied"));
    await render();
    expect(element.querySelector('[role="alert"]')).not.toBeNull();
    expect(element.querySelector('[data-testid="legacy-frame"]')).toBeNull();
  });

  it("drops an in-flight previous-publication response on a publication switch", async () => {
    let release: ((value: typeof native) => void) | undefined;
    const pending = new Promise<typeof native>((resolve) => { release = resolve; });
    vi.mocked(readNativeExtensionAdminPageApi)
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce({ mode: "legacy" });
    await render();
    vi.mocked(getActivePublicationId).mockReturnValue("publication-b");
    await act(async () => {
      window.dispatchEvent(new Event("vibress:publication-changed"));
    });
    await act(async () => { release?.(native); });
    expect(element.querySelector('[data-testid="legacy-frame"]')).not.toBeNull();
    expect(element.textContent).not.toContain(hostile);
  });
});
